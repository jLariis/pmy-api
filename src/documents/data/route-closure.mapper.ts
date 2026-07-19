import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TZ = 'America/Hermosillo';

/** Espejo de NOT_DELIVERED_STATUS_MAP (frontend `getDexCode`, lib/utils.ts). Usado en la columna
 * MOTIVO del PDF (izquierda). Ojo: es distinto de `exceptionCode` (usado por Excel/conteo DEX). */
const STATUS_TO_DEX: Record<string, string> = {
  direccion_incorrecta: 'DEX03',
  cliente_no_disponible: 'DEX08',
  rechazado: 'DEX07',
  cambio_fecha_solicitado: 'DEX17',
};

/** Fiel a `getDexCode` del frontend: mapea `status` → "DEX03"/"DEX07"/"DEX08"/"DEX17", o null. */
export function mapStatusToDex(status?: string): string | null {
  if (!status) return null;
  return STATUS_TO_DEX[status] ?? null;
}

export interface RouteClosurePackage {
  trackingNumber: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientPhone?: string;
  commitDateTime?: string;
  shipmentType?: string; // 'fedex' | 'dhl'
  status?: string; // ShipmentStatusType (p.ej. 'direccion_incorrecta')
  /** exceptionCode del último `statusHistory` (p.ej. '03','07','08','12'). Fuente de MOTIVO en Excel y del conteo DEX. */
  exceptionCode?: string;
  payment?: { amount: number | string; type: string } | null;
}

export interface RouteClosureNoVanPackage {
  trackingNumber: string;
  status?: string;
}

export interface RouteClosureInput {
  subsidiaryName: string;
  vehicleName?: string;
  drivers: { name: string }[];
  routes: { name: string }[];
  trackingNumber: string;
  /** Km al iniciar la ruta (PackageDispatch.kms). */
  kmsInitial?: string;
  /** Km al cerrar la ruta (RouteClosure.actualKms). */
  kmsFinal?: string;
  dispatchCreatedAt?: string | Date;
  /** Todos los paquetes originales del despacho (shipments + chargeShipments), fiel a `packageDispatchShipments`. */
  allPackages: RouteClosurePackage[];
  /** RouteClosure.returnedPackages (devueltos, ya persistidos como válidos). */
  returnedPackages: RouteClosurePackage[];
  /** RouteClosure.podPackages (entregados). */
  podPackages: RouteClosurePackage[];
  noVanPackages?: RouteClosureNoVanPackage[];
  /** RouteClosure.collections (guías de recolección, ya son trackingNumbers). */
  collections?: string[];
  now?: Date;
}

function isDhl(p: RouteClosurePackage): boolean {
  return (p.shipmentType || '').toLowerCase() === 'dhl';
}
function isFedex(p: RouteClosurePackage): boolean {
  return (p.shipmentType || '').toLowerCase() === 'fedex';
}

