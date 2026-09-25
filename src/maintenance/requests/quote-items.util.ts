import { deviationPct, lineTaxes, round2, totals } from '../utils/money.util';

export interface QuoteItemInput {
  requestItemId?: string | null;
  requestNeedId?: string | null;
  productId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  availability?: 'si' | 'no' | 'sobre_pedido';
  leadTimeDays?: number | null;
  ivaEnabled?: boolean;
  iepsEnabled?: boolean;
  iepsRate?: number;
  quality?: number | null;
  /** Compat v1/v2: 0 = sin IVA. */
  taxRate?: number;
}

export interface BuiltQuoteItem {
  requestItemId: string | null;
  requestNeedId: string | null;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  availability: 'si' | 'no' | 'sobre_pedido';
  leadTimeDays: number | null;
  ivaEnabled: boolean;
  iepsEnabled: boolean;
  iepsRate: number;
  taxRate: number;
  quality: number | null;
  amount: number;
  referencePrice: number | null;
  deviationPct: number | null;
}

/**
 * Arma las partidas de una cotización: importe, impuestos por partida (IVA/IEPS), existencia, calidad y
 * desviación contra la referencia (mejor precio conocido del producto). `referencePrices` = productId → precio.
 */
export function buildQuoteItems(items: QuoteItemInput[], referencePrices: Map<string, number>) {
  const built: BuiltQuoteItem[] = items.map((i) => {
    const ref = i.productId ? referencePrices.get(i.productId) ?? null : null;
    const quantity = round2(Number(i.quantity));
    const unitPrice = round2(Number(i.unitPrice));
    const ivaEnabled = i.ivaEnabled ?? (i.taxRate !== undefined ? Number(i.taxRate) > 0 : true);
    const iepsEnabled = !!i.iepsEnabled;
    const availability = i.availability ?? 'si';
    return {
      requestItemId: i.requestItemId ?? null,
      requestNeedId: i.requestNeedId ?? null,
      productId: i.productId ?? null,
      description: i.description.trim(),
      quantity,
      unitPrice,
      availability,
      leadTimeDays: availability === 'sobre_pedido' ? i.leadTimeDays ?? null : null,
      ivaEnabled,
      iepsEnabled,
      iepsRate: iepsEnabled ? Number(i.iepsRate ?? 0) : 0,
      taxRate: ivaEnabled ? 0.16 : 0,
      quality: i.quality ?? null,
      amount: lineTaxes({ quantity, unitPrice }).amount,
      referencePrice: ref,
      deviationPct: deviationPct(unitPrice, ref),
    };
  });
  return { items: built, ...totals(built) };
}
