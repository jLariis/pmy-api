/**
 * Las 4 sugerencias por pieza/insumo: más comprado, mejor precio, mejor calidad y mejor relación
 * calidad-precio. Una misma oferta puede ganar varias etiquetas (sale una sola vez). Función pura.
 */

export type OfferLabel = 'mas_comprado' | 'mejor_precio' | 'mejor_calidad' | 'mejor_relacion';
export const OFFER_LABELS: OfferLabel[] = ['mas_comprado', 'mejor_precio', 'mejor_calidad', 'mejor_relacion'];

export interface OfferCandidate {
  offerId: string;
  productId: string;
  productName: string;
  brand: string | null;
  supplierId: string;
  supplierName: string;
  unitName: string | null;
  price: number;
  quality: number | null;
  /** Renglones en órdenes enviadas/completadas de este producto con este proveedor. */
  purchases: number;
}

export interface RankedOffer extends OfferCandidate {
  labels: OfferLabel[];
}

/** Estrellas supuestas cuando la oferta no tiene calificación. */
const DEFAULT_QUALITY = 3;

export function rankOffers(candidates: OfferCandidate[], opts: { preferredProductId?: string | null } = {}): RankedOffer[] {
  const list = candidates.filter((c) => Number(c.price) >= 0);
  if (!list.length) return [];
  const pref = opts.preferredProductId ?? null;
  const minPrice = Math.min(...list.map((c) => Number(c.price)).filter((p) => p > 0)) || 1;
  const relation = (c: OfferCandidate) => (c.quality ?? DEFAULT_QUALITY) / (Number(c.price) > 0 ? Number(c.price) / minPrice : 1);

  /** Desempate común: preferido de la ficha, luego más barato, luego id (estable). */
  const tie = (a: OfferCandidate, b: OfferCandidate) =>
    Number(b.productId === pref) - Number(a.productId === pref) || Number(a.price) - Number(b.price) || a.offerId.localeCompare(b.offerId);
  const best = (cmp: (a: OfferCandidate, b: OfferCandidate) => number, pool = list) =>
    pool.length ? [...pool].sort((a, b) => cmp(a, b) || tie(a, b))[0] : undefined;

  const winners: Array<[OfferLabel, OfferCandidate | undefined]> = [
    ['mas_comprado', best((a, b) => b.purchases - a.purchases, list.filter((c) => c.purchases > 0))],
    ['mejor_precio', best((a, b) => Number(a.price) - Number(b.price))],
    ['mejor_calidad', best((a, b) => Number(b.quality ?? 0) - Number(a.quality ?? 0), list.filter((c) => c.quality))],
    ['mejor_relacion', best((a, b) => relation(b) - relation(a))],
  ];

  const out = new Map<string, RankedOffer>();
  for (const [label, w] of winners) {
    if (!w) continue;
    const r = out.get(w.offerId) ?? { ...w, labels: [] };
    r.labels.push(label);
    out.set(w.offerId, r);
  }
  return [...out.values()];
}
