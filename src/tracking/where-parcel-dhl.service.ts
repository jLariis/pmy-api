import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
import * as timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Evento normalizado (mismo shape que usaba el servicio 17TRACK, para no tocar
 * la persistencia en ShipmentsService).
 */
export interface TrackEvent {
  time: string;
  description: string;
  location: string;
}

/**
 * Resultado normalizado de tracking. ShipmentsService.persistDhlTrackingResults
 * consume EXACTAMENTE este shape (se mantiene de la época de 17TRACK).
 * `currentStatus` ahora trae el status de WhereParcel (delivered/in_transit/…).
 */
export interface NormalizedTrackingResult {
  trackingNumber: string;
  currentStatus: string;
  subStatus: string | null;
  latestEvent: TrackEvent | null;
  localTimestamp: string;
  rawTrackingData: any | null;
}

/** Uso/quota para mostrar en Configuración (mismo shape que esperaba el front). */
export interface WhereParcelUsage {
  total: number;
  used: number;
  remaining: number;
  todayUsed: number;
}

/** Estructura de la respuesta de WhereParcel POST /v2/track. */
interface WhereParcelEvent {
  timestamp?: string;
  status?: string;
  statusText?: string;
  location?: string;
  description?: string;
}
interface WhereParcelData {
  carrier?: string;
  carrierName?: string;
  trackingNumber?: string;
  /** Estatus normalizado REAL de WhereParcel (p.ej. "in_transit", "delivered"). */
  deliveryStatus?: string;
  status?: string;
  statusText?: string;
  lastUpdated?: string;
  events?: WhereParcelEvent[];
}
interface WhereParcelResultItem {
  carrier?: string;
  trackingNumber: string;
  clientId?: string;
  /** Resultado del lookup a nivel item: 'success' | 'failed'. (NO es boolean.) */
  status?: string;
  success?: boolean;
  billable?: boolean;
  cached?: boolean;
  error?: { code?: string; message?: string };
  data?: WhereParcelData;
}
interface WhereParcelTrackResponse {
  success?: boolean;
  results?: WhereParcelResultItem[];
  error?: { code?: string; message?: string };
  /** Uso real: { minute: "7/30", day: "89/10000", month: "89/10000" }. */
  trackingQuota?: { minute?: string; day?: string; month?: string };
  requestLimit?: { second?: string };
}

/**
 * Servicio de tracking DHL vía WhereParcel (https://whereparcel.com/docs).
 * Reemplaza a 17TRACK. A diferencia de 17TRACK (register → poll → delete), aquí
 * cada POST /v2/track devuelve el estatus directamente; NO hay alta/baja ni
 * "slots" de quota: el plan da 10,000 LLAMADAS/mes (cada request ≤ 5 guías).
 */
@Injectable()
export class WhereParcelDhlService {
  private readonly logger = new Logger(WhereParcelDhlService.name);

  private readonly apiKey = process.env.WHEREPARCEL_API_KEY || '';
  private readonly secretKey = process.env.WHEREPARCEL_SECRET_KEY || '';
  private readonly baseUrl = process.env.WHEREPARCEL_BASE_URL || 'https://api.whereparcel.com';
  private readonly trackUrl = `${this.baseUrl}/v2/track`;
  /**
   * Código de carrier DHL en WhereParcel. Tracking desde México con DHL Global →
   * `intl.dhl` (DHL internacional; no existe `mx.dhl`). Ajustable por env.
   */
  private readonly dhlCarrier = process.env.WHEREPARCEL_DHL_CARRIER || 'intl.dhl';
  /** Tope mensual del plan (informativo/fallback si no hay header). */
  private readonly monthlyCap = Number(process.env.WHEREPARCEL_MONTHLY_CAP) || 10000;
  /** WhereParcel acepta máximo 5 guías por request en /v2/track. */
  private readonly maxBatchSize = 5;
  /** WhereParcel acepta máximo 100 trackingItems por request en /v2/webhooks/register. */
  private readonly maxRegisterBatch = 100;
  /**
   * Espaciado mínimo entre requests. WhereParcel exige ≥3s entre llamadas
   * (429 RATE_LIMIT_EXCEEDED si no). Default 3500ms con margen.
   */
  private readonly minRequestGapMs = Number(process.env.WHEREPARCEL_MIN_REQUEST_GAP_MS) || 3500;
  /** Intentos por request (incluye el primero) ante errores transitorios (429/5xx/red). */
  private readonly maxAttempts = Number(process.env.WHEREPARCEL_MAX_ATTEMPTS) || 3;
  /** Tope de espera entre reintentos. Cap del `retry_after` (que puede ser 60s) para no colgar el HTTP. */
  private readonly maxBackoffMs = Number(process.env.WHEREPARCEL_MAX_BACKOFF_MS) || 12000;
  /** Timeout por request (los proveedores tipo Puppeteer pueden tardar bastante). */
  private readonly requestTimeoutMs = Number(process.env.WHEREPARCEL_TIMEOUT_MS) || 60000;
  private readonly localTimezone = 'America/Hermosillo';

