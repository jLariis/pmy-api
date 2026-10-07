import { HERMOSILLO_OFFSET_HOURS } from 'src/common/income-window.util';

/**
 * Lector ÚNICO de la fecha/hora de vencimiento (commit date) que viene en los archivos
 * FedEx, en lo pegado y en los adjuntos de correo. Antes cada camino lo leía distinto:
 * solo se entendía `M/D/AAAA` como texto y la hora como fracción de Excel, así que una
 * fecha real de Excel (número), `AAAA-MM-DD`, `7-Oct-26` o una hora `18:00` / `6:00 PM`
 * hacían que se DESCARTARA la fecha del archivo y se usara la de FedEx (o "ahora").
 *
 * Espejo en el front: app-pmy `lib/commit-date.ts` (mantener en sync).
 */

export type CommitCellStatus = 'ok' | 'empty' | 'invalid';

export interface CommitDateResult {
  /** `yyyy-MM-dd` o null. */
  iso: string | null;
  status: CommitCellStatus;
  /** Día/mes intercambiables (ambos ≤ 12) y las dos lecturas dan fechas distintas. */
  ambiguous: boolean;
}

export interface CommitTimeResult {
  /** `HH:mm:ss` o null. */
  time: string | null;
  status: CommitCellStatus;
}

/** Hora por defecto cuando el archivo no trae hora (fin de jornada). */
export const DEFAULT_COMMIT_TIME = '18:00:00';

const MONTHS: Record<string, number> = {
  jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7,
  aug: 8, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dec: 12, dic: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);

/** Serial de Excel (sistema 1900) → `yyyy-MM-dd`. */
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null; // ~1954..2119
  const ms = Math.round((Math.floor(serial) - 25569) * 86400000);
  const d = new Date(ms);
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Lee la fecha de vencimiento de una celda. `refIso` (fecha del consolidado, `yyyy-MM-dd`)
 * desempata `D/M` vs `M/D` cuando ambos números son ≤ 12: gana la lectura que cae entre
 * 1 día antes y 30 después del consolidado. Sin referencia, se asume `M/D` (FedEx).
 */
export function parseCommitDate(raw: unknown, refIso?: string | null): CommitDateResult {
  const none = (status: CommitCellStatus): CommitDateResult => ({ iso: null, status, ambiguous: false });

  if (raw === null || raw === undefined) return none('empty');
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return none('invalid');
    return { iso: ymd(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()), status: 'ok', ambiguous: false };
  }
  if (typeof raw === 'number') {
    const iso = excelSerialToIso(raw);
    return iso ? { iso, status: 'ok', ambiguous: false } : none('invalid');
  }

  const v = String(raw).trim();
  if (!v) return none('empty');

  // Serial de Excel como texto ("46301" o "46301.75").
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const iso = excelSerialToIso(Number(v));
    return iso ? { iso, status: 'ok', ambiguous: false } : none('invalid');
  }

  // AAAA-MM-DD (con hora opcional detrás).
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYmd(y, mo, d) ? { iso: ymd(y, mo, d), status: 'ok', ambiguous: false } : none('invalid');
  }

  // A/B/AAAA (M/D o D/M), con hora opcional detrás.
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s].*)?$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = fullYear(Number(m[3]));
    const md = isValidYmd(y, a, b) ? ymd(y, a, b) : null; // M/D
    const dm = isValidYmd(y, b, a) ? ymd(y, b, a) : null; // D/M
    if (md && dm && md !== dm) {
      // Sin fecha del consolidado: formato FedEx (M/D), sin aviso.
      if (!refIso || !/^\d{4}-\d{2}-\d{2}$/.test(refIso)) return { iso: md, status: 'ok', ambiguous: false };
      // Con fecha del consolidado: gana la lectura creíble (de 1 día antes a 30 después).
      // Solo es "ambigua" si las DOS son creíbles; entonces gana la más cercana.
      const ref = dayNumber(refIso);
      const diffMd = dayNumber(md) - ref, diffDm = dayNumber(dm) - ref;
      const okMd = diffMd >= -1 && diffMd <= 30, okDm = diffDm >= -1 && diffDm <= 30;
      if (okMd && okDm) return { iso: Math.abs(diffDm) < Math.abs(diffMd) ? dm : md, status: 'ok', ambiguous: true };
      return { iso: okDm && !okMd ? dm : md, status: 'ok', ambiguous: false };
    }
    const iso = md ?? dm;
    return iso ? { iso, status: 'ok', ambiguous: false } : none('invalid');
  }

  // 7-Oct-26 / 7 oct 2026 / Oct 7, 2026
  m = v.match(/^(\d{1,2})[-\s/.]([A-Za-zÁÉÍÓÚáéíóú]{3,})\.?[-\s/.,]+(\d{2}|\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const d = Number(m[1]), y = fullYear(Number(m[3]));
    return mo && isValidYmd(y, mo, d) ? { iso: ymd(y, mo, d), status: 'ok', ambiguous: false } : none('invalid');
  }
  m = v.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    const d = Number(m[2]), y = Number(m[3]);
    return mo && isValidYmd(y, mo, d) ? { iso: ymd(y, mo, d), status: 'ok', ambiguous: false } : none('invalid');
  }

  return none('invalid');
}

