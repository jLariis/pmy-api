/**
 * "Lo que se necesita": arma la lista de piezas/insumos de una solicitud a partir de
 *  1) la receta de los servicios elegidos, 2) lo que escribió el usuario (palabras clave y sinónimos) y
 *  3) la ficha de la unidad (que manda producto preferido, cantidad y presentación).
 * Funciones puras; sin IA (decisión de diseño v4).
 */

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'y', 'a', 'al', 'en', 'con', 'por', 'se', 'le', 'lo', 'que', 'un', 'una']);
/** Terminaciones comunes (más largas primero) para comparar raíces: frenar ~ frenos, balata ~ balatas. */
const ENDINGS = ['ando', 'iendo', 'ado', 'ada', 'ido', 'ida', 'ar', 'er', 'ir', 'an', 'en', 'os', 'as', 'es', 'o', 'a', 'e', 's'];

export const normalize = (s: string): string =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const words = (s: string) => normalize(s).split(' ').filter((w) => w && !STOP.has(w));

const stem = (w: string) => {
  for (const e of ENDINGS) if (w.length - e.length >= 4 && w.endsWith(e)) return w.slice(0, -e.length);
  return w;
};

/** Misma palabra, o misma raíz de al menos 4 letras (frenar~frenos, balata~balatas; freno≁frente). */
export const similar = (a: string, b: string): boolean => {
  if (a === b) return true;
  const sa = stem(a);
  return sa.length >= 4 && sa === stem(b);
};

export interface KeywordEntry {
  id: string;
  name: string;
  keywords?: string | null;
}

/**
 * Entradas cuyo nombre o algún sinónimo aparece en el texto. Un sinónimo de varias palabras coincide si
 * aparecen todas. Regresa la primera palabra del texto que coincidió (para explicarle al usuario por qué).
 */
export function matchKeywords(text: string, entries: KeywordEntry[]): Array<{ id: string; matched: string }> {
  const tokens = words(text);
  if (!tokens.length) return [];
  const out: Array<{ id: string; matched: string }> = [];
  for (const e of entries) {
    const phrases = [e.name, ...(e.keywords ?? '').split(',')].map(words).filter((p) => p.length);
    for (const ph of phrases) {
      const hits = ph.map((w) => tokens.find((t) => similar(t, w)));
      if (hits.every(Boolean)) {
        out.push({ id: e.id, matched: hits[0]! });
        break;
      }
    }
  }
  return out;
}

export type NeedSource = 'receta' | 'ficha' | 'palabra' | 'manual';

export interface NeedDraft {
  categoryId: string;
  productId: string | null;
  quantity: number;
  unitId: string | null;
  source: NeedSource;
  sourceLabel: string;
}

export interface RecipeService {
  id: string;
  name: string;
  keywords?: string | null;
  items: Array<{ categoryId: string; quantity: number; unitId: string | null }>;
}

export interface SpecEntry {
  categoryId: string;
  productId: string | null;
  quantity: number;
  unitId: string | null;
}

export function buildNeeds(input: {
  chosen: RecipeService[];
  text: string;
  serviceCatalog: RecipeService[];
  categories: KeywordEntry[];
  spec: SpecEntry[];
}): NeedDraft[] {
  const { chosen, text, serviceCatalog, categories, spec } = input;
  const map = new Map<string, NeedDraft>();
  const add = (d: NeedDraft) => {
    if (!map.has(d.categoryId)) map.set(d.categoryId, d);
  };
  const fromRecipe = (s: RecipeService, source: NeedSource, label: string) => {
    for (const i of s.items) add({ categoryId: i.categoryId, productId: null, quantity: Number(i.quantity), unitId: i.unitId ?? null, source, sourceLabel: label });
  };

  for (const s of chosen) fromRecipe(s, 'receta', `Del servicio "${s.name}"`);

  if (normalize(text)) {
    const chosenIds = new Set(chosen.map((s) => s.id));
    const withRecipe = serviceCatalog.filter((s) => !chosenIds.has(s.id) && s.items.length);
    for (const m of matchKeywords(text, withRecipe)) {
      fromRecipe(withRecipe.find((s) => s.id === m.id)!, 'palabra', `Por lo que escribió: "${m.matched}"`);
    }
    for (const m of matchKeywords(text, categories)) {
      add({ categoryId: m.id, productId: null, quantity: 1, unitId: null, source: 'palabra', sourceLabel: `Por lo que escribió: "${m.matched}"` });
    }
  }

  // La ficha de la unidad manda: producto preferido, cantidad y presentación exactos para esa unidad.
  for (const n of map.values()) {
    const f = spec.find((x) => x.categoryId === n.categoryId);
    if (f) Object.assign(n, { productId: f.productId ?? null, quantity: Number(f.quantity), unitId: f.unitId ?? n.unitId });
  }
  return [...map.values()];
}
