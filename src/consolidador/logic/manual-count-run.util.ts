import type { Cause, DiagnosisRow } from './manual-count.types';

const MISSING: Cause[] = ['COBRO_FALTANTE', 'NOVAN_SIN_COBRO'];
const EXTRA: Cause[] = ['COBRO_DE_MAS', 'DUPLICADO', 'DOBLE_PAQUETE_CARGA'];

/** Totales de un conteo para guardarlos (manual_count_run) y mostrarlos en el Resumen. */
export function runTotals(rows: DiagnosisRow[], expectedCost: number) {
  const matched = rows.filter((r) => r.verdict === 'CUADRA').length;
  const sum = (causes: Cause[], cost: (r: DiagnosisRow) => number) =>
    rows.filter((r) => r.cause && causes.includes(r.cause)).reduce((s, r) => s + cost(r), 0);
  return {
    counted: new Set(rows.filter((r) => r.manual).map((r) => r.trackingNumber)).size,
    matched,
    differences: rows.length - matched,
    missingAmount: sum(MISSING, () => expectedCost),
    extraAmount: sum(EXTRA, (r) => Number(r.cost ?? expectedCost)),
  };
}
