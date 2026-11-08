import { cleanZip } from '../inbox/zip-coverage.util';

/**
 * Estatus que cuentan como "sigue en bodega" para sugerir salida: los de Tareas del día
 * (IN_WAREHOUSE en daily-tasks/package-summary.util) más los DEX que vuelven a salir a
 * ruta (08 cliente no disponible, 17 cambio de fecha).
 */
export const SUGGESTION_STATUSES = [
  'en_bodega',
  'pendiente',
  'recibido_en_bodega',
  'llegado_despues',
  'cliente_no_disponible',
  'cambio_fecha_solicitado',
] as const;

/** Hermosillo / BCS operan sin horario de verano: UTC-7 todo el año. */
export const LOCAL_OFFSET_MIN = -7 * 60;

export type CommitBucket = 'vencido' | 'hoy' | 'manana' | 'despues' | 'sin_fecha';

export interface CoverageForZip {
  routeId: string;
  share: number;
  status: 'sugerido' | 'confirmado' | 'excluido';
}

export interface SuggestionPackage {
  id: string;
  kind: 'shipment' | 'charge';
  trackingNumber: string;
  pieceKey: string;
  zip: string | null;
  recipientName: string | null;
  recipientAddress: string | null;
  commitDateTime: Date | null;
  status: string;
  carrier: 'fedex' | 'dhl';
  createdAt: Date;
}

export interface SuggestedPackage extends Omit<SuggestionPackage, 'commitDateTime' | 'createdAt'> {
  commitDateTime: string | null;
  bucket: CommitBucket;
  daysInWarehouse: number;
  /** Otras rutas que también atienden su CP (≥5%). */
  sharedWith: string[];
}

export interface RouteSuggestion {
  routeId: string;
  routeName: string;
  overdue: number;
  today: number;
  tomorrow: number;
  total: number;
  topZips: { zip: string; count: number; shared: boolean }[];
  lastDispatchAt: string | null;
  openDispatchesToday: number;
  packages: SuggestedPackage[];
}

export interface SuggestionBucket {
  overdue: number;
  today: number;
  tomorrow: number;
  total: number;
  topZips: { zip: string; count: number }[];
  packages: SuggestedPackage[];
}

export interface SuggestionsResult {
  generatedAt: string;
  totals: { total: number; overdue: number; today: number; tomorrow: number; routes: number };
  routes: RouteSuggestion[];
  /** CP válido pero ninguna ruta lo atiende. */
  unassigned: SuggestionBucket;
  /** Sin CP en la guía (p. ej. Hermosillo, "N/A"): solo se puede mostrar el vencimiento. */
  noZip: SuggestionBucket;
}

export const SHARED_MIN = 0.05;

/** Día local (AAAA-MM-DD) de un instante, con el desfase fijo de la operación. */
const localDay = (d: Date, offsetMin: number) => new Date(d.getTime() + offsetMin * 60_000).toISOString().slice(0, 10);

export function commitBucket(commit: Date | null, now: Date, offsetMin = LOCAL_OFFSET_MIN): CommitBucket {
  if (!commit || isNaN(commit.getTime())) return 'sin_fecha';
  const today = localDay(now, offsetMin);
  const tomorrow = localDay(new Date(now.getTime() + 86_400_000), offsetMin);
  const day = localDay(commit, offsetMin);
  if (day < today) return 'vencido';
  if (day === today) return 'hoy';
  if (day === tomorrow) return 'manana';
  return 'despues';
}

/**
 * Ruta a la que se sugiere un CP: primero la confirmada con más peso; si no hay
 * confirmadas, la sugerida con más peso. Excluidas nunca. null = el CP no tiene ruta.
 */
export function pickRouteForZip(cov: CoverageForZip[] | undefined): string | null {
  const usable = (cov ?? []).filter((c) => c.status !== 'excluido');
  if (!usable.length) return null;
  const confirmed = usable.filter((c) => c.status === 'confirmado');
  const pool = confirmed.length ? confirmed : usable;
  return [...pool].sort((a, b) => b.share - a.share)[0].routeId;
}

/**
 * Una guía puede tener varios registros (cada subida crea uno nuevo): vale el más
 * reciente por pieza, y solo si ese registro sigue en bodega.
 */
export function latestPerPiece(rows: SuggestionPackage[]): SuggestionPackage[] {
  const byPiece = new Map<string, SuggestionPackage>();
  for (const r of rows) {
    const prev = byPiece.get(r.pieceKey);
    if (!prev || r.createdAt > prev.createdAt) byPiece.set(r.pieceKey, r);
  }
  return [...byPiece.values()].filter((r) => (SUGGESTION_STATUSES as readonly string[]).includes(r.status));
}

const urgencyRank: Record<CommitBucket, number> = { vencido: 0, hoy: 1, manana: 2, despues: 3, sin_fecha: 4 };