/** Lee la hora de vencimiento: fracción de Excel, `HH:mm[:ss]`, `h:mm AM/PM`, `HHmm`. */
export function parseCommitTime(raw: unknown): CommitTimeResult {
  const none = (status: CommitCellStatus): CommitTimeResult => ({ time: null, status });
  const fromSeconds = (total: number): CommitTimeResult => {
    const s = Math.round(total) % 86400;
    return { time: `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`, status: 'ok' };
  };

  if (raw === null || raw === undefined) return none('empty');
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return none('invalid');
    return fromSeconds(raw.getUTCHours() * 3600 + raw.getUTCMinutes() * 60 + raw.getUTCSeconds());
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return none('invalid');
    // Fracción del día (0.75 = 18:00) o fecha-hora serial (se toma la parte decimal).
    return fromSeconds((raw % 1) * 86400);
  }

  const v = String(raw).trim();
  if (!v) return none('empty');

  if (/^\d*\.\d+$|^0$/.test(v)) return parseCommitTime(Number(v));

  let m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/i);
  if (m) {
    let h = Number(m[1]);
    const mi = Number(m[2]), s = Number(m[3] ?? 0), pm = m[4].toLowerCase() === 'p';
    if (h < 1 || h > 12 || mi > 59 || s > 59) return none('invalid');
    if (h === 12) h = 0;
    if (pm) h += 12;
    return fromSeconds(h * 3600 + mi * 60 + s);
  }
  m = v.match(/^(\d{1,2})\s*([ap])\.?\s*m\.?$/i);
  if (m) {
    let h = Number(m[1]);
    if (h < 1 || h > 12) return none('invalid');
    if (h === 12) h = 0;
    if (m[2].toLowerCase() === 'p') h += 12;
    return fromSeconds(h * 3600);
  }
  m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const h = Number(m[1]), mi = Number(m[2]), s = Number(m[3] ?? 0);
    if (h > 23 || mi > 59 || s > 59) return none('invalid');
    return fromSeconds(h * 3600 + mi * 60 + s);
  }
  m = v.match(/^(\d{2})(\d{2})$/);
  if (m) {
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return none('invalid');
    return fromSeconds(h * 3600 + mi * 60);
  }
  return none('invalid');
}

/** `yyyy-MM-dd` + `HH:mm:ss` en hora de Hermosillo (UTC-7, sin horario de verano) → instante. */
export function commitInstantHermosillo(iso: string, time: string = DEFAULT_COMMIT_TIME): Date | null {
  const d = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = (time || DEFAULT_COMMIT_TIME).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!d || !t) return null;
  const out = new Date(Date.UTC(
    Number(d[1]), Number(d[2]) - 1, Number(d[3]),
    Number(t[1]) + HERMOSILLO_OFFSET_HOURS, Number(t[2]), Number(t[3] ?? 0),
  ));
  return isNaN(out.getTime()) ? null : out;
}

/** Hoy a las 18:00 de Hermosillo: respaldo cuando no hay vencimiento ni en el archivo ni en FedEx. */
export function todayDefaultCommitHermosillo(now: Date = new Date()): Date {
  const local = new Date(now.getTime() - HERMOSILLO_OFFSET_HOURS * 3600000);
  const iso = ymd(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate());
  return commitInstantHermosillo(iso, DEFAULT_COMMIT_TIME) as Date;
}

/**
 * Lee fecha + hora de una fila y devuelve lo que se guarda. La hora mala NUNCA tira la
 * fecha (antes sí): se usa 18:00 y se reporta el problema.
 */
