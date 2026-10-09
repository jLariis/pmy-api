import { hermosilloDateTimeText } from '../common/hermosillo-text.util';
/**
 * Texto de WhatsApp que avisa a los grupos de monitoreo cuando alguien sube guías
 * desde la Bandeja de correos. Función pura (se prueba sin WhatsApp).
 */

export interface UploadSummary {
  saved?: number;
  recycled?: number;
  alreadyImported?: number;
  duplicated?: number;
  cobrosApplied?: number;
  cobrosUnmatched?: number;
  hvMarked?: number;
  hvFailed?: boolean;
}

export interface UploadMessageInput {
  userName: string;
  filename: string;
  sheet?: string | null;
  subsidiaryName: string;
  kind: 'master' | 'aereo' | 'f2';
  consNumber: string;
  consDate?: string | null; // YYYY-MM-DD
  fileRows?: number | null;
  summary: UploadSummary;
  cobrosInEmail?: number;
  email: { subject: string; from: string; receivedAt: Date };
  uploadedAt: Date;
}

const KIND: Record<UploadMessageInput['kind'], string> = { master: 'Carga master', aereo: 'Salida aérea', f2: 'F2 / carga' };
/** Siempre hora de Hermosillo: "07 de Octubre a las 12:39 p.m.". */
const fmt = (d: Date) => hermosilloDateTimeText(d);
const ddmmyyyy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const minutes = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
const human = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

export function buildUploadMessage(i: UploadMessageInput): string {
  const s = i.summary ?? {};
  const isF2 = i.kind === 'f2';
  const lines: string[] = [];
  lines.push('📦 *Subida desde la bandeja de correos*');
  lines.push(`👤 *${i.userName}* subió *${i.filename}*${i.sheet ? ` (hoja "${i.sheet}")` : ''}`);
  lines.push(`🏢 Sucursal: *${i.subsidiaryName}*`);
  lines.push(`🧾 ${KIND[i.kind]} · consolidado *${i.consNumber}*${i.consDate ? ` · fecha ${ddmmyyyy(i.consDate)}` : ''}`);

  const parts: string[] = [];
  if (i.fileRows != null) parts.push(`${i.fileRows} en el archivo`);
  if (s.saved != null) parts.push(`${s.saved} ${isF2 ? 'cargas F2 nuevas' : 'nuevos'}`);
  if (s.recycled) parts.push(`${s.recycled} reingresos`);
  if (s.alreadyImported) parts.push(`${s.alreadyImported} ya estaban`);
  if (s.duplicated) parts.push(`${s.duplicated} repetidos`);
  lines.push(`📊 ${isF2 ? 'Cargas' : 'Paquetes'}: ${parts.join(' · ') || 'sin datos'}`);

  const extra: string[] = [];
  if (!isF2) extra.push(s.hvFailed ? '💎 Alto valor: ⚠️ no se pudo marcar' : `💎 Alto valor: ${s.hvMarked ?? 0}`);
  if (s.cobrosApplied || s.cobrosUnmatched) {
    extra.push(`💵 Cobros: ${s.cobrosApplied ?? 0} aplicados${s.cobrosUnmatched ? ` · ⚠️ ${s.cobrosUnmatched} sin guía` : ''}`);
  } else {
    extra.push(i.cobrosInEmail ? `💵 Cobros: ${i.cobrosInEmail} en el pegado` : '💵 Sin cobros');
  }
  lines.push(extra.join('   '));

  lines.push(`📧 Correo "${i.email.subject}" de ${i.email.from} · llegó el ${fmt(i.email.receivedAt)} · subido a los ${human(minutes(i.email.receivedAt, i.uploadedAt))}`);
  return lines.join('\n');
}

/** Nombres de grupo por defecto si no se eligieron en Configuración. */
export const DEFAULT_UPLOAD_GROUPS = ['PMY (Monitoreo)', 'PMY (Monitore)', 'PMY Monitoreo', 'Sistemas PMY'];