const emptyBucket = (): SuggestionBucket => ({ overdue: 0, today: 0, tomorrow: 0, total: 0, topZips: [], packages: [] });

function countInto(t: { overdue: number; today: number; tomorrow: number; total: number }, b: CommitBucket) {
  t.total++;
  if (b === 'vencido') t.overdue++;
  else if (b === 'hoy') t.today++;
  else if (b === 'manana') t.tomorrow++;
}

function topZipsOf(pkgs: SuggestedPackage[], limit = 4) {
  const m = new Map<string, number>();
  for (const p of pkgs) if (p.zip) m.set(p.zip, (m.get(p.zip) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([zip, count]) => ({ zip, count }));
}

export function buildSuggestions(input: {
  packages: SuggestionPackage[];
  coverage: Map<string, CoverageForZip[]>;
  routes: { id: string; name: string }[];
  dispatchInfo: Map<string, { lastDispatchAt: Date | null; openToday: number }>;
  now: Date;
  offsetMin?: number;
}): SuggestionsResult {
  const { coverage, routes, dispatchInfo, now } = input;
  const offsetMin = input.offsetMin ?? LOCAL_OFFSET_MIN;
  const routeName = new Map(routes.map((r) => [r.id, r.name]));
  const perRoute = new Map<string, SuggestedPackage[]>();
  const unassigned = emptyBucket();
  const noZip = emptyBucket();
  const totals = { total: 0, overdue: 0, today: 0, tomorrow: 0, routes: 0 };

  for (const p of latestPerPiece(input.packages)) {
    const zip = cleanZip(p.zip);
    const bucket = commitBucket(p.commitDateTime, now, offsetMin);
    const cov = zip ? coverage.get(zip)?.filter((c) => routeName.has(c.routeId)) : undefined;
    const routeId = zip ? pickRouteForZip(cov) : null;
    const sharedWith = routeId
      ? (cov ?? [])
          .filter((c) => c.routeId !== routeId && c.status !== 'excluido' && c.share >= SHARED_MIN)
          .map((c) => routeName.get(c.routeId) ?? '')
      : [];
    const sp: SuggestedPackage = {
      id: p.id,
      kind: p.kind,
      trackingNumber: p.trackingNumber,
      pieceKey: p.pieceKey,
      zip,
      recipientName: p.recipientName,
      recipientAddress: p.recipientAddress,
      commitDateTime: p.commitDateTime ? p.commitDateTime.toISOString() : null,
      status: p.status,
      carrier: p.carrier,
      bucket,
      daysInWarehouse: Math.max(0, Math.floor((now.getTime() - p.createdAt.getTime()) / 86_400_000)),
      sharedWith,
    };
    countInto(totals, bucket);
    if (!zip) {
      countInto(noZip, bucket);
      noZip.packages.push(sp);
    } else if (!routeId) {
      countInto(unassigned, bucket);
      unassigned.packages.push(sp);
    } else {
      perRoute.set(routeId, [...(perRoute.get(routeId) ?? []), sp]);
    }
  }

  const sortPkgs = (a: SuggestedPackage, b: SuggestedPackage) =>
    urgencyRank[a.bucket] - urgencyRank[b.bucket] || (a.commitDateTime ?? '').localeCompare(b.commitDateTime ?? '') || (a.zip ?? '').localeCompare(b.zip ?? '');

  const routeCards: RouteSuggestion[] = [...perRoute.entries()].map(([routeId, pkgs]) => {
    const c = { overdue: 0, today: 0, tomorrow: 0, total: 0 };
    for (const p of pkgs) countInto(c, p.bucket);
    const info = dispatchInfo.get(routeId);
    const sharedZip = new Set(pkgs.filter((p) => p.sharedWith.length).map((p) => p.zip));
    return {
      routeId,
      routeName: routeName.get(routeId) ?? '',
      ...c,
      topZips: topZipsOf(pkgs).map((z) => ({ ...z, shared: sharedZip.has(z.zip) })),
      lastDispatchAt: info?.lastDispatchAt ? info.lastDispatchAt.toISOString() : null,
      openDispatchesToday: info?.openToday ?? 0,
      packages: pkgs.sort(sortPkgs),
    };
  });
  routeCards.sort(
    (a, b) => b.overdue + b.today - (a.overdue + a.today) || b.tomorrow - a.tomorrow || b.total - a.total || a.routeName.localeCompare(b.routeName),
  );
  totals.routes = routeCards.length;

  for (const bk of [unassigned, noZip]) {
    bk.packages.sort(sortPkgs);
    bk.topZips = topZipsOf(bk.packages);
  }

  return { generatedAt: now.toISOString(), totals, routes: routeCards, unassigned, noZip };
}