  /** Snapshot de uso REAL reportado por WhereParcel en `trackingQuota` (used/total). */
  private qMonthUsed: number | null = null;
  private qMonthTotal: number | null = null;
  private qDayUsed: number | null = null;
  /** Cuándo se capturó el uso por última vez (para saber si está viejo). */
  private usageFetchedAt = 0;
  /** Cache del endpointId del webhook (creado/encontrado en esta corrida). */
  private endpointIdCache: string | null = null;

  private get authHeader(): string {
    return `Bearer ${this.apiKey}:${this.secretKey}`;
  }

  private get headers() {
    return { Authorization: this.authHeader, 'Content-Type': 'application/json' };
  }

  private ensureConfigured() {
    if (!this.apiKey || !this.secretKey) {
      this.logger.error('Faltan WHEREPARCEL_API_KEY / WHEREPARCEL_SECRET_KEY en el entorno.');
      throw new HttpException(
        'Configuración faltante: WHEREPARCEL_API_KEY y WHEREPARCEL_SECRET_KEY deben estar definidas.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Captura el uso REAL desde `body.trackingQuota` (p.ej. month "89/10000",
   * day "89/10000"). Es la cuenta autoritativa de WhereParcel (durable; viene en
   * cada respuesta). No usamos los headers X-RateLimit (vienen vacíos).
   */
  private captureUsage(body: WhereParcelTrackResponse) {
    const tq = body?.trackingQuota;
    const parse = (s?: string): [number, number] | null => {
      if (typeof s !== 'string' || !s.includes('/')) return null;
      const [u, t] = s.split('/').map((x) => Number(x));
      return Number.isFinite(u) && Number.isFinite(t) ? [u, t] : null;
    };
    const m = parse(tq?.month);
    if (m) { this.qMonthUsed = m[0]; this.qMonthTotal = m[1]; }
    const d = parse(tq?.day);
    if (d) this.qDayUsed = d[0];
    if (m || d) this.usageFetchedAt = Date.now();
  }

  /** ¿El snapshot de uso está viejo (o nunca se capturó)? */
  public isUsageStale(maxAgeMs = 600000): boolean {
    return Date.now() - this.usageFetchedAt > maxAgeMs;
  }

  /**
   * Consulta estatus de varias guías DHL. Devuelve resultados normalizados (mismo
   * shape que consumía 17TRACK). `opts.skipRegister` se acepta por compatibilidad
   * de firma con el código existente, pero en WhereParcel NO aplica (no hay alta).
   */
  public async fetchTrackingStatuses(
    trackingNumbers: string[],
    _opts: { skipRegister?: boolean } = {},
  ): Promise<NormalizedTrackingResult[]> {
    this.ensureConfigured();

    const currentLocalTime = dayjs().tz(this.localTimezone).format('YYYY-MM-DD HH:mm:ss');
    const numbers = (trackingNumbers || []).map((n) => `${n}`.trim()).filter(Boolean);
    if (numbers.length === 0) return [];

    this.logger.log(`Consultando ${numbers.length} guías DHL en WhereParcel (${currentLocalTime}).`);

    const results: NormalizedTrackingResult[] = [];
    const batches = this.chunk(numbers, this.maxBatchSize);

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];

      // Guard de presupuesto: si ya no queda cupo del mes, paramos (no gastamos de más).
      const capTotal = this.qMonthTotal ?? this.monthlyCap;
      const capUsed = this.qMonthUsed ?? 0;
      if (capTotal - capUsed <= 0) {
        this.logger.warn(`WhereParcel: sin cupo mensual (${capUsed}/${capTotal}); se detiene el ciclo.`);
        break;
      }

      // Rate limit: ≥3s entre llamadas (salvo el primer lote).
      if (bi > 0) await this.sleep(this.minRequestGapMs);

      const payload = {
        trackingItems: batch.map((trackingNumber) => ({
          carrier: this.dhlCarrier,
          trackingNumber,
        })),
      };

      const t0 = Date.now();
      this.logger.log(`➡️  [DHL] Lote ${bi + 1}/${batches.length} (${batch.length} guías): ${batch.join(', ')}`);

      let response;
      try {
        response = await this.postTrackWithRetry(payload);
      } catch (error: any) {
        // Tras agotar reintentos: no abortamos todo el lote, seguimos con el siguiente.
        // El cron volverá a intentar estas guías en el próximo ciclo.
        this.logger.error(
          `❌ [DHL] Lote ${bi + 1}/${batches.length} falló tras reintentos en ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
          `(code=${error?.code ?? '-'} status=${error?.response?.status ?? '-'}): ${error?.message}`,
        );
        continue;
      }

      const body = response.data;
      this.captureUsage(body);

      if (!Array.isArray(body?.results)) {
        this.logger.warn(`⚠️ [DHL] Lote ${bi + 1}: sin results → ${JSON.stringify(body?.error ?? body).slice(0, 200)}`);
        continue;
      }

      let ok = 0, failed = 0, cached = 0, billable = 0;
      const reasons: Record<string, number> = {};
      for (const item of body.results) {
        if (item?.cached) cached++;
        if (item?.billable) billable++;
        // El item NO trae `success`; trae `status: 'success'|'failed'` y `data`.
        if (item?.status === 'failed' || !item?.data) {
          failed++;
          const reason = (item?.error?.message || item?.error?.code || item?.status || 'sin data').slice(0, 90);
          reasons[reason] = (reasons[reason] ?? 0) + 1;
          continue;
        }
        ok++;
        results.push(this.normalize(item, currentLocalTime));
      }

      const reasonStr = Object.entries(reasons)
        .map(([m, c]) => `${c}× ${m}`)
        .join(' | ');
      this.logger.log(
        `✅ [DHL] Lote ${bi + 1}/${batches.length} en ${((Date.now() - t0) / 1000).toFixed(1)}s · ok=${ok} fallidas=${failed} cache=${cached} cobradas=${billable} · uso mes ${this.qMonthUsed ?? '?'}/${this.qMonthTotal ?? '?'}` +
          (failed > 0 ? ` · motivos: ${reasonStr}` : ''),
      );
    }

    this.logger.log(`🏁 [DHL] WhereParcel: normalizadas ${results.length}/${numbers.length} guías DHL.`);
    return results;
  }

  /**
   * POST /v2/track con reintentos ante errores TRANSITORIOS: 429 (rate limit),
   * 5xx (502/503/504 — Cloudflare/origen sobrecargado, `retryable:true`) y errores
   * de red. Honra `retry_after` (segundos) pero lo capa en `maxBackoffMs` para no
   * colgar el HTTP (el 502 sugiere 60s; el siguiente ciclo del cron reintentará).
   * Los 4xx NO transitorios (p.ej. 401/400) se lanzan de inmediato.
   */
  /**
   * Ejecuta una llamada HTTP con reintentos ante errores TRANSITORIOS (429, 5xx
   * incl. 502 Cloudflare `retryable:true`, y errores de red). Honra `retry_after`
   * capado en `maxBackoffMs`. Genérico: lo usan track, list/create endpoint y register.
   */
  private async withRetry(label: string, fn: () => Promise<any>): Promise<any> {
    let lastErr: any;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status;
        const body = err?.response?.data;
        const isNetwork = !err?.response;
        const retryable =
          isNetwork ||
          status === 429 ||
          (typeof status === 'number' && status >= 500 && status <= 599) ||
          body?.retryable === true;

        if (!retryable || attempt === this.maxAttempts) throw err;

        const retryAfterSec = Number(body?.retry_after ?? body?.error?.retryAfter ?? 0);
        // Nunca por debajo del mínimo de 3s de la cuenta; sube con el intento; capado.
        const base = Math.max(retryAfterSec * 1000, this.minRequestGapMs * attempt);
        const waitMs = Math.min(base, this.maxBackoffMs);
        this.logger.warn(
          `WhereParcel ${label} ${status ?? `network-error(${err?.code ?? '-'})`} (intento ${attempt}/${this.maxAttempts}); reintentando en ${waitMs}ms…`,
        );
        await this.sleep(waitMs);
      }
    }
    throw lastErr;
  }

  private async postTrackWithRetry(payload: unknown) {
    return this.withRetry('track', () =>
      axios.post<WhereParcelTrackResponse>(this.trackUrl, payload, {
        headers: this.headers,
        timeout: this.requestTimeoutMs,
      }),
    );
  }

  /**
   * Registra guías DHL para recibir webhooks (push) ante cambios de estatus.
   * `recurring:true` = suscripción continua hasta entrega. Lotes de 100 (límite
   * real de WhereParcel). Es BILLABLE (cuesta cuota al registrar), pero luego no hay
   * polling: WhereParcel nos empuja solo los ~5-10 cambios de cada guía.
   * Requiere `WHEREPARCEL_WEBHOOK_ENDPOINT_ID` (creado en el dashboard apuntando
   * a nuestro callback). Devuelve qué trackingNumbers quedaron registrados.
   */
  /** URL pública de callback (normaliza el base para no duplicar /api). */
  public buildCallbackUrl(): string | null {
    const base = (process.env.WHEREPARCEL_WEBHOOK_BASE_URL || '')
      .replace(/\/+$/, '')
      .replace(/\/api$/i, '');
    const secret = process.env.WHEREPARCEL_WEBHOOK_SECRET || '';
    if (!base || !secret) return null;
    return `${base}/api/webhooks/whereparcel/${secret}`;
  }

  /**
   * Garantiza que exista el "webhook endpoint" en WhereParcel y devuelve su id.
   * Orden: env `WHEREPARCEL_WEBHOOK_ENDPOINT_ID` → cache → buscar uno existente
   * con la MISMA url (GET) → crear (POST). Así no hay que tocar el dashboard.
   */
  public async ensureWebhookEndpoint(): Promise<string> {
    this.ensureConfigured();
    const envId = process.env.WHEREPARCEL_WEBHOOK_ENDPOINT_ID;
    if (envId) return envId;
    if (this.endpointIdCache) return this.endpointIdCache;

    const callbackUrl = this.buildCallbackUrl();
    if (!callbackUrl) {
      throw new HttpException(
        'Define WHEREPARCEL_WEBHOOK_BASE_URL y WHEREPARCEL_WEBHOOK_SECRET en .env.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 1) ¿Ya existe uno con esa URL? (evita duplicados al reiniciar)
    try {
      const { data } = await this.withRetry('list-endpoints', () =>
        axios.get(`${this.baseUrl}/v2/webhook-endpoints`, {
          headers: this.headers,
          timeout: this.requestTimeoutMs,
        }),
      );
      const list = Array.isArray(data?.data) ? data.data : [];
      const found = list.find((e: any) => e?.url === callbackUrl && e?.isActive !== false);
      if (found?.endpointId) {
        this.endpointIdCache = found.endpointId;
        this.logger.log(`📡 [DHL] Webhook endpoint existente: ${found.endpointId}`);
        return found.endpointId;
      }
    } catch (e: any) {
      this.logger.warn(`No se pudo listar webhook-endpoints (se intentará crear): ${e?.message}`);
    }

    // 2) Crear uno nuevo (espaciado tras el GET para respetar el mínimo de 3s).
    await this.sleep(this.minRequestGapMs);
    const { data } = await this.withRetry('create-endpoint', () =>
      axios.post(
        `${this.baseUrl}/v2/webhook-endpoints`,
        { name: 'PMY DHL Tracking', url: callbackUrl, description: 'Callback DHL (WhereParcel) PMY/Bachoco' },
        { headers: this.headers, timeout: this.requestTimeoutMs },
      ),
    );
    const id = data?.data?.endpointId;
    if (!id) {
      throw new HttpException(
        `No se pudo crear el webhook endpoint: ${JSON.stringify(data).slice(0, 200)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    this.endpointIdCache = id;
    this.logger.log(
      `📡 [DHL] Webhook endpoint CREADO: ${id} → ${callbackUrl}. (Opcional: fíjalo en WHEREPARCEL_WEBHOOK_ENDPOINT_ID.)`,
    );
    return id;
  }

  public async registerForWebhooks(
    items: { trackingNumber: string; clientId?: string }[],
  ): Promise<{ registered: string[]; failed: string[] }> {
    this.ensureConfigured();
    const endpointId = await this.ensureWebhookEndpoint();
    const clean = (items || []).filter((i) => i?.trackingNumber);
    const registered: string[] = [];
    const failed: string[] = [];
    const batches = this.chunk(clean, this.maxRegisterBatch);

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];

      // SALVAGUARDA: nunca pasar del cupo mensual del plan (evita cualquier exceso).
      const u = this.getUsage();
      if (u.total - u.used <= 0) {
        this.logger.warn(
          `WhereParcel: sin cupo mensual (${u.used}/${u.total}); se DETIENE el registro para no exceder el plan.`,
        );
        break;
      }

      if (bi > 0) await this.sleep(this.minRequestGapMs);

      // Normaliza JJD→JD: intl.dhl rechaza el prefijo JJD ("invalid item"). Se
      // mantiene el mapeo enviado→original para marcar/loguear por el dhlUniqueId real.
      let pending = batch.map((i) => ({
        original: i.trackingNumber,
        send: i.trackingNumber.startsWith('JJD') ? i.trackingNumber.substring(1) : i.trackingNumber,
        clientId: i.clientId,
      }));

      // La API rechaza el LOTE COMPLETO si una sola guía es inválida. Quitamos las
      // inválidas (vienen en `invalidItems`) y reintentamos el resto, para no perder
      // las buenas. Cap de rondas por si reporta nuevas inválidas cada vez.
      let round = 0;
      while (pending.length > 0 && round < 3) {
        round++;
        if (round > 1) await this.sleep(this.minRequestGapMs);
        const payload = {
          recurring: true,
          webhookEndpointId: endpointId,
          trackingItems: pending.map((p) => ({ carrier: this.dhlCarrier, trackingNumber: p.send, clientId: p.clientId })),
        };
        try {
          const r = await this.withRetry('register', () =>
            axios.post<WhereParcelTrackResponse & { subscriptionId?: string }>(
              `${this.baseUrl}/v2/webhooks/register`,
              payload,
              { headers: this.headers, timeout: this.requestTimeoutMs },
            ),
          );
          this.captureUsage(r.data as WhereParcelTrackResponse);
          registered.push(...pending.map((p) => p.original));
          this.logger.log(
            `📡 [DHL] ${pending.length} guías registradas a webhook (sub ${(r.data as any)?.subscriptionId ?? '-'}).`,
          );
          pending = [];
        } catch (e: any) {
          const status = e?.response?.status;
          const body = e?.response?.data;
          const invalid = Array.isArray(body?.invalidItems) ? body.invalidItems : null;
          if (status === 400 && invalid && invalid.length > 0) {
            const badSent = new Set(invalid.map((ii: any) => `${ii?.trackingNumber}`));
            const bad = pending.filter((p) => badSent.has(p.send));
            failed.push(...bad.map((p) => p.original));
            pending = pending.filter((p) => !badSent.has(p.send));
            this.logger.warn(`Registro webhook: ${bad.length} guía(s) inválida(s) removida(s); reintentando ${pending.length}.`);
            continue;
          }
          // Error no relacionado a items inválidos: el resto del lote falla.
          failed.push(...pending.map((p) => p.original));
          this.logger.error(`Error registrando webhook: ${e?.message}. ${JSON.stringify(body).slice(0, 200)}`);
          pending = [];
        }
      }
    }
    return { registered, failed };
  }

  /**
   * Convierte el PAYLOAD entrante de un webhook de WhereParcel al shape normalizado
   * que consume `persistDhlTrackingResults`. El webhook trae `currentStatus` arriba
   * y `trackingData.{status,events}` (ojo: aquí el estatus es `status`, no
   * `deliveryStatus` como en /v2/track).
   */
  public normalizeWebhook(payload: any): NormalizedTrackingResult | null {
    const trackingNumber = payload?.trackingNumber;
    if (!trackingNumber) return null;
    const td = payload?.trackingData ?? {};
    const status = payload?.currentStatus || td?.status || td?.deliveryStatus || 'unknown';
    const events = Array.isArray(td?.events) ? td.events : [];
    const rawEvent = events.length
      ? events.reduce((a: any, c: any) =>
          new Date(c?.timestamp || 0).getTime() > new Date(a?.timestamp || 0).getTime() ? c : a,
        )
      : null;
    const latestEvent: TrackEvent | null = rawEvent
      ? {
          time: rawEvent.timestamp || '',
          description: rawEvent.description || rawEvent.statusText || '',
          location: rawEvent.location || '',
        }
      : null;
    return {
      trackingNumber: `${trackingNumber}`,
      currentStatus: status,
      subStatus: td?.statusText || null,
      latestEvent,
      localTimestamp: dayjs().tz(this.localTimezone).format('YYYY-MM-DD HH:mm:ss'),
      rawTrackingData: td,
    };
  }

  /** Uso del plan para Configuración. Usa la cuota REAL de WhereParcel (trackingQuota). */
  public getUsage(): WhereParcelUsage {
    const total = this.qMonthTotal ?? this.monthlyCap;
    const used = this.qMonthUsed ?? 0;
    const remaining = Math.max(0, total - used);
    return { total, used, remaining, todayUsed: this.qDayUsed ?? 0 };
  }

  /** Normaliza un item de WhereParcel al shape de la app. */
  private normalize(item: WhereParcelResultItem, localTimestamp: string): NormalizedTrackingResult {
    const data = item.data ?? null;
    // El estatus real de WhereParcel está en `deliveryStatus` (no `status`).
    const status = data?.deliveryStatus || data?.status || 'unknown';
    const subStatus = data?.statusText || null;

    // Evento más reciente: el de mayor timestamp (no asumimos orden del arreglo).
    const events = Array.isArray(data?.events) ? data!.events! : [];
    const rawEvent = events.length
      ? events.reduce((a, c) =>
          new Date(c.timestamp || 0).getTime() > new Date(a.timestamp || 0).getTime() ? c : a,
        )
      : null;

    const latestEvent: TrackEvent | null = rawEvent
      ? {
          time: rawEvent.timestamp || '',
          description: rawEvent.description || rawEvent.statusText || '',
          location: rawEvent.location || '',
        }
      : null;

    return {
      trackingNumber: item.trackingNumber,
      currentStatus: status,
      subStatus,
      latestEvent,
      localTimestamp,
      rawTrackingData: data,
    };
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
