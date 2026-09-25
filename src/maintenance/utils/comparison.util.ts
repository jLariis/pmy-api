import { lineTaxes } from './money.util';

export interface CmpRequestItem {
  id: string;
  /** 'item' = renglón de la solicitud; 'need' = necesidad ("Lo que se necesita"). */
  kind?: 'item' | 'need';
  description: string;
  productId?: string | null;
  quantity: number;
  selectedQuoteItemId?: string | null;
}

export interface CmpQuoteItem {
  id: string;
  requestItemId?: string | null;
  requestNeedId?: string | null;
  productId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  availability?: 'si' | 'no' | 'sobre_pedido' | string;
  leadTimeDays?: number | null;
  quality?: number | null;
  ivaEnabled?: boolean;
  iepsEnabled?: boolean;
  iepsRate?: number;
  taxRate?: number;
}

export interface CmpQuote {
  id: string;
  supplierId: string;
  supplierName: string;
  items: CmpQuoteItem[];
}

export interface CmpCell {
  quoteItemId: string;
  unitPrice: number;
  quantity: number;
  amount: number;
  total: number;
  availability: string;
  leadTimeDays: number | null;
  quality: number | null;
}

export interface CmpRow {
  /** Id del renglón o de la necesidad (según `kind`). */
  requestItemId: string;
  kind: 'item' | 'need';
  description: string;
  quantity: number;
  /** quoteId → celda (lo que cotizó ese proveedor para este renglón). */
  cells: Record<string, CmpCell>;
  bestQuoteItemId: string | null;
  /** Elección guardada o, si no hay, la propuesta (mejor precio con existencia). */
  selectedQuoteItemId: string | null;
}

export interface Comparison {
  quotes: Array<{ id: string; supplierId: string; supplierName: string; total: number; covered: number }>;
  rows: CmpRow[];
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Comparativo por partida: para cada renglón de la solicitud busca la partida de cada cotización
 * (por renglón → por producto → por descripción), marca el mejor precio unitario entre los proveedores
 * que tienen existencia (si nadie tiene, el más barato) y propone ese como ganador.
 */
export function compareByItem(items: CmpRequestItem[], quotes: CmpQuote[]): Comparison {
  const rows: CmpRow[] = items.map((ri) => {
    const cells: Record<string, CmpCell> = {};
    for (const q of quotes) {
      const free = (x: CmpQuoteItem) => !x.requestItemId && !x.requestNeedId;
      const qi = ri.kind === 'need'
        ? q.items.find((x) => x.requestNeedId === ri.id)
        : q.items.find((x) => x.requestItemId === ri.id)
          ?? (ri.productId ? q.items.find((x) => free(x) && x.productId === ri.productId) : undefined)
          ?? q.items.find((x) => free(x) && norm(x.description) === norm(ri.description));
      if (!qi) continue;
      const t = lineTaxes(qi);
      cells[q.id] = {
        quoteItemId: qi.id, unitPrice: Number(qi.unitPrice), quantity: Number(qi.quantity), amount: t.amount, total: t.total,
        availability: qi.availability ?? 'si', leadTimeDays: qi.leadTimeDays ?? null, quality: qi.quality ?? null,
      };
    }
    const all = Object.values(cells);
    const inStock = all.filter((c) => c.availability !== 'no');
    const pool = inStock.length ? inStock : all;
    const best = pool.length ? pool.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a)) : null;
    const saved = ri.selectedQuoteItemId && all.some((c) => c.quoteItemId === ri.selectedQuoteItemId) ? ri.selectedQuoteItemId : null;
    return {
      requestItemId: ri.id, kind: ri.kind ?? 'item', description: ri.description, quantity: Number(ri.quantity), cells,
      bestQuoteItemId: best?.quoteItemId ?? null, selectedQuoteItemId: saved ?? best?.quoteItemId ?? null,
    };
  });
  return {
    rows,
    quotes: quotes.map((q) => ({
      id: q.id, supplierId: q.supplierId, supplierName: q.supplierName,
      total: Math.round(rows.reduce((s, r) => s + (r.cells[q.id]?.total ?? 0), 0) * 100) / 100,
      covered: rows.filter((r) => r.cells[q.id]).length,
    })),
  };
}

/** Lo elegido, agrupado por proveedor: cada grupo será una orden de compra. */
export function groupSelectionBySupplier(c: Comparison, quotes: CmpQuote[]) {
  const byQuoteItem = new Map<string, CmpQuote>();
  for (const q of quotes) for (const i of q.items) byQuoteItem.set(i.id, q);
  const groups = new Map<string, { supplierId: string; quoteId: string; quoteItemIds: string[] }>();
  for (const r of c.rows) {
    if (!r.selectedQuoteItemId) continue;
    const q = byQuoteItem.get(r.selectedQuoteItemId);
    if (!q) continue;
    const g = groups.get(q.supplierId) ?? { supplierId: q.supplierId, quoteId: q.id, quoteItemIds: [] };
    g.quoteItemIds.push(r.selectedQuoteItemId);
    groups.set(q.supplierId, g);
  }
  return [...groups.values()];
}
