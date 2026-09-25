/**
 * Solicitudes de la v2: no tenían renglones propios, solo las partidas de cada cotización. Para que el
 * comparativo por concepto y "Generar órdenes" funcionen tras migrar, se derivan renglones agrupando las
 * partidas iguales entre cotizaciones (mismo producto/servicio, o misma descripción normalizada).
 */
export interface LegacyQuoteItem {
  id: string;
  quoteId: string;
  productId: string | null;
  description: string;
  quantity: number;
  /** La cotización fue la ganadora (tiene orden). */
  winner: boolean;
}

export interface DerivedRequestItem {
  description: string;
  productId: string | null;
  quantity: number;
  quoteItemIds: string[];
  /** Partida de la cotización ganadora (queda como elegida en el comparativo). */
  selectedQuoteItemId: string | null;
}

const norm = (s: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function deriveLegacyRequestItems(items: LegacyQuoteItem[]): DerivedRequestItem[] {
  const groups = new Map<string, DerivedRequestItem>();
  for (const it of items) {
    const key = it.productId ? `p:${it.productId}` : `d:${norm(it.description)}`;
    let g = groups.get(key);
    if (!g) {
      g = { description: it.description.trim(), productId: it.productId, quantity: Number(it.quantity), quoteItemIds: [], selectedQuoteItemId: null };
      groups.set(key, g);
    }
    // Una partida por cotización en cada renglón (si una cotización repite el concepto, la extra va aparte).
    const sameQuote = items.some((o) => o.quoteId === it.quoteId && g!.quoteItemIds.includes(o.id));
    if (sameQuote) {
      const extraKey = `${key}#${it.id}`;
      groups.set(extraKey, { description: it.description.trim(), productId: it.productId, quantity: Number(it.quantity), quoteItemIds: [it.id], selectedQuoteItemId: it.winner ? it.id : null });
      continue;
    }
    g.quoteItemIds.push(it.id);
    g.quantity = Math.max(g.quantity, Number(it.quantity));
    if (it.winner && !g.selectedQuoteItemId) g.selectedQuoteItemId = it.id;
  }
  return [...groups.values()];
}
