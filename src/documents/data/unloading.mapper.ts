import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

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

function normalizeMissing(raw: (string | UnloadingMissingPackage)[]): UnloadingMissingPackage[] {
  return raw.map((m) => (typeof m === 'string' ? { trackingNumber: m } : m));
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
      rowFill: i % 2 === 0 ? 'F2F2F2' : null,
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
    title: 'DESEMBARQUE',
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
  };
}
