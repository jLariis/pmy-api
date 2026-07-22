import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TZ = 'America/Hermosillo';

const STATUS_MAP: Record<string, string> = {
  en_ruta: 'En Ruta',
  en_bodega: 'En Bodega',
  entregado: 'Entregado',
  devuelto_a_fedex: 'Devuelto a FedEx',
  devuelto: 'Devuelto',
  pending: 'Pendiente',
  delivered: 'Entregado',
  no_entregado: 'No Entregado',
};

/** Fiel a `ShipmentsService.formatStatus` (legacy inline). */
function formatStatus(status?: string | null): string {
  if (!status) return 'N/A';
  return STATUS_MAP[status.toLowerCase()] || status;
}

/** Fiel a `ShipmentsService.calculateDaysWithout67` (legacy inline): días transcurridos desde
 * `firstStatusDate` hasta `now`, 0 si no hay fecha o el cálculo es inválido/negativo. */
function calculateDaysWithout67(firstStatusDate: string | Date | null | undefined, now: Date): number {
  if (!firstStatusDate) return 0;
  const first = new Date(firstStatusDate);
  const diffDays = Math.floor((now.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
  if (!Number.isFinite(diffDays)) return 0;
  return Math.max(0, diffDays);
}

/** Fiel a `ShipmentsService.formatExcelDate` (legacy inline), pero anclado a America/Hermosillo. */
function fmtDate(d?: string | Date | null): string {
  if (!d) return 'N/A';
  try {
    return format(toZonedTime(new Date(d), TZ), 'dd/MM/yyyy');
  } catch {
    return 'Fecha inválida';
  }
}

export interface ShipmentsNo67Item {
  trackingNumber?: string;
  currentStatus?: string;
  statusHistoryCount?: number;
  exceptionCodes?: string[];
  firstStatusDate?: Date | string | null;
  lastStatusDate?: Date | string | null;
  comment?: string;
}

export interface ShipmentsNo67Input {
  shipments: ShipmentsNo67Item[];
  now?: Date;
}

/** `buildShipmentsNo67Data` — data-provider de "Shipments sin código 67" (§B6). Espejo de
 * `ShipmentsService.exportNo67Shipments`. Recibe los shipments-sin-67 ya calculados por el
 * service (los ACCIONABLES: `category !== 'hoy'`, filtro que sigue haciendo el controller). */
export function buildShipmentsNo67Data(input: ShipmentsNo67Input): Record<string, any> {
  const now = input.now ?? new Date();
  const shipments = input.shipments ?? [];

  // ---- Hoja 1: filas de detalle con semáforo precomputado por celda ----
  const detailRows = shipments.map((s, i) => {
    const diasSin67 = calculateDaysWithout67(s.firstStatusDate, now);
    const esCritico = diasSin67 > 3;
    const esMuyCritico = diasSin67 > 7;
    const estadoActual = formatStatus(s.currentStatus);
    const estadoLower = estadoActual.toLowerCase();

    // Fila completa: gradiente rojo cuando crítico (>3 días); si no, zebra par/impar (fiel a
    // `esCritico`/`index % 2 === 0 && !esCritico` del legacy: mutuamente excluyentes).
    const rowFill = esCritico ? (esMuyCritico ? 'FFE6E6' : 'FFF0F0') : i % 2 === 0 ? 'F2F2F2' : null;
    const rowFont = esCritico ? (esMuyCritico ? '990000' : 'CC0000') : null;
    const rowBold = esCritico;

    // Semáforo por celda (col 3 estado, col 8 días): SOLO cuando no crítico -- el gradiente de
    // fila ya cubre esas columnas cuando es crítico (fiel al legacy: bloque `if (esCritico) {...}
    // else { columnas específicas }`).
    let estadoFill: string | null = null;
    let estadoFont: string | null = null;
    let diasFill: string | null = null;
    let diasFont: string | null = null;
    if (!esCritico) {
      if (estadoLower === 'en ruta') { estadoFill = 'FFF2CC'; estadoFont = '7F6000'; }
      else if (estadoLower === 'entregado') { estadoFill = 'E2F0D9'; estadoFont = '385723'; }
      else if (estadoLower === 'en bodega') { estadoFill = 'DEEBF7'; estadoFont = '2F5597'; }
      else if (estadoLower === 'devuelto' || estadoLower === 'devuelto a fedex') { estadoFill = 'F2F2F2'; estadoFont = '666666'; }

      // Fiel al legacy: `diasSin67 > 5` (inalcanzable aquí, pues !esCritico implica <=3) y
      // `diasSin67 > 2` (único caso real: diasSin67 === 3).
      if (diasSin67 > 5) { diasFill = 'FFE6E6'; diasFont = 'CC0000'; }
      else if (diasSin67 > 2) { diasFill = 'FFEB9C'; diasFont = '9C6500'; }
    }

    return {
      index: i + 1,
      trackingNumber: s.trackingNumber || 'N/A',
      estadoActual,
      statusHistoryCount: s.statusHistoryCount || 0,
      exceptionCodesLabel: (s.exceptionCodes ?? []).join(', ') || 'Ninguno',
      fechaPrimerEstado: fmtDate(s.firstStatusDate),
      fechaUltimoEstado: fmtDate(s.lastStatusDate),
      diasSinCodigo67: diasSin67 > 0 ? diasSin67.toString() : 'N/A',
      observaciones: s.comment || 'Sin observaciones',
      rowFill, rowFont, rowBold,
      estadoFill, estadoFont, diasFill, diasFont,
    };
  });

  // ---- Hoja 2: estadísticas generales ----
  const enBodegaCount = shipments.filter((s) => {
    const st = s.currentStatus?.toLowerCase() ?? '';
    return st.includes('bodega') || st.includes('pending');
  }).length;
  const enRutaCount = shipments.filter((s) => {
    const st = s.currentStatus?.toLowerCase() ?? '';
    return st.includes('ruta') || st.includes('en_ruta');
  }).length;
  const entregadosCount = shipments.filter((s) => {
    const st = s.currentStatus?.toLowerCase() ?? '';
    return st.includes('entregado') || st.includes('delivered');
  }).length;
  const devueltosCount = shipments.filter((s) => s.currentStatus?.toLowerCase().includes('devuelto')).length;

  const diasPorShipment = shipments.map((s) => calculateDaysWithout67(s.firstStatusDate, now));
  const criticosCount = diasPorShipment.filter((d) => d > 3).length;
  const alertaCount = diasPorShipment.filter((d) => d > 1 && d <= 3).length;
  const normalesCount = diasPorShipment.filter((d) => d <= 1).length;
  const totalDias = diasPorShipment.reduce((sum, d) => sum + d, 0);
  const promedioDiasLabel = shipments.length > 0 ? (totalDias / shipments.length).toFixed(1) : '0';

  // ---- Hoja 2: distribución de códigos de excepción (frecuencia desc) ----
  const codigosFrecuencia = new Map<string, number>();
  for (const s of shipments) {
    for (const codigo of s.exceptionCodes ?? []) {
      codigosFrecuencia.set(codigo, (codigosFrecuencia.get(codigo) || 0) + 1);
    }
  }
  const codigosRows =
    codigosFrecuencia.size > 0
      ? Array.from(codigosFrecuencia.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([codigo, frecuencia]) => ({ codigo, frecuencia }))
      : [{ codigo: 'No se encontraron códigos de excepción', frecuencia: '-' as const }];

  // ---- Hoja 2: top 5 más antiguos ----
  const topRows = shipments
    .map((s, i) => ({ s, dias: diasPorShipment[i] }))
    .sort((a, b) => b.dias - a.dias)
    .slice(0, 5)
    .map((x, i) => ({ label: `${i + 1}. ${x.s.trackingNumber}`, diasLabel: `${x.dias} días` }));

  const zoned = toZonedTime(now, TZ);

  return {
    generatedDateLabel: format(zoned, 'dd/MM/yyyy'),
    generatedTimeLabel: format(zoned, 'HH:mm:ss'),
    totalCount: shipments.length,
    detailRows,
    enBodegaCount,
    enRutaCount,
    entregadosCount,
    devueltosCount,
    promedioDiasLabel,
    criticosCount,
    alertaCount,
    normalesCount,
    codigosRows,
    topRows,
  };
}
