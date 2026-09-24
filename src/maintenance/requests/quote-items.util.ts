import { DEFAULT_TAX_RATE, deviationPct, itemAmount, round2, totals } from '../utils/money.util';

export interface QuoteItemInput {
  serviceId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
}

export interface BuiltQuoteItem {
  serviceId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  amount: number;
  referencePrice: number | null;
  deviationPct: number | null;
}

/**
 * Arma las partidas de una cotización: importe, snapshot del precio de referencia del catálogo y
 * % de desviación; más los totales. `referencePrices` = serviceId → precio de referencia vigente.
 */
export function buildQuoteItems(items: QuoteItemInput[], referencePrices: Map<string, number>) {
  const built: BuiltQuoteItem[] = items.map((i) => {
    const ref = i.serviceId ? referencePrices.get(i.serviceId) ?? null : null;
    const quantity = round2(Number(i.quantity));
    const unitPrice = round2(Number(i.unitPrice));
    return {
      serviceId: i.serviceId || null,
      description: i.description.trim(),
      quantity,
      unitPrice,
      taxRate: i.taxRate ?? DEFAULT_TAX_RATE,
      amount: itemAmount({ quantity, unitPrice }),
      referencePrice: ref,
      deviationPct: deviationPct(unitPrice, ref),
    };
  });
  return { items: built, ...totals(built) };
}
