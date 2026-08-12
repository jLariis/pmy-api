/**
 * Localizador determinista de código en el grafo de graphify. Lógica pura (sin
 * disco): dado el grafo cargado + pistas del ticket (route, menú, sección),
 * rankea archivos candidatos (páginas/secciones) y expande a los componentes
 * que importan. No adivina: usa `source_file` real y las aristas `imports`.
 */
import { CodeConfidence, CodeContext } from './prompt-builder';

export interface GraphNode {
  id: string;
  label?: string;
  source_file?: string;
}
export interface GraphLink {
  source: string;
  target: string;
  relation?: string;
}
export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface LocateHints {
  route?: string | null;
  /** Palabra(s) clave específicas (submenu, subsección, último segmento de ruta). */
  strong?: (string | null | undefined)[];
  /** Palabra(s) clave amplias (menú principal, sección). */
  weak?: (string | null | undefined)[];
  /** Texto libre del ticket (título, descripción, pasos) para extraer términos. */
  text?: (string | null | undefined)[];
}

export interface LocateOptions {
  maxFiles?: number;
  maxComponents?: number;
}

const DEFAULTS: Required<LocateOptions> = { maxFiles: 6, maxComponents: 8 };

function norm(s: string): string {
  return s.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/** '/operaciones/consolidados?x=1' → 'operaciones/consolidados'. */
export function routePath(route?: string | null): string {
  if (!route) return '';
  return route
    .split(/[?#]/)[0]
    .split('/')
    .filter(Boolean)
    .join('/')
    .toLowerCase();
}

function cleanKeywords(list: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    if (!raw) continue;
    for (const part of String(raw).toLowerCase().split(/[\/\s_-]+/)) {
      if (part.length >= 3) out.add(part);
    }
  }
  return [...out];
}

/** Palabras vacías (ES) y de UI genéricas que nunca deben usarse como pista de código. */
const STOPWORDS = new Set([
  'para', 'con', 'los', 'las', 'del', 'una', 'unos', 'unas', 'que', 'por', 'como', 'pero', 'sin',
  'sus', 'este', 'esta', 'esto', 'esos', 'esas', 'muy', 'mas', 'más', 'ya', 'aun', 'aún', 'hay',
  'son', 'fue', 'ser', 'estar', 'tiene', 'tienen', 'cuando', 'donde', 'porque', 'aparece', 'aparecen',
  'muestra', 'muestran', 'error', 'errores', 'falla', 'fallan', 'problema', 'ticket', 'usuario',
  'sistema', 'pantalla', 'boton', 'botón', 'campo', 'pagina', 'página', 'menu', 'menú', 'seccion',
  'sección', 'todos', 'todas', 'nuevo', 'nueva', 'guias', 'guías', 'guia', 'guía',
]);

/**
 * Extrae términos de texto libre del ticket que valen como pista de código:
 * tokens alfanuméricos de longitud útil, sin stopwords. Prioriza los que
 * "parecen código" (traen dígitos o mezclan may/min, p. ej. "stat44", "sin44").
 */
function textKeywords(list: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    if (!raw) continue;
    for (const tokenRaw of String(raw).split(/[^\p{L}\p{N}]+/u)) {
      const token = tokenRaw.toLowerCase();
      if (token.length < 4) continue;
      if (STOPWORDS.has(token)) continue;
      const looksLikeCode = /\d/.test(token) || /[a-z][A-Z]/.test(tokenRaw);
      // Acepta términos "de código" (con dígitos/camel) o palabras de dominio ≥5.
      if (looksLikeCode || token.length >= 5) out.add(token);
    }
  }
  return [...out];
}

/** Nombre de componente presentable: 'ConsolidadosTable.tsx'/'Foo()' → 'ConsolidadosTable'/'Foo'. */
function componentName(node: GraphNode): string {
  const base = (node.label ?? node.source_file ?? node.id).split('/').pop() ?? '';
  return base.replace(/\.(tsx|ts|jsx|js)$/i, '').replace(/\(\)$/, '').trim();
}

/** Clave de dedupe case-insensitive ('FooBar' y 'foo-bar' colapsan). */
function dedupeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Un símbolo ('Foo()') se prefiere sobre el nombre de archivo kebab. */
function isSymbolLabel(node: GraphNode): boolean {
  return /\(\)$/.test(node.label ?? '');
}

/**
 * Rankea nodos del grafo por relevancia a las pistas del ticket y expande a
 * componentes importados. Devuelve un `CodeContext` listo para el prompt.
 */
export function locateInGraph(
  graph: GraphData,
  hints: LocateHints,
  repo: string | null,
  opts: LocateOptions = {},
): CodeContext {
  const { maxFiles, maxComponents } = { ...DEFAULTS, ...opts };
  const rp = routePath(hints.route);
  const strong = cleanKeywords(hints.strong ?? []);
  const weak = cleanKeywords(hints.weak ?? []).filter((k) => !strong.includes(k));
  const text = textKeywords(hints.text ?? []).filter((k) => !strong.includes(k) && !weak.includes(k));

  let routeMatched = false;
  let strongMatched = false;
  let textMatched = false;

  type Scored = { node: GraphNode; score: number };
  const scored: Scored[] = [];

  for (const node of graph.nodes) {
    if (!node.source_file) continue;
    const sf = norm(node.source_file);
    let score = 0;

    if (rp && sf.includes(`app/${rp}`)) {
      score += 100;
      if (/page\.(tsx|ts|jsx|js)$/.test(sf)) score += 20;
      routeMatched = true;
    }
    for (const kw of strong) {
      if (sf.includes(kw)) {
        score += 40;
        strongMatched = true;
      }
    }
    // Términos del texto del ticket (descripción/título/pasos): señal intermedia.
    for (const kw of text) {
      if (sf.includes(kw)) {
        score += 25;
        textMatched = true;
      }
    }
    for (const kw of weak) if (sf.includes(kw)) score += 5;

    // Candidatos: ruta, keyword fuerte o término del texto. Los "débiles" solos
    // (p. ej. todo /operaciones) son demasiado amplios y no crean candidato.
    if (score >= 25) scored.push({ node, score });
  }

  scored.sort((a, b) => b.score - a.score);

  const confidence: CodeConfidence =
    routeMatched ? 'alta' : strongMatched || textMatched ? 'media' : 'ninguna';

  // Archivos (dedupe por source_file, respetando orden por score).
  const files: string[] = [];
  const seedIds = new Set<string>();
  for (const { node } of scored) {
    seedIds.add(node.id);
    const f = norm(node.source_file!);
    if (!files.includes(f)) files.push(f);
    if (files.length >= maxFiles) break;
  }

  // Expansión: componentes importados por los seeds. Excluye primitivos de UI
  // (`components/ui/`, shadcn) y colapsa símbolo/archivo del mismo componente,
  // prefiriendo el nombre en PascalCase del símbolo.
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const picked = new Map<string, string>();
  for (const link of graph.links) {
    if (!seedIds.has(link.source)) continue;
    if (!(link.relation ?? '').includes('import')) continue;
    const target = byId.get(link.target);
    const tsf = target?.source_file ? norm(target.source_file) : '';
    if (!tsf.includes('components/') || tsf.includes('components/ui/')) continue;
    const name = componentName(target!);
    if (!name) continue;
    const key = dedupeKey(name);
    if (!picked.has(key) || isSymbolLabel(target!)) picked.set(key, name);
  }
  const components = [...picked.values()].slice(0, maxComponents);

  return { repo: files.length ? repo : null, files, components, confidence };
}
