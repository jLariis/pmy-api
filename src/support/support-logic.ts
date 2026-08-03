/**
 * Lógica pura de Soporte v2: estados del tablero, SLA por prioridad y algoritmo de
 * urgencia. Sin dependencias de Nest/TypeORM para ser testeable y reutilizable por
 * el service y el cron de SLA.
 */
export type TicketPriority = 'baja' | 'media' | 'alta' | 'urgente';
export type TicketType = 'mejora' | 'cambio' | 'eliminar' | 'error';
export type TicketStatus =
  | 'pendiente' // "Backlog" en el tablero
  | 'por_hacer'
  | 'en_progreso'
  | 'en_revision'
  | 'completado' // "Hecho" en el tablero
  | 'rechazado';

/** Estados que cuentan como "abiertos" (aplican SLA/urgencia). */
export const OPEN_STATES: TicketStatus[] = ['pendiente', 'por_hacer', 'en_progreso', 'en_revision'];
/** Estados terminales (resuelto): no vencen ni suben en urgencia. */
export const RESOLVED_STATES: TicketStatus[] = ['completado', 'rechazado'];

export const ALL_STATES: TicketStatus[] = [...OPEN_STATES, ...RESOLVED_STATES];

export function isResolved(estado: string): boolean {
  return (RESOLVED_STATES as string[]).includes(estado);
}

// ---------------------------------------------------------------------------
// SLA
// ---------------------------------------------------------------------------

/** Objetivo de resolución en horas por prioridad (defaults; configurable por env). */
export const DEFAULT_SLA_HOURS: Record<TicketPriority, number> = {
  urgente: 4,
  alta: 24,
  media: 72,
  baja: 168, // 7 días
};

const HOUR_MS = 60 * 60 * 1000;

export function slaHoursFor(
  priority: string | null | undefined,
  cfg: Record<string, number> = DEFAULT_SLA_HOURS,
): number {
  return cfg[priority ?? 'media'] ?? DEFAULT_SLA_HOURS.media;
}

/** Fecha límite de SLA = createdAt + horas(prioridad). */
export function computeSlaDueAt(
  createdAt: Date,
  priority: string | null | undefined,
  cfg?: Record<string, number>,
): Date {
  return new Date(new Date(createdAt).getTime() + slaHoursFor(priority, cfg) * HOUR_MS);
}

/** ¿El ticket está vencido? Solo aplica a tickets abiertos con slaDueAt definido. */
export function isSlaBreached(
  t: { estado: string; slaDueAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (!t.slaDueAt || isResolved(t.estado)) return false;
  return new Date(t.slaDueAt).getTime() < now.getTime();
}

// ---------------------------------------------------------------------------
// Urgencia (algoritmo)
// ---------------------------------------------------------------------------

const PRIORITY_WEIGHT: Record<string, number> = { urgente: 100, alta: 60, media: 30, baja: 10 };
const TYPE_WEIGHT: Record<string, number> = { error: 20, cambio: 10, mejora: 5, eliminar: 5 };
const AGE_CAP_HOURS = 48;
const SLA_BREACH_BOOST = 80;

export function hoursBetween(from: Date | string, to: Date = new Date()): number {
  const ms = to.getTime() - new Date(from).getTime();
  return ms <= 0 ? 0 : ms / HOUR_MS;
}

/**
 * Puntaje de urgencia para ordenar el tablero.
 * score = pesoPrioridad + pesoTipo + min(horasAntigüedad,48) + (vencidoSLA ? 80 : 0)
 * Los tickets resueltos devuelven 0 (caen al fondo). El override manual del
 * superadmin es cambiar la prioridad (alimenta pesoPrioridad).
 */
export function urgencyScore(
  t: {
    prioridad: string;
    tipo: string;
    createdAt: Date | string;
    estado: string;
    slaDueAt?: Date | string | null;
  },
  now: Date = new Date(),
): number {
  if (isResolved(t.estado)) return 0;
  const p = PRIORITY_WEIGHT[t.prioridad] ?? PRIORITY_WEIGHT.media;
  const ty = TYPE_WEIGHT[t.tipo] ?? TYPE_WEIGHT.mejora;
  const age = Math.min(hoursBetween(t.createdAt, now), AGE_CAP_HOURS);
  const breach = isSlaBreached(t, now) ? SLA_BREACH_BOOST : 0;
  return Math.round(p + ty + age + breach);
}
