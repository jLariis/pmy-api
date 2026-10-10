import { simpleParser, AddressObject } from 'mailparser';
import sanitizeHtml = require('sanitize-html');
import { createHash } from 'crypto';
import { cutQuotedHistory } from './text-normalize.util';
import { extractCobros, extractConsolidations } from './extract.util';
import { attachmentConsNumber, classifyByName, finalizeKinds, isSpreadsheet, summarizeWorkbook } from './attachment-classify.util';
import { AnnouncedCons, AttachmentKind, Cobro, ConsolidationKind, SheetSummary } from './inbox.types';

/**
 * Análisis de un correo crudo (RFC 822) sin tocar BD: datos del encabezado,
 * mensaje superior, consolidados y cobros anunciados, y adjuntos clasificados.
 */

export interface AnalyzedAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  size: number;
  sha256: string;
  kind: AttachmentKind;
  kindSource: 'nombre' | 'contenido';
  consNumber: string | null;
  summary: SheetSummary | null;
}

export interface MailConsolidation {
  consNumber: string;
  kind: ConsolidationKind;
  announcedCount: number | null;
}

export interface AnalyzedMail {
  messageId: string;
  fromAddress: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string;
  date: Date | null;
  textTop: string;
  /** Cuerpo completo en texto plano (con historial), tal cual. */
  textBody: string;
  hadHistory: boolean;
  /** Remitentes originales si es un reenvío (líneas De:/From: del historial). */
  forwardedFrom: string[];
  htmlSafe: string | null;
  attachments: AnalyzedAttachment[];
  consolidations: MailConsolidation[];
  cobros: Cobro[];
}

function addresses(a: AddressObject | AddressObject[] | undefined): string[] {
  const list = Array.isArray(a) ? a : a ? [a] : [];
  return list.flatMap((x) => x.value.map((v) => (v.address ?? '').toLowerCase())).filter(Boolean);
}

/** ¿El remitente es de un dominio permitido (o subdominio)? */
export function isAllowedSender(address: string, domains: string[]): boolean {
  const d = (address.split('@')[1] ?? '').toLowerCase().trim();
  if (!d) return false;
  return domains.some((x) => {
    const dom = x.toLowerCase().trim();
    return !!dom && (d === dom || d.endsWith(`.${dom}`));
  });
}

/** Paquetería de un correo de la bandeja. */
export type InboxCarrier = 'fedex' | 'dhl';

/** Paquetería según el dominio del remitente; null = no es de ninguna (se ignora). */
export function carrierOfSender(address: string, domains: { fedex: string[]; dhl: string[] }): InboxCarrier | null {
  if (isAllowedSender(address ?? '', domains.dhl)) return 'dhl';
  if (isAllowedSender(address ?? '', domains.fedex)) return 'fedex';
  return null;
}

/**
 * Remitentes ORIGINALES de un reenvío: correos en las líneas "De:" / "From:" del historial
 * citado (no Para/CC). Acepta HTML escapado (&lt;correo&gt;). En orden y sin repetir.
 */