export function readCommitCells(
  rawDate: unknown,
  rawTime: unknown,
  refIso?: string | null,
): { commitDate: string | null; commitTime: string; dateStatus: CommitCellStatus; timeStatus: CommitCellStatus; ambiguous: boolean } {
  const d = parseCommitDate(rawDate, refIso);
  const t = parseCommitTime(rawTime);
  return {
    commitDate: d.iso,
    commitTime: t.time ?? DEFAULT_COMMIT_TIME,
    dateStatus: d.status,
    timeStatus: t.status,
    ambiguous: d.ambiguous,
  };
}

/** Fecha del consolidado (`Date` de `yyyy-MM-dd` o texto) → `yyyy-MM-dd` para desempatar. */
export function refIsoOf(consDate?: Date | string | null): string | null {
  if (!consDate) return null;
  if (typeof consDate === 'string') return /^\d{4}-\d{2}-\d{2}/.test(consDate) ? consDate.slice(0, 10) : null;
  return isNaN(consDate.getTime()) ? null : consDate.toISOString().slice(0, 10);
}

export type CommitIssue = 'sin_fecha' | 'fecha_invalida' | 'hora_invalida' | 'ambigua';

/** Problema de vencimiento de una fila (el más grave primero) o null. */
export function commitIssueOf(c: { dateStatus: CommitCellStatus; timeStatus: CommitCellStatus; ambiguous: boolean }): CommitIssue | null {
  if (c.dateStatus === 'invalid') return 'fecha_invalida';
  if (c.dateStatus === 'empty') return 'sin_fecha';
  if (c.timeStatus === 'invalid') return 'hora_invalida';
  if (c.ambiguous) return 'ambigua';
  return null;
}

export interface CommitSummary {
  /** Vencimientos por día (`yyyy-MM-dd` → guías), ordenado. */
  byDay: { day: string; count: number }[];
  sinFecha: number;
  fechaInvalida: number;
  horaInvalida: number;
  ambiguas: number;
  /** Vencen ANTES de la fecha del consolidado (ya llegarían vencidas). */
  antesDelConsolidado: number;
  /** Vencen más de 30 días después del consolidado (fecha sospechosa). */
  muyLejanas: number;
  /** Hasta 20 guías de ejemplo por problema. */
  ejemplos: Partial<Record<CommitIssue | 'antes_del_consolidado' | 'muy_lejana', string[]>>;
}

/** Resumen de vencimientos de lo leído de un archivo, para avisar en la vista previa. */
export function summarizeCommitDates(
  rows: { trackingNumber?: string; commitDate?: string | null; commitIssue?: CommitIssue | null }[],
  refIso?: string | null,
): CommitSummary {
  const out: CommitSummary = {
    byDay: [], sinFecha: 0, fechaInvalida: 0, horaInvalida: 0, ambiguas: 0,
    antesDelConsolidado: 0, muyLejanas: 0, ejemplos: {},
  };
  const days = new Map<string, number>();
  const sample = (k: keyof CommitSummary['ejemplos'], tn?: string) => {
    const list = (out.ejemplos[k] ??= []);
    if (tn && list.length < 20) list.push(String(tn));
  };
  const ref = refIso && /^\d{4}-\d{2}-\d{2}$/.test(refIso) ? dayNumber(refIso) : null;
  for (const r of rows) {
    if (!String(r.trackingNumber ?? '').trim()) continue;
    switch (r.commitIssue) {
      case 'sin_fecha': out.sinFecha++; sample('sin_fecha', r.trackingNumber); break;
      case 'fecha_invalida': out.fechaInvalida++; sample('fecha_invalida', r.trackingNumber); break;
      case 'hora_invalida': out.horaInvalida++; sample('hora_invalida', r.trackingNumber); break;
      case 'ambigua': out.ambiguas++; sample('ambigua', r.trackingNumber); break;
    }
    if (!r.commitDate) continue;
    days.set(r.commitDate, (days.get(r.commitDate) ?? 0) + 1);
    if (ref !== null) {
      const diff = dayNumber(r.commitDate) - ref;
      if (diff < 0) { out.antesDelConsolidado++; sample('antes_del_consolidado', r.trackingNumber); }
      else if (diff > 30) { out.muyLejanas++; sample('muy_lejana', r.trackingNumber); }
    }
  }
  out.byDay = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }));
  return out;
}
