import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TZ = 'America/Hermosillo';
const NO_PHONE = ['sin teléfono', 'sin telefono', 's/telefono', 's/teléfono', 's/tel', 'sin tel', 'not phone'];

export interface RouteDispatchPackage {
  trackingNumber: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientZip?: string;
  recipientPhone?: string;
  commitDateTime?: string;
  isCharge?: boolean;
  isHighValue?: boolean;
  payment?: { amount: number | string; type: string } | null;
  shipmentType?: string; // 'fedex' | 'dhl'
  consolidated?: { type?: string } | null;
}

export interface RouteDispatchInput {
  subsidiaryName: string;
  vehicleName?: string;
  drivers: { name: string }[];
  routes: { name: string }[];
  trackingNumber: string;
  packages: RouteDispatchPackage[];
  invalidTrackings?: string[];
  sortByPostalCode?: boolean; // default true
  now?: Date;
  createdAt?: string | Date;
}

/** Trunca a `a` (con '...') y luego el resultado a `b` (con '..'), fiel a C1. */
export function truncateDouble(s: string, a: number, b: number): string {
  const first = s.length > a ? s.slice(0, a - 3) + '...' : s;
  return first.length > b ? first.slice(0, b - 2) + '..' : first;
}

export function formatPhone(raw?: string): string {
  if (!raw || !String(raw).trim()) return 'N/A';
  if (NO_PHONE.includes(String(raw).trim().toLowerCase())) return '-';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('52')) digits = digits.slice(2);
  return digits;
}

/** Orden estable ascendente por CP; vacíos al final. */
export function sortByZip(pkgs: RouteDispatchPackage[]): RouteDispatchPackage[] {
  return [...pkgs].sort((x, y) => {
    const zx = (x.recipientZip || '').trim();
    const zy = (y.recipientZip || '').trim();
    if (!zx && !zy) return 0;
    if (!zx) return 1;
    if (!zy) return -1;
    const nx = Number(zx);
    const ny = Number(zy);
    if (!isNaN(nx) && !isNaN(ny) && nx !== ny) return nx - ny;
    return zx.localeCompare(zy);
  });
}

export function buildRouteDispatchData(input: RouteDispatchInput): Record<string, any> {
  const now = input.now ?? new Date();
  const zonedNow = toZonedTime(now, TZ);
  const generatedDate = format(zonedNow, 'yyyy-MM-dd');
  const generatedTime = format(zonedNow, 'HH:mm:ss');
  const dispatchAt = input.createdAt ? new Date(input.createdAt) : now;
  const dispatchDateTime = format(toZonedTime(dispatchAt, TZ), 'yyyy-MM-dd HH:mm');

  const ordered = input.sortByPostalCode === false ? input.packages : sortByZip(input.packages);

  const stats = {
    total: ordered.length, regularCount: 0, f2Count: 0, cargaCount: 0, highValueCount: 0,
    withPaymentCount: 0, totalPaymentAmount: 0, montoFmt: '$0.00', expiringTodayCount: 0, fedexCount: 0, dhlCount: 0,
  };

  let prevZone: string | null = null;
  const rows = ordered.map((p, i) => {
    const hasPayment = p.payment?.amount != null;
    if (p.isCharge) stats.f2Count++;
    if (p.isHighValue) { stats.cargaCount++; stats.highValueCount++; }
    if (hasPayment) { stats.withPaymentCount++; stats.totalPaymentAmount += Number(p.payment!.amount) || 0; }
    if (p.shipmentType === 'fedex') stats.fedexCount++;
    if (p.shipmentType === 'dhl') stats.dhlCount++;

    let date = '';
    let time = '';
    let isExpiringToday = false;
    if (p.commitDateTime) {
      const z = toZonedTime(new Date(p.commitDateTime), TZ);
      date = format(z, 'yyyy-MM-dd');
      time = format(z, 'HH:mm:ss');
      isExpiringToday = date === generatedDate;
      if (isExpiringToday) stats.expiringTodayCount++;
    }

    const icons = `${p.consolidated?.type === 'aereo' ? '[A]' : ''}${p.isCharge ? '[C]' : ''}${p.payment ? '[$]' : ''}${p.isHighValue ? '[H]' : ''}`;
    const zone = (p.recipientZip || '').slice(0, 2);
    const zoneChanged = input.sortByPostalCode !== false && i > 0 && zone !== prevZone;
    prevZone = zone;

    const rowClass = [i % 2 === 0 ? 'even' : '', hasPayment ? 'pago' : '', isExpiringToday ? 'vencehoy' : '', zoneChanged ? 'zone' : '']
      .filter(Boolean).join(' ');
    const rowFill = hasPayment ? 'fff2cc' : (i % 2 === 0 ? 'F2F2F2' : null);

    return {
      index: i + 1,
      icons,
      trackingNumber: p.trackingNumber,
      recipientName: truncateDouble(p.recipientName || '', 25, 22),
      recipientNameXlsx: p.recipientName || '',
      recipientAddress: truncateDouble(p.recipientAddress || '', 28, 26),
      recipientAddressXlsx: p.recipientAddress || '',
      recipientZip: p.recipientZip || '',
      paymentPdf: hasPayment ? `${p.payment!.type} $${p.payment!.amount}` : '',
      paymentXlsx: hasPayment ? `${p.payment!.type} $ ${p.payment!.amount}` : '',
      date,
      time,
      recipientPhone: formatPhone(p.recipientPhone),
      rowClass,
      rowFill,
    };
  });
  stats.regularCount = stats.total - stats.f2Count - stats.highValueCount;
  stats.montoFmt = `$${stats.totalPaymentAmount.toFixed(2)}`;

  const invalid = input.invalidTrackings ?? [];
  const invalidChunks: string[] = [];
  for (let i = 0; i < invalid.length; i += 6) {
    invalidChunks.push(invalid.slice(i, i + 6).map((t) => `📦 ${t}`).join('    '));
  }
  const invalidRows = invalid.map((t, i) => ({ index: rows.length + i + 1, trackingNumber: t }));

  return {
    title: 'SALIDA A RUTA',
    subsidiaryName: input.subsidiaryName || 'N/A',
    vehicleName: input.vehicleName || 'N/A',
    mainDriver: input.drivers?.[0]?.name || 'No asignado',
    routeNames: input.routes?.length ? input.routes.map((r) => r.name).join(' → ') : 'No asignado',
    driverNames: input.drivers?.length ? input.drivers.map((d) => d.name).join(' - ') : 'N/A',
    routeNamesArrow: input.routes?.length ? input.routes.map((r) => r.name).join(' -> ') : 'N/A',
    trackingNumber: input.trackingNumber,
    isHermosillo: (input.subsidiaryName || '').toLowerCase().includes('hermosillo'),
    generatedDate,
    generatedTime,
    dispatchDateTime,
    stats,
    rows,
    invalidRows,
    invalidChunks,
    hasInvalid: invalid.length > 0,
    invalidCount: invalid.length,
  };
}
