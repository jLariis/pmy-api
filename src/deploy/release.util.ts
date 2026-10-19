/**
 * Utilidades puras de versiones y notas de novedades (Configuración → Servidor → Actualizar).
 * Spec: docs/superpowers/specs/2026-10-18-actualizar-servidor-design.md
 */

export type Bump = 'patch' | 'minor' | 'major';
export type NoteKind = 'nuevo' | 'mejora' | 'rapido' | 'correccion';
export type NoteSource = 'api' | 'web';

const NOTE_KINDS: NoteKind[] = ['nuevo', 'mejora', 'rapido', 'correccion'];

export interface ReleaseNote {
  /** Id del archivo de nota (sin .json) o `commit-<sha7>` si salió de un commit sin nota. */
  id: string;
  kind: NoteKind;
  title: string;
  summary: string;
  where?: string;
  route?: string;
  steps?: string[];
  audience?: 'todos' | 'superadmin';
  source: NoteSource;
  /** true = borrador armado desde un commit sin nota (se marca "Sin nota" en la vista previa). */
  fromCommit?: boolean;
}

const parse = (v: string): [number, number, number] => {
  const [a, b, c] = String(v || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  return [a ?? 0, b ?? 0, c ?? 0];
};

export function bumpVersion(v: string, b: Bump): string {
  const [major, minor, patch] = parse(v);
  if (b === 'major') return `${major + 1}.0.0`;
  if (b === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Mayor si hay algo nuevo para usar; si solo hay correcciones/rapidez (o nada), menor. */
export function suggestBump(notes: ReleaseNote[]): Bump {
  return notes.some((n) => n.kind === 'nuevo' || n.kind === 'mejora') ? 'minor' : 'patch';
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** Lee un archivo de nota; nunca lanza (una nota mala no debe romper el análisis). */
export function parseReleaseNote(
  raw: string,
  id: string,
  source: NoteSource,
): { note?: ReleaseNote; error?: string } {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: `La nota ${id} no es un JSON válido.` };
  }
  if (!data || typeof data !== 'object') return { error: `La nota ${id} está vacía.` };
  const kind = data.kind as NoteKind;
  if (!NOTE_KINDS.includes(kind)) return { error: `La nota ${id} tiene un tipo desconocido (${data.kind}).` };
  const title = str(data.title);
  const summary = str(data.summary);
  if (!title || !summary) return { error: `La nota ${id} no trae título o resumen.` };
  const steps = Array.isArray(data.steps) ? data.steps.map(str).filter(Boolean) as string[] : undefined;
  return {
    note: {
      id,
      kind,
      title,
      summary,
      where: str(data.where),
      route: str(data.route),
      steps: steps && steps.length ? steps : undefined,
      audience: data.audience === 'superadmin' ? 'superadmin' : 'todos',
      source,
    },
  };
}

const VISIBLE_TYPES = ['feat', 'fix', 'perf'];

export function parseCommitSubject(s: string): {
  type: string | null;
  scope: string | null;
  text: string;
  userVisible: boolean;
} {
  const m = /^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(String(s || '').trim());
  if (!m) return { type: null, scope: null, text: String(s || '').trim(), userVisible: false };
  const type = m[1].toLowerCase();
  return { type, scope: m[2] ?? null, text: m[3].trim(), userVisible: VISIBLE_TYPES.includes(type) };
}

const capitalize = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** Borrador de nota para un commit visible que llegó sin archivo de nota. */
export function commitToDraftNote(sha: string, subject: string, source: NoteSource): ReleaseNote {
  const { type, text } = parseCommitSubject(subject);
  const kind: NoteKind = type === 'fix' ? 'correccion' : type === 'perf' ? 'rapido' : 'nuevo';
  return {
    id: `commit-${String(sha).slice(0, 7)}`,
    kind,
    title: capitalize(text),
    summary: capitalize(text),
    audience: 'todos',
    source,
    fromCommit: true,
  };
}

/**
 * Versiones que el usuario no ha visto, la más reciente primero.
 * Usuario nuevo (nunca vio ninguna) → nada: no se le muestran novedades viejas.
 */
export function filterUnseen<T extends { version: string }>(releases: T[], lastSeen: string | null): T[] {
  if (!lastSeen) return [];
  return releases
    .filter((r) => compareVersions(r.version, lastSeen) > 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

export function filterAudience(notes: ReleaseNote[], isSuper: boolean): ReleaseNote[] {
  return notes.filter((n) => isSuper || n.audience !== 'superadmin');
}

/** ¿Hay algo que valga la pena mostrar? Las correcciones solas no abren el aviso. */
export function hasVisibleNews(notes: ReleaseNote[]): boolean {
  return notes.some((n) => n.kind !== 'correccion');
}
