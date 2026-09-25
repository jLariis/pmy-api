/**
 * Importes e impuestos por partida (ESPEJO en app-pmy `lib/maintenance-money.ts` — mantener en sync).
 * - IEPS (si está activo) = importe × tasa.
 * - IVA 16% (si está activo) = (importe + IEPS) × 16%.
 * `taxRate` es el campo viejo (0.16 = con IVA, 0 = sin IVA) y se respeta si no viene `ivaEnabled`.
 */
export interface MoneyItem {
  quantity: number;
  unitPrice: number;
  ivaEnabled?: boolean | null;
  iepsEnabled?: boolean | null;
  iepsRate?: number | null;
  /** Compat v1/v2. */
  taxRate?: number | null;
  approved?: boolean;
}

export const DEFAULT_TAX_RATE = 0.16;
export const IVA_RATE = 0.16;
/** Tasas de IEPS más comunes (combustibles/bebidas/tabaco, etc.). */
export const IEPS_RATES = [0.08, 0.265, 0.3, 0.53];

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Importe de la partida sin impuestos. */
export const itemAmount = (i: MoneyItem): number => round2(Number(i.quantity) * Number(i.unitPrice));

export const ivaOn = (i: MoneyItem) => (i.ivaEnabled !== undefined && i.ivaEnabled !== null ? !!i.ivaEnabled : Number(i.taxRate ?? DEFAULT_TAX_RATE) > 0);

export function lineTaxes(i: MoneyItem): { amount: number; ieps: number; iva: number; total: number } {
  const amount = itemAmount(i);
  const ieps = i.iepsEnabled ? round2(amount * Number(i.iepsRate ?? 0)) : 0;
  const iva = ivaOn(i) ? round2((amount + ieps) * IVA_RATE) : 0;
  return { amount, ieps, iva, total: round2(amount + ieps + iva) };
}

/** Subtotal/IEPS/IVA/total. Con `onlyApproved` ignora partidas con `approved === false`. */
export function totals(items: MoneyItem[], onlyApproved = false): { subtotal: number; ieps: number; tax: number; total: number } {
  const list = onlyApproved ? items.filter((i) => i.approved !== false) : items;
  let subtotal = 0;
  let ieps = 0;
  let tax = 0;
  for (const i of list) {
    const t = lineTaxes(i);
    subtotal += t.amount;
    ieps += t.ieps;
    tax += t.iva;
  }
  const s = round2(subtotal);
  const e = round2(ieps);
  const t = round2(tax);
  return { subtotal: s, ieps: e, tax: t, total: round2(s + e + t) };
}

/** % de desviación del precio cotizado vs la referencia (null si no hay referencia). */
export function deviationPct(unitPrice: number, referencePrice?: number | null): number | null {
  if (!referencePrice || Number(referencePrice) <= 0) return null;
  return round2(((Number(unitPrice) - Number(referencePrice)) / Number(referencePrice)) * 100);
}
