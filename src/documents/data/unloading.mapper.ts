import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { PMY_LOGO_DATA_URI, PMY_LOGO_PNG_BASE64, PMY_LOGO_WIDTH, PMY_LOGO_HEIGHT } from '../assets/pmy-logo';

const TZ = 'America/Hermosillo';
const CURRENCY_FMT = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

export interface UnloadingPackage {
  trackingNumber: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientZip?: string;
  recipientPhone?: string;
  commitDateTime?: string;
  isCharge?: boolean;
  isHighValue?: boolean;
  payment?: { amount: number | string; type: string } | null;
  /** Estatus actual (sin marca de vencimiento si ya se entregó o se devolvió a FedEx). */
  status?: string | null;
}

export interface UnloadingMissingPackage {
  trackingNumber: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientZip?: string;
  recipientPhone?: string;
}

export interface UnloadingInput {
  subsidiaryName: string;
  vehicleName?: string;
  trackingNumber: string;
  packages: UnloadingPackage[];
  /** Rico (objeto) si se dispone de datos del destinatario; string (bare) si solo hay tracking (caso real: Unloading.missingTrackings). */
  missingPackages?: (string | UnloadingMissingPackage)[];
  unScannedTrackings?: string[];
  now?: Date;
  createdAt?: string | Date;
  /** Quién hizo el desembarque (encabezado "Hecho por"). */
  createdByName?: string;
}

/** Trunca a `max` con '...' al exceder, fiel a C3 (frontend `truncate`). */
export function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

/** `${type} ${Intl es-MX MXN}` fiel a C3/C4 (mismo formato en PDF y Excel). Vacío si no hay monto. */
export function formatPaymentLabel(payment?: { amount: number | string; type: string } | null): string {
  if (!payment || payment.amount == null) return '';
  return `${payment.type} ${CURRENCY_FMT.format(Number(payment.amount))}`;
}

/** Semáforo del Excel, igual al de inventario: rojo = vence hoy, naranja = vence mañana. */
export const UNLOADING_URGENCY_STYLE = {
  today: { fill: 'FFC7CE', font: '9C0006' },
  tomorrow: { fill: 'FFD8A8', font: '8A4B00' },
} as const;

const NO_DUE_MARK = new Set(['entregado', 'entregado_por_fedex', 'entregado_en_bodega', 'devuelto_a_fedex']);

/** Vence hoy / mañana en días calendario de Hermosillo (null si no, o si ya no lo tenemos). */
export function commitUrgency(commitDateTime: string | undefined, now: Date, status?: string | null): 'today' | 'tomorrow' | null {
  if (!commitDateTime || NO_DUE_MARK.has(String(status ?? '').toLowerCase())) return null;
  const d = new Date(commitDateTime);
  if (Number.isNaN(d.getTime())) return null;
  const day = (x: Date) => {
    const z = toZonedTime(x, TZ);
    return Date.UTC(z.getFullYear(), z.getMonth(), z.getDate());
  };
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : null;
}

function normalizeMissing(raw: (string | UnloadingMissingPackage)[]): UnloadingMissingPackage[] {
  return raw.map((m) => (typeof m === 'string' ? { trackingNumber: m } : m));
}

/** Fondo/letra de la fila: semáforo de vencimiento o, si no vence, gris alternado. */
function rowStyle(urgency: 'today' | 'tomorrow' | null, i: number) {
  if (!urgency) return { rowFill: i % 2 === 0 ? 'F2F2F2' : null, rowFontColor: null, rowBold: false, urgency: null };
  const st = UNLOADING_URGENCY_STYLE[urgency];
  return { rowFill: st.fill, rowFontColor: st.font, rowBold: urgency === 'today', urgency };
}

export function buildUnloadingData(input: UnloadingInput): Record<string, any> {
  const now = input.now ?? new Date();
  const nowDateTime = format(toZonedTime(now, TZ), 'dd/MM/yyyy HH:mm');
  const createdAt = input.createdAt ? new Date(input.createdAt) : now;
  const createdDateTime = format(toZonedTime(createdAt, TZ), 'dd/MM/yyyy HH:mm');

  const packages = input.packages ?? [];
  const rows = packages.map((p, i) => {
    const icons = `${p.isCharge ? '[C]' : ''}${p.payment ? '[$]' : ''}${p.isHighValue ? '[H]' : ''}`;
    let date = '';
    let time = '';
    let timeXlsx = '';
    if (p.commitDateTime) {
      const z = toZonedTime(new Date(p.commitDateTime), TZ);
      date = format(z, 'dd/MM/yyyy');
      time = format(z, 'HH:mm');
      timeXlsx = format(z, 'HH:mm:ss');
    }
    return {
      index: i + 1,
      icons,
      trackingNumber: p.trackingNumber,
      recipientName: truncate(p.recipientName || '', 32),
      recipientNameXlsx: p.recipientName || '',
      recipientAddress: truncate(p.recipientAddress || '', 38),
      recipientAddressXlsx: p.recipientAddress || '',
      recipientZip: p.recipientZip || '',
      payment: formatPaymentLabel(p.payment),
      date,
      time,
      timeXlsx,
      recipientPhone: p.recipientPhone || '',
      ...rowStyle(commitUrgency(p.commitDateTime, now, p.status), i),
    };
  });

  const missing = normalizeMissing(input.missingPackages ?? []);
  const missingTrackings = missing.map((m) => m.trackingNumber);
  const missingRows = missing.map((m) => ({
    trackingNumber: m.trackingNumber,
    recipientName: m.recipientName || 'Sin Nombre',
    recipientAddress: m.recipientAddress || 'Sin Dirección',
    recipientZip: m.recipientZip || 'No CP',
    recipientPhone: m.recipientPhone || 'Sin Teléfono',
  }));

  const unScannedTrackings = input.unScannedTrackings ?? [];

  return {
    subsidiaryName: input.subsidiaryName || 'N/A',
    vehicleName: input.vehicleName || 'N/A',
    trackingNumber: input.trackingNumber || '',
    totalPackages: packages.length,
    nowDateTime,
    createdDateTime,
    rows,
    missingRows,
    missingTrackings,
    hasMissing: missingTrackings.length > 0,
    unScannedTrackings,
    hasUnScanned: unScannedTrackings.length > 0,
    // Encabezado tipo membrete (2026-11-18): rejilla de datos + logo a la izquierda.
    createdByName: input.createdByName || 'N/A',
    missingCount: missingTrackings.length,
    unScannedCount: unScannedTrackings.length,
    missingSummary: `${missingTrackings.length} / ${unScannedTrackings.length}`,
    // Logo de respaldo (la plantilla usa brand.logoLight si la marca tiene uno).
    logoSrc: PMY_LOGO_DATA_URI,
    logoBase64: PMY_LOGO_PNG_BASE64,
    logoWidth: PMY_LOGO_WIDTH,
    logoHeight: PMY_LOGO_HEIGHT,
  };
}