export function buildRouteClosureData(input: RouteClosureInput): Record<string, any> {
  const now = input.now ?? new Date();
  const zonedNow = toZonedTime(now, TZ);
  const generatedDate = format(zonedNow, 'yyyy-MM-dd');
  const generatedTime = format(zonedNow, 'HH:mm:ss');
  const closeDateTime = `${generatedDate} ${generatedTime}`;

  const dispatchDate = input.dispatchCreatedAt
    ? format(toZonedTime(new Date(input.dispatchCreatedAt), TZ), 'yyyy-MM-dd')
    : 'N/A';

  const mainDriver = input.drivers?.[0]?.name || 'No asignado';
  const routeNames = input.routes?.length ? input.routes.map((r) => r.name).join(', ') : 'No asignado';

  const allPackages = input.allPackages ?? [];
  const returnedPackages = input.returnedPackages ?? [];
  const podPackages = input.podPackages ?? [];
  const noVanPackages = input.noVanPackages ?? [];
  const collections = input.collections ?? [];

  const originalCount = allPackages.length;
  const noVanCount = noVanPackages.length;
  const podDeliveredCount = podPackages.length;
  const returnedCount = returnedPackages.length;
  const deliveredCount = Math.max(0, originalCount - returnedCount);
  const returnRate = originalCount > 0 ? (returnedCount / originalCount) * 100 : 0;
  const returnRateFmt = `${returnRate.toFixed(1)}%`;
  const returnRateHigh = returnRate > 20;

  const fedexTotal = allPackages.filter(isFedex).length;
  const dhlTotal = allPackages.filter(isDhl).length;
  const fedexDelivered = podPackages.filter(isFedex).length;
  const dhlDelivered = podPackages.filter(isDhl).length;
  const fedexReturned = returnedPackages.filter(isFedex).length;
  const dhlReturned = returnedPackages.filter(isDhl).length;

  // DEX (columna izquierda del PDF): 03/07/08 por `status`, 12 por `exceptionCode` (fiel al frontend).
  const dex03CountPdf = returnedPackages.filter((p) => p.status === 'direccion_incorrecta').length;
  const dex07CountPdf = returnedPackages.filter((p) => p.status === 'rechazado').length;
  const dex08CountPdf = returnedPackages.filter((p) => p.status === 'cliente_no_disponible').length;
  const dex12CountPdf = returnedPackages.filter((p) => p.exceptionCode === '12').length;

  // Conteo por código DEX (Excel, sección 4): íntegro vía `exceptionCode`.
  const dex03 = returnedPackages.filter((p) => p.exceptionCode === '03').length;
  const dex07 = returnedPackages.filter((p) => p.exceptionCode === '07').length;
  const dex08 = returnedPackages.filter((p) => p.exceptionCode === '08').length;
  const dex12 = returnedPackages.filter((p) => p.exceptionCode === '12').length;
  const dexOtros = returnedPackages.filter((p) => p.exceptionCode && !['03', '07', '08', '12'].includes(p.exceptionCode)).length;
  const dexSinCodigo = returnedPackages.filter((p) => !p.exceptionCode).length;

  const dexCounts = [
    { code: 'DEX-03', count: dex03, rowFill: 'F8F9FA' },
    { code: 'DEX-07', count: dex07, rowFill: null },
    { code: 'DEX-08', count: dex08, rowFill: 'F8F9FA' },
    { code: 'DEX-12', count: dex12, rowFill: null },
    { code: 'OTROS DEX', count: dexOtros, rowFill: 'F8F9FA' },
    { code: 'SIN CÓDIGO DEX', count: dexSinCodigo, rowFill: null },
    { code: 'TOTAL DEVOLUCIONES', count: returnedCount, rowFill: 'E8E8E8' },
  ];

  const returnedRows = returnedPackages.map((p, i) => {
    const z = p.commitDateTime ? toZonedTime(new Date(p.commitDateTime), TZ) : zonedNow;
    return {
      index: i + 1,
      trackingNumber: p.trackingNumber,
      shipmentTypeLabel: isDhl(p) ? 'DHL' : 'FedEx',
      motivoPdf: mapStatusToDex(p.status) || 'N/A',
      motivoExcel: p.exceptionCode ? `DEX-${p.exceptionCode}` : 'Devuelto',
      recipientName: p.recipientName || 'N/A',
      recipientPhone: p.recipientPhone || 'N/A',
      recipientAddress: p.recipientAddress || 'N/A',
      date: format(z, 'yyyy-MM-dd'),
      time: format(z, 'HH:mm:ss'),
      rowClass: i % 2 === 0 ? 'even' : '',
      rowFill: i % 2 === 0 ? 'F8F9FA' : null,
    };
  });
  // Total de "PAQUETES DEVUELTOS" (Excel): línea única fusionada (banda), no compartida con `returnedRows`
  // (el PDF itera `returnedRows` por paquete; agregar aquí un renglón de total lo corrompería).
  const returnedTotalRow = [`TOTAL DEVOLUCIONES: ${returnedCount}`];

  const noVanRows = noVanPackages.map((p) => ({ trackingNumber: p.trackingNumber, status: p.status || 'N/A' }));

  // `collectionRows` es de uso exclusivo de Excel (el PDF usa `collections`, lista plana en flex-wrap);
  // por eso sí puede llevar el renglón de TOTAL al final sin afectar al PDF.
  const collectionRows = collections.map((tn, i) => ({ index: i + 1, trackingNumber: tn, rowFill: i % 2 === 0 ? 'F8F9FA' : null }));
  if (collections.length > 0) {
    collectionRows.push({ index: 'TOTAL RECOLECCIONES' as any, trackingNumber: String(collections.length), rowFill: 'E8E8E8' });
  }

  // Cobros PDF: solo entregados (POD) con pago, fiel a `RouteClosurePDF` (usa `podPackages`).
  const podCharges = podPackages
    .filter((p) => p.payment?.amount != null)
    .map((p) => ({
      trackingNumber: p.trackingNumber,
      type: p.payment!.type || 'N/A',
      amountPdf: `$${p.payment!.amount}`,
    }));

  // Cobros Excel: TODOS los paquetes del despacho con pago, fiel a `generateRouteClosureExcel`
  // (usa `packageDispatchShipments`, no solo POD) — diferencia intencional entre PDF y Excel del frontend original.
  const allCharges: any[] = allPackages
    .filter((p) => p.payment?.amount != null)
    .map((p, i) => ({
      index: i + 1,
      trackingNumber: p.trackingNumber,
      amount: Number(p.payment!.amount) || 0,
      type: p.payment!.type || 'N/A',
      rowFill: i % 2 === 0 ? 'F8F9FA' : null,
    }));
  const allChargesTotal = allCharges.reduce((sum, c) => sum + c.amount, 0);
  if (allCharges.length > 0) {
    allCharges.push({ index: 'TOTAL COBROS', trackingNumber: '', amount: allChargesTotal, type: '', rowFill: 'E8E8E8' });
  }

  const generalInfoRows = [
    { label: 'Sucursal', value: input.subsidiaryName || 'N/A', rowFill: 'F8F9FA' },
    { label: 'Unidad', value: input.vehicleName || 'N/A', rowFill: null },
    { label: 'Conductor', value: mainDriver, rowFill: 'F8F9FA' },
    { label: 'Rutas', value: routeNames, rowFill: null },
    { label: 'Fecha Salida', value: dispatchDate, rowFill: 'F8F9FA' },
    { label: 'Km Inicial/Final', value: `${input.kmsInitial || 'N/A'} / ${input.kmsFinal || 'N/A'} km`, rowFill: null },
    { label: 'No. Seguimiento', value: input.trackingNumber || '', rowFill: 'F8F9FA' },
    { label: 'Total Paquetes', value: originalCount, rowFill: null },
    { label: 'Entregas Efectivas', value: deliveredCount, rowFill: 'F8F9FA' },
    { label: 'Fecha Cierre', value: closeDateTime, rowFill: null },
  ];

  const statsRows = [
    { label: 'PAQUETES EN SALIDA', value: originalCount, rowFill: 'F8F9FA' },
    { label: 'ENTREGAS EFECTIVAS', value: deliveredCount, rowFill: null },
    { label: 'PAQUETES DEVUELTOS', value: returnedCount, rowFill: 'F8F9FA' },
    { label: 'TASA DE DEVOLUCIÓN', value: returnRateFmt, rowFill: null },
    { label: 'PODs ENTREGADOS', value: podDeliveredCount, rowFill: 'F8F9FA' },
  ];

  return {
    title: 'CIERRE DE RUTA',
    subsidiaryName: input.subsidiaryName || 'N/A',
    vehicleName: input.vehicleName || 'N/A',
    mainDriver,
    routeNames,
    trackingNumber: input.trackingNumber || '',
    kmsInitial: input.kmsInitial || 'N/A',
    kmsFinal: input.kmsFinal || 'N/A',
    generatedDate,
    generatedTime,
    closeDateTime,
    dispatchDate,
    stats: {
      originalCount, noVanCount, podDeliveredCount, returnedCount, deliveredCount,
      returnRateFmt, returnRateHigh,
      fedexTotal, dhlTotal, fedexDelivered, dhlDelivered, fedexReturned, dhlReturned,
      dex03CountPdf, dex07CountPdf, dex08CountPdf, dex12CountPdf,
    },
    generalInfoRows,
    statsRows,
    dexCounts,
    returnedRows,
    returnedTotalRow,
    hasReturned: returnedRows.length > 0,
    noVanRows,
    hasNoVan: noVanRows.length > 0,
    collectionRows,
    collections,
    hasCollections: collections.length > 0,
    podCharges,
    hasPodCharges: podCharges.length > 0,
    allCharges,
    allChargesTotal,
    hasAllCharges: allCharges.length > 0,
  };
}
