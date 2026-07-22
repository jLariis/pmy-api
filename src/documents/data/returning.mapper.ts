import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TZ = 'America/Hermosillo';

/** Espejo (subconjunto numérico) de `STATUS_TO_DEX_CODE` del frontend
 * (`utils/shipment-status.utils.ts`, usado por `getStatusCode`). El backend solo persiste
 * `Devolution.reason` (el exceptionCode de FedEx: '03'/'07'/'08'/'12'/'17'), no el `status`
 * textual completo que maneja el frontend en caliente (pre-guardado, p.ej. "direccion_incorrecta").
 * Por eso aquí solo se replica el subconjunto por código + el fallback fiel a `getStatusCode`
 * (si no matchea ningún código conocido, regresa el valor tal cual, en mayúsculas). */
const REASON_TO_DEX: Record<string, string> = {
  '03': 'DEX03',
  '07': 'DEX07',
  '08': 'DEX08',
  '12': 'DEX12',
  '17': 'DEX17',
};

/** Fiel a `getStatusCode` del frontend (pdf-generator.tsx / returning-excel-generator.tsx). */
export function mapReasonToDex(reason?: string | null): string {
  if (!reason) return 'N/A';
  const clean = String(reason).trim().toUpperCase();
  if (REASON_TO_DEX[clean]) return REASON_TO_DEX[clean];
  return clean; // fallback: regresa el valor tal cual (mayúsculas), fiel al `getStatusCode` original
}

export interface ReturningDevolutionPackage {
  trackingNumber: string;
  /** exceptionCode de FedEx ('03'/'07'/'08'/'12'/'17'), tal como lo persiste `Devolution.reason`. */
  reason?: string | null;
}

export interface ReturningCollectionPackage {
  trackingNumber: string;
}

export interface ReturningInput {
  subsidiaryName: string;
  devolutions: ReturningDevolutionPackage[];
  collections: ReturningCollectionPackage[];
  now?: Date;
}

/** Rellena `rows` hasta `target` con filas vacías (fiel a `renderEmptyRows` del frontend: SOLO
 * si ya hay al menos un dato; con 0 datos no se rellena nada). El índice de relleno alterna
 * `rowClass` continuando la paridad de las filas reales. */
function padRows<T extends Record<string, any>>(rows: T[], target: number, emptyRow: (i: number) => T): T[] {
  if (rows.length === 0) return [];
  const remaining = Math.max(0, target - rows.length);
  const filler = Array.from({ length: remaining }, (_, i) => emptyRow(rows.length + i));
  return [...rows, ...filler];
}

/** Data-provider "Devoluciones y Recolecciones" (C9 PDF + C10 Excel). Presentación en la
 * plantilla; toda la lógica de negocio (mapeo DEX, totales, relleno de filas) vive aquí. */
export function buildReturningData(input: ReturningInput): Record<string, any> {
  const now = input.now ?? new Date();
  const zonedNow = toZonedTime(now, TZ);
  const generatedDate = format(zonedNow, 'dd/MM/yyyy');

  const subsidiaryName = input.subsidiaryName || 'N/A';
  const subsidiaryNameUpper = subsidiaryName.toUpperCase();
  const subShort = subsidiaryName.substring(0, 3).toUpperCase();

  const devolutions = input.devolutions ?? [];
  const collections = input.collections ?? [];

  const totalDevoluciones = devolutions.length;
  const totalRecolecciones = collections.length;
  const totalGeneral = totalDevoluciones + totalRecolecciones;

  // Excel: tablas espejo SIN relleno (tal cual, fiel a `generateFedExExcel`).
  const devolucionRows = devolutions.map((d, i) => {
    const motivo = mapReasonToDex(d.reason);
    return {
      index: (i + 1) as number | string,
      trackingNumber: d.trackingNumber,
      motivo,
      isDex: motivo.includes('DEX') || motivo.includes('FRAUDE'),
    };
  });
  const recoleccionRows = collections.map((c, i) => ({
    trackingNumber: c.trackingNumber,
    sucursal: subShort,
    index: (i + 1) as number | string,
  }));

  // PDF: mismas filas + relleno hasta 15 (fiel a `renderEmptyRows`), con `rowClass` para el zebra.
  const withRowClass = <T extends Record<string, any>>(rows: T[]) =>
    rows.map((r, i) => ({ ...r, rowClass: i % 2 === 0 ? 'even' : '' }));
  const devolucionRowsPdf = withRowClass(
    padRows(devolucionRows, 15, (i) => ({ index: '', trackingNumber: '', motivo: '', isDex: false })),
  );
  const recoleccionRowsPdf = withRowClass(
    padRows(recoleccionRows, 15, (i) => ({ trackingNumber: '', sucursal: '', index: '' })),
  );

  // Leyenda DEX fija (fiel al footer del PDF y a la sección 5 del Excel).
  const dexLegend = [
    'DEX 03: DATOS INCORRECTOS / DOM NO EXISTE',
    'DEX 07: RECHAZO DE PAQUETES POR EL CLIENTE',
    'DEX 08: VISITA / DOMICILIO CERRADO',
    'DEX 17: CAMBIO DE FECHA SOLICITADO',
  ];

  return {
    subsidiaryName,
    subsidiaryNameUpper,
    generatedDate,
    totalDevoluciones,
    totalRecolecciones,
    totalGeneral,
    devolucionRows,
    recoleccionRows,
    devolucionRowsPdf,
    recoleccionRowsPdf,
    hasDevoluciones: devolucionRows.length > 0,
    hasRecolecciones: recoleccionRows.length > 0,
    dexLegend,
  };
}
