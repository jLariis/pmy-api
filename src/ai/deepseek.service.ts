import { Injectable, Logger } from '@nestjs/common';

/**
 * Cliente mínimo de DeepSeek (API compatible con OpenAI chat completions).
 * Pensado para la **capa gratuita**: se llama solo on-demand y, si topa el límite
 * de tasa (HTTP 429), **espera y reintenta** con backoff (honrando `Retry-After`)
 * en vez de fallar de inmediato. Errores de credenciales/saldo no se reintentan.
 *
 * Config por env:
 *   DEEPSEEK_API_KEY      (requerida para habilitar la IA)
 *   DEEPSEEK_BASE_URL     (default https://api.deepseek.com)
 *   DEEPSEEK_MODEL        (default deepseek-chat)
 *   DEEPSEEK_MAX_RETRIES  (default 6)
 *   DEEPSEEK_MAX_WAIT_MS  (default 300000 = 5 min, tope total de espera)
 *   DEEPSEEK_TIMEOUT_MS   (default 60000, por intento)
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class DeepseekDisabledError extends Error {}
export class DeepseekAuthError extends Error {}
export class DeepseekRateLimitError extends Error {}

/** Espera de backoff: usa `Retry-After` si viene; si no, exponencial con jitter. */
export function computeBackoffMs(
  attempt: number,
  retryAfterSec?: number,
  baseMs = 1000,
  capMs = 60000,
): number {
  if (retryAfterSec && retryAfterSec > 0) return Math.min(retryAfterSec * 1000, capMs);
  const exp = Math.min(baseMs * 2 ** attempt, capMs);
  return Math.round(exp / 2 + Math.random() * (exp / 2)); // jitter [exp/2, exp]
}

@Injectable()
export class DeepseekService {
  private readonly logger = new Logger(DeepseekService.name);

  /** Parsea un env numérico; cae al default solo si no es un número finito (0 es válido). */
  private num(raw: string | undefined, def: number): number {
    const n = Number(raw);
    return Number.isFinite(n) && raw !== undefined && raw !== '' ? n : def;
  }

  private cfg() {
    return {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      maxRetries: this.num(process.env.DEEPSEEK_MAX_RETRIES, 6),
      maxWaitMs: this.num(process.env.DEEPSEEK_MAX_WAIT_MS, 300_000),
      timeoutMs: this.num(process.env.DEEPSEEK_TIMEOUT_MS, 60_000),
    };
  }

  /** ¿Hay API key configurada? (para que la UI muestre/oculte el modo IA). */
  isEnabled(): boolean {
    return !!process.env.DEEPSEEK_API_KEY;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Completa un chat. Devuelve el texto del primer choice. Lanza:
   * - `DeepseekDisabledError` si no hay API key.
   * - `DeepseekAuthError` en 401/402/403 (credenciales o saldo; no se reintenta).
   * - `DeepseekRateLimitError` si tras esperar `maxWaitMs` sigue limitado (429).
   */
  async complete(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    const c = this.cfg();
    if (!c.apiKey) throw new DeepseekDisabledError('DEEPSEEK_API_KEY no configurada');

    const body = JSON.stringify({
      model: c.model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 2048,
      stream: false,
    });

    let waited = 0;
    for (let attempt = 0; attempt <= c.maxRetries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), c.timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${c.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
          body,
          signal: ac.signal,
        });
      } catch (e: any) {
        clearTimeout(timer);
        // Error de red / timeout → reintento con backoff (dentro del tope).
        const delay = computeBackoffMs(attempt);
        if (waited + delay > c.maxWaitMs) throw new DeepseekRateLimitError(`red/timeout: ${e?.message}`);
        this.logger.warn(`DeepSeek intento ${attempt} falló (${e?.message}); espero ${delay}ms`);
        await this.sleep(delay);
        waited += delay;
        continue;
      }
      clearTimeout(timer);

      if (res.ok) {
        const data: any = await res.json().catch(() => null);
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text === 'string' && text.trim()) return text.trim();
        throw new Error('DeepSeek respondió sin contenido');
      }

      if (res.status === 401 || res.status === 402 || res.status === 403) {
        const detail = await res.text().catch(() => '');
        throw new DeepseekAuthError(`DeepSeek ${res.status}: ${detail.slice(0, 200)}`);
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) || undefined;
        const delay = computeBackoffMs(attempt, retryAfter);
        if (waited + delay > c.maxWaitMs) {
          throw new DeepseekRateLimitError(`límite de tasa tras esperar ${Math.round(waited / 1000)}s`);
        }
        this.logger.warn(`DeepSeek ${res.status}; espero ${delay}ms (acumulado ${Math.round(waited / 1000)}s)`);
        await this.sleep(delay);
        waited += delay;
        continue;
      }

      const detail = await res.text().catch(() => '');
      throw new Error(`DeepSeek ${res.status}: ${detail.slice(0, 200)}`);
    }

    throw new DeepseekRateLimitError(`agotados ${c.maxRetries} reintentos`);
  }
}
