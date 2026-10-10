import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';

export interface RawMail {
  uid: number;
  uidValidity: string;
  source: Buffer;
  internalDate: Date | null;
}

export interface FetchPlan {
  mailbox: string;
  uidValidity: string | null; // el que teníamos guardado
  lastUid: number;
  backfillDays: number;
  maxPerRun: number;
}

/**
 * Lector IMAP de SOLO LECTURA del buzón de FedEx. Abre el buzón en modo
 * `readOnly` y descarga el `source` completo: nunca marca leído, mueve ni borra.
 */
@Injectable()
export class ImapReaderService {
  private readonly logger = new Logger(ImapReaderService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Credenciales IMAP. Si no hay INBOX_IMAP_*, se usa la misma cuenta SMTP del
   * sistema (EMAIL_SERVICE_*), que es sistemas@ en el mismo servidor de correo.
   */
  private creds(): { host?: string; user?: string; pass?: string } {
    const g = (k: string) => (this.config.get<string>(k) ?? '').toString().trim() || undefined;
    return {
      host: g('INBOX_IMAP_HOST') ?? g('EMAIL_SERVICE_HOST'),
      user: g('INBOX_IMAP_USER') ?? g('EMAIL_SERVICE_EMAIL'),
      pass: g('INBOX_IMAP_PASSWORD') ?? g('EMAIL_SERVICE_PASSWORD'),
    };
  }

  isConfigured(): boolean {
    const c = this.creds();
    return !!(c.host && c.user && c.pass);
  }

  account(): string | null {
    return this.creds().user ?? null;
  }

  mailbox(): string {
    return this.config.get<string>('INBOX_IMAP_MAILBOX') || 'INBOX';
  }

  private client(): ImapFlow {
    const c = this.creds();
    return new ImapFlow({
      host: c.host,
      port: Number(this.config.get('INBOX_IMAP_PORT') ?? 993),
      secure: String(this.config.get('INBOX_IMAP_TLS') ?? 'true') !== 'false',
      auth: { user: c.user as string, pass: c.pass as string },
      logger: false,
    });
  }

  /** Trae correos específicos por UID (para reintentos). */
  /** UIDs que cumplen una búsqueda del servidor IMAP (solo lectura), p. ej. { body: 'dhl.com' }. */
  async searchUids(mailbox: string, query: Record<string, unknown>): Promise<number[]> {
    const c = this.client();
    await c.connect();
    try {
      await c.mailboxOpen(mailbox, { readOnly: true });
      return (((await c.search(query as any, { uid: true })) || []) as number[]).sort((a, b) => a - b);
    } finally {
      await c.logout().catch((e) => this.logger.warn(`logout IMAP: ${e?.message ?? e}`));
    }
  }

  async fetchUids(mailbox: string, uids: number[]): Promise<RawMail[]> {
    if (!uids.length) return [];
    const c = this.client();
    await c.connect();
    try {
      const box = await c.mailboxOpen(mailbox, { readOnly: true });
      const uidValidity = String(box.uidValidity);
      const out: RawMail[] = [];
      for await (const m of c.fetch(uids.join(','), { uid: true, source: true, internalDate: true }, { uid: true })) {
        if (!m.source) continue;
        const d = m.internalDate ? new Date(m.internalDate as any) : null;
        out.push({ uid: m.uid, uidValidity, source: m.source, internalDate: d && !isNaN(d.getTime()) ? d : null });
      }
      return out;
    } finally {
      await c.logout().catch((e) => this.logger.warn(`logout IMAP: ${e?.message ?? e}`));
    }
  }

  /**
   * Trae los correos nuevos según el plan. Si el `uidValidity` del servidor cambió
   * (o es la primera vez) relee la ventana de backfill; los repetidos se descartan
   * después por messageId.
   */
  async fetchNew(plan: FetchPlan): Promise<{ uidValidity: string; mails: RawMail[]; reset: boolean }> {
    const c = this.client();
    await c.connect();
    try {
      const box = await c.mailboxOpen(plan.mailbox, { readOnly: true });
      const uidValidity = String(box.uidValidity);
      const reset = !plan.uidValidity || plan.uidValidity !== uidValidity || plan.lastUid <= 0;

      let uids: number[] = [];
      if (reset) {
        const since = new Date(Date.now() - plan.backfillDays * 86_400_000);
        uids = ((await c.search({ since }, { uid: true })) || []) as number[];
      } else {
        uids = ((await c.search({ uid: `${plan.lastUid + 1}:*` }, { uid: true })) || []) as number[];
        uids = uids.filter((u) => u > plan.lastUid); // "n:*" devuelve el último aunque n > max
      }
      uids.sort((a, b) => a - b);
      const batch = uids.slice(0, plan.maxPerRun);

      const mails: RawMail[] = [];
      if (batch.length) {
        for await (const m of c.fetch(batch.join(','), { uid: true, source: true, internalDate: true }, { uid: true })) {
          if (!m.source) continue;
          const d = m.internalDate ? new Date(m.internalDate as any) : null;
          mails.push({ uid: m.uid, uidValidity, source: m.source, internalDate: d && !isNaN(d.getTime()) ? d : null });
        }
      }
      mails.sort((a, b) => a.uid - b.uid);
      return { uidValidity, mails, reset };
    } finally {
      await c.logout().catch((e) => this.logger.warn(`logout IMAP: ${e?.message ?? e}`));
    }
  }
}
