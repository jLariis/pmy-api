/** Agrupación de "Ver salida": cómo cuenta cada estatus en los contadores del cierre. */
export type ClosureBucket = 'entregado' | 'no_entregado' | 'otro';

/** De dónde sale el estatus "Al cerrar". */
export type ClosureSource = 'corregido' | 'foto' | 'reconstruido';

const DELIVERED = new Set(['entregado', 'entregado_en_bodega', 'entregado_por_fedex']);
const NOT_DELIVERED = new Set([
  'no_entregado', 'rechazado', 'devuelto_a_fedex', 'direccion_incorrecta', 'cliente_no_disponible',
  'cambio_fecha_solicitado', 'empresa_cerrada', 'no_se_pudo_recolectar_el_cobro',
  'restriccion_seguridad_ubicacion', 'cambio_domicilio', 'demora_en_entrega',
]);

export function closureBucket(status: string | null | undefined): ClosureBucket {
  if (status && DELIVERED.has(status)) return 'entregado';
  if (status && NOT_DELIVERED.has(status)) return 'no_entregado';
  return 'otro';
}

/** El código (07, 08, NH…) solo dice algo en un no entregado; en los demás es ruido (44, 67…). */
export function displayCode(status: string | null | undefined, code: string | null | undefined): string | null {
  return closureBucket(status) === 'no_entregado' && code ? code : null;
}

export interface StatusEvent {
  status: string;
  exceptionCode: string | null;
  timestamp: Date | string;
  createdAt: Date | string;
}

const ms = (d: Date | string) => new Date(d).getTime();

/** Último evento de la lista (por hora del evento y luego por hora de captura). */
export function latestEvent(events: StatusEvent[]): StatusEvent | null {
  let best: StatusEvent | null = null;
  for (const e of events) {
    if (!best || ms(e.timestamp) > ms(best.timestamp) || (ms(e.timestamp) === ms(best.timestamp) && ms(e.createdAt) > ms(best.createdAt))) best = e;
  }
  return best;
}

/** Margen tras el cierre: los estatus que escribe el propio cierre (DHL, manuales) llegan segundos después. */
export const CLOSURE_GRACE_MS = 2 * 60 * 1000;

/**
 * Cierres anteriores a la foto (mig 119): el estatus con que quedó la guía es el último
 * que ya estaba CAPTURADO en el sistema al cerrar (`createdAt`, no la hora del evento:
 * un evento de FedEx que llegó después no lo vio quien cerró).
 */
export function reconstructAtClosure(events: StatusEvent[], closedAt: Date | string): StatusEvent | null {
  const cutoff = ms(closedAt) + CLOSURE_GRACE_MS;
  return latestEvent(events.filter((e) => ms(e.createdAt) <= cutoff));
}

/**
 * Cierres viejos: la lista donde el cierre puso la guía (entregados / no entregados) manda
 * sobre el historial, porque la pantalla clasificaba con el estatus del día de la ruta y
 * en FedEx eso no siempre se escribía en el historial.
 */
export function applyClosureListHint(event: StatusEvent | null, hint: 'pod' | 'returned' | null): StatusEvent | null {
  if (!hint) return event;
  const base = event ?? { status: '', exceptionCode: null, timestamp: 0 as any, createdAt: 0 as any };
  if (hint === 'pod' && closureBucket(base.status) !== 'entregado') return { ...base, status: 'entregado', exceptionCode: null };
  if (hint === 'returned' && closureBucket(base.status) !== 'no_entregado') return { ...base, status: 'no_entregado' };
  return base;
}

export interface ClosureState { status: string; exceptionCode: string | null; source: ClosureSource }

/** Prioridad: arreglo del superadmin ("Paquetes con problema") > foto del cierre > reconstrucción. */
export function resolveClosureState(input: {
  fix?: { status: string | null; exceptionCode: string | null } | null;
  snapshot?: { status: string; exceptionCode: string | null } | null;
  reconstructed?: StatusEvent | null;
}): ClosureState | null {
  if (input.fix?.status) return { status: input.fix.status, exceptionCode: input.fix.exceptionCode ?? null, source: 'corregido' };
  if (input.snapshot) return { status: input.snapshot.status, exceptionCode: input.snapshot.exceptionCode ?? null, source: 'foto' };
  if (input.reconstructed) return { status: input.reconstructed.status, exceptionCode: input.reconstructed.exceptionCode ?? null, source: 'reconstruido' };
  return null;
}

/**
 * ¿La guía cambió después del cierre? Cuenta como cambio pasar de grupo (entregado / no
 * entregado / otro) o, en no entregados, cambiar de código. Seguir el camino normal dentro
 * del mismo grupo (rechazado 07 → devuelto a FedEx 07) no es una corrección.
 */
export function changedSinceClosure(
  atClosure: { status: string; exceptionCode: string | null } | null,
  now: { status: string; exceptionCode: string | null },
): boolean {
  if (!atClosure) return false;
  if (closureBucket(atClosure.status) !== closureBucket(now.status)) return true;
  return displayCode(atClosure.status, atClosure.exceptionCode) !== displayCode(now.status, now.exceptionCode);
}