export function quotedSenders(text: string): string[] {
  const out: string[] = [];
  const re = /^\s*(?:De|From)\s*:[^\n]*?([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gim;
  for (const m of String(text ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').matchAll(re)) {
    const addr = m[1].toLowerCase();
    if (!out.includes(addr)) out.push(addr);
  }
  return out;
}

/**
 * Paquetería con la que entra un correo:
 *  - el remitente directo manda (FedEx o DHL por dominio);
 *  - si no es de ninguna y `acceptForwardedDhl`, un REENVÍO cuyo original viene de un dominio
 *    DHL entra como DHL (hoy DHL manda sus archivos a hotmail y de ahí se reenvían a sistemas@).
 *    Es temporal: con INBOX_DHL_FORWARDED=false solo entra el dominio DHL directo.
 *  - null = se ignora.
 */
export function decideCarrier(
  mail: { fromAddress: string; forwardedFrom: string[] },
  domains: { fedex: string[]; dhl: string[] },
  acceptForwardedDhl: boolean,
): InboxCarrier | null {
  const direct = carrierOfSender(mail.fromAddress, domains);
  if (direct) return direct;
  if (acceptForwardedDhl && mail.forwardedFrom.some((a) => isAllowedSender(a, domains.dhl))) return 'dhl';
  return null;
}

/** Dominios por paquetería desde la configuración (INBOX_ALLOWED_DOMAINS = FedEx, INBOX_DHL_DOMAINS = DHL). */
export function inboxDomains(get: (k: string) => string | undefined): { fedex: string[]; dhl: string[] } {
  const list = (v: string | undefined, def: string) => (v || def).split(',').map((d) => d.trim()).filter(Boolean);
  return { fedex: list(get('INBOX_ALLOWED_DOMAINS'), 'fedex.com'), dhl: list(get('INBOX_DHL_DOMAINS'), 'dhl.com') };
}

export function sanitizeMailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.filter((t) => t !== 'img'),
    allowedAttributes: { a: ['href'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
  });
}

/** Consolidados del correo: los del cuerpo + números en nombres de archivo master/aéreo/valor/F2. */
export function mergeConsolidations(announced: AnnouncedCons[], atts: { kind: AttachmentKind; consNumber: string | null }[]): MailConsolidation[] {
  const out: MailConsolidation[] = announced.map((a) => ({ consNumber: a.consNumber, kind: a.kind, announcedCount: a.announcedCount }));
  // "valor" no es consolidado propio: sus guías se suben dentro del aéreo del mismo correo.
  const kindOf: Partial<Record<AttachmentKind, ConsolidationKind>> = { master: 'master', master_aereo: 'aereo', f2: 'f2', dhl: 'dhl' };
  for (const a of atts) {
    const k = kindOf[a.kind];
    if (!k || !a.consNumber) continue;
    if (out.some((o) => o.consNumber === a.consNumber)) continue;
    out.push({ consNumber: a.consNumber, kind: k, announcedCount: null });
  }
  return out;
}

export async function analyzeMail(source: Buffer, fallbackDate: Date | null = null): Promise<AnalyzedMail> {
  const p = await simpleParser(source);
  const from = p.from?.value?.[0];
  const text = p.text || '';
  const { top, hadHistory } = cutQuotedHistory(text);

  const raw = (p.attachments || []).filter((a) => !a.related || isSpreadsheet(a.filename ?? '')); // sin imágenes de firma
  const prelim = raw.map((a) => {
    const filename = a.filename || 'adjunto';
    const content = a.content as Buffer;
    const byName = classifyByName(filename);
    const summary = isSpreadsheet(filename) ? summarizeWorkbook(content) : null;
    return { a, filename, content, byName, summary };
  });
  const kinds = finalizeKinds(prelim.map((x) => ({ filename: x.filename, byName: x.byName, summary: x.summary })));
  const attachments: AnalyzedAttachment[] = prelim.map((x, i) => ({
    filename: x.filename,
    contentType: x.a.contentType || 'application/octet-stream',
    content: x.content,
    size: x.content.length,
    sha256: createHash('sha256').update(x.content).digest('hex'),
    kind: kinds[i],
    kindSource: x.byName && x.byName === kinds[i] ? 'nombre' : kinds[i] === 'ccp_ignored' ? 'nombre' : 'contenido',
    consNumber: attachmentConsNumber(x.filename, kinds[i], x.content),
    summary: x.summary,
  }));

  const html = typeof p.html === 'string' ? p.html : '';
  const messageId =
    p.messageId ||
    `<sin-id-${createHash('sha256').update(source).digest('hex').slice(0, 32)}@pmy>`;

  return {
    messageId,
    fromAddress: (from?.address ?? '').toLowerCase(),
    fromName: from?.name || null,
    to: addresses(p.to),
    cc: addresses(p.cc),
    subject: p.subject ?? '',
    date: p.date ?? fallbackDate,
    textTop: top,
    textBody: text,
    hadHistory,
    // Del texto plano; si el correo solo trae HTML, cada etiqueta cuenta como salto de línea.
    forwardedFrom: quotedSenders(text || html.replace(/<[^>]+>/g, '\n')),
    htmlSafe: html ? sanitizeMailHtml(html) : null,
    attachments,
    consolidations: mergeConsolidations(extractConsolidations(top), attachments),
    cobros: extractCobros(top),
  };
}
