/**
 * Parte pura de las alertas operativas: vencimiento de cada paso del recorrido de un
 * consolidado, nivel de escalamiento y horario activo. Hora de Hermosillo (UTC−7 fijo).
 */

export type OpsStep = 'upload' | 'unloading' | 'dispatch' | 'closure' | 'inventory';
export type ConsolidationStep = Exclude<OpsStep, 'inventory'>;

export interface OpsSettings {
  enabled: boolean;
  uploadMinutes: number;
  unloadingTime: string; // HH:MM
  dispatchTime: string; // HH:MM del día siguiente
  closureTime: string; // HH:MM
  inventoryTime: string; // HH:MM
  escalate1Min: number;
  escalate2Min: number;
  completePct: number;
  lookbackDays: number;
  activeFrom: string; // HH:MM
  activeTo: string; // HH:MM
}

export type StepsEnabled = Record<OpsStep, boolean>;

export interface StepProgress {
  done: number;
  total: number;
  first: Date | null;
  last: Date | null;
}

export interface Lifecycle {
  receivedAt: Date;
  uploadedAt: Date | null;
  unloading: StepProgress;
  dispatch: StepProgress;
  closure: StepProgress;
}

export interface StepStatus {
  step: ConsolidationStep;
  dueAt: Date;
  done: boolean;
  doneAt: Date | null;
  pct: number;
}

const OFFSET_MS = 7 * 3_600_000;
const MIN = 60_000;

export const localDay = (d: Date): string => new Date(d.getTime() - OFFSET_MS).toISOString().slice(0, 10);

export function atLocalTime(day: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + OFFSET_MS + (h * 60 + m) * MIN);
}

export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T12:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

const pctOf = (p: StepProgress) => (p.total ? Math.floor((p.done / p.total) * 100) : 0);

/**
 * Pasos aplicables con su vencimiento. Un paso solo se evalúa cuando el anterior
 * habilitado ya se cumplió (el ancla es la hora en que se cumplió).
 */
export function computeSteps(l: Lifecycle, s: OpsSettings, enabled: StepsEnabled): StepStatus[] {
  const out: StepStatus[] = [];
  let anchor: Date = l.receivedAt;

  if (enabled.upload) {
    const done = !!l.uploadedAt;
    out.push({ step: 'upload', dueAt: new Date(l.receivedAt.getTime() + s.uploadMinutes * MIN), done, doneAt: l.uploadedAt, pct: done ? 100 : 0 });
    if (!done) return out;
    anchor = l.uploadedAt as Date;
  } else if (l.uploadedAt) {
    anchor = l.uploadedAt;
  }

  const progressStep = (step: ConsolidationStep, p: StepProgress, dueAt: Date): boolean => {
    const pct = pctOf(p);
    const done = p.total > 0 && pct >= s.completePct;
    out.push({ step, dueAt, done, doneAt: done ? p.last : null, pct });
    if (done && p.last) anchor = p.last;
    return done;
  };

  if (enabled.unloading) {
    let due = atLocalTime(localDay(anchor), s.unloadingTime);
    if (anchor.getTime() > due.getTime()) due = new Date(anchor.getTime() + 2 * 60 * MIN);
    if (!progressStep('unloading', l.unloading, due)) return out;
  }

  if (enabled.dispatch) {
    const due = atLocalTime(addDays(localDay(anchor), 1), s.dispatchTime);
    if (!progressStep('dispatch', l.dispatch, due)) return out;
  }

  if (enabled.closure) {
    const firstOut = l.dispatch.first ?? anchor;
    if (l.dispatch.done > 0 || !enabled.dispatch) {
      progressStep('closure', l.closure, atLocalTime(localDay(firstOut), s.closureTime));
    }
  }
  return out;
}

/** 0 = a tiempo · 1 vencido · 2 primer escalamiento · 3 segundo escalamiento. */
export function alertLevel(dueAt: Date, now: Date, s: OpsSettings): 0 | 1 | 2 | 3 {
  const late = (now.getTime() - dueAt.getTime()) / MIN;
  if (late <= 0) return 0;
  if (late >= s.escalate2Min) return 3;
  if (late >= s.escalate1Min) return 2;
  return 1;
}

export function inActiveHours(now: Date, s: OpsSettings): boolean {
  const day = localDay(now);
  return now.getTime() >= atLocalTime(day, s.activeFrom).getTime() && now.getTime() <= atLocalTime(day, s.activeTo).getTime();
}

export const STEP_LABEL: Record<OpsStep, string> = {
  upload: 'Subir el consolidado',
  unloading: 'Desembarque',
  dispatch: 'Salida a ruta',
  closure: 'Cierre de ruta',
  inventory: 'Inventario del día',
};
