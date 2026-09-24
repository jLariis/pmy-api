export interface MoneyItem {
  quantity: number;
  unitPrice: number;
  taxRate?: number | null;
  approved?: boolean;
}

export const DEFAULT_TAX_RATE = 0.16;

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Importe de la partida sin IVA. */
export const itemAmount = (i: MoneyItem): number => round2(Number(i.quantity) * Number(i.unitPrice));

/** Subtotal/IVA/total. Con `onlyApproved` ignora partidas con `approved === false`. */
export function totals(items: MoneyItem[], onlyApproved = false): { subtotal: number; tax: number; total: number } {
  const list = onlyApproved ? items.filter((i) => i.approved !== false) : items;
  let subtotal = 0;
  let tax = 0;
  for (const i of list) {
    const a = itemAmount(i);
    subtotal += a;
    tax += a * Number(i.taxRate ?? DEFAULT_TAX_RATE);
  }
  const s = round2(subtotal);
  const t = round2(tax);
  return { subtotal: s, tax: t, total: round2(s + t) };
}

/** % de desviación del precio cotizado vs la referencia del catálogo (null si no hay referencia). */
export function deviationPct(unitPrice: number, referencePrice?: number | null): number | null {
  if (!referencePrice || Number(referencePrice) <= 0) return null;
  return round2(((Number(unitPrice) - Number(referencePrice)) / Number(referencePrice)) * 100);
}
