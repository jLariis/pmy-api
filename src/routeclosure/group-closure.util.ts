import type { CreateRouteclosureDto } from './dto/create-routeclosure.dto';

/** Lo que manda la pantalla de cierre agrupado: un solo cierre para varias salidas. */
export type GroupClosureInput = Omit<CreateRouteclosureDto, 'packageDispatch'>;

export interface GroupDispatchInfo {
  id: string;
  subsidiaryId: string | null;
  routeDate: string | null; // 'YYYY-MM-DD'
  driverIds: string[];
  status: string | null;
  createdAt: Date | string;
}

const idOf = (p: any): string | undefined => (typeof p === 'string' ? p : p?.id);
const isNoVan = (id?: string) => typeof id === 'string' && id.startsWith('novan-');

/**
 * Reglas para cerrar juntas (decisión del usuario): 2+ salidas abiertas, misma
 * sucursal, mismo día de ruta y al menos un chofer en común. Devuelve el problema
 * en llano o null si se puede.
 */
export function groupClosureProblem(dispatches: GroupDispatchInfo[], requestedIds: string[]): string | null {
  if (new Set(requestedIds).size < 2) return 'Elige al menos dos rutas para cerrarlas juntas.';
  if (dispatches.length !== new Set(requestedIds).size) return 'Alguna de las rutas ya no existe. Actualiza la pantalla.';
  const closed = dispatches.filter((d) => d.status === 'Completada' || d.status === 'Cancelada');
  if (closed.length) return 'Alguna de las rutas ya está cerrada. Actualiza la pantalla.';
  if (new Set(dispatches.map((d) => d.subsidiaryId)).size > 1) return 'Las rutas son de sucursales distintas.';
  if (new Set(dispatches.map((d) => d.routeDate)).size > 1) return 'Las rutas son de días distintos.';
  const common = dispatches
    .map((d) => new Set(d.driverIds))
    .reduce((acc, set) => new Set([...acc].filter((x) => set.has(x))));
  if (common.size === 0) return 'Las rutas no tienen un chofer en común.';
  return null;
}

/**
 * Reparte el cierre agrupado en un cierre por salida (decisión C1):
 *  - Entregados / no entregados / cambios manuales → a la salida que llevó cada paquete.
 *  - Recolecciones, No VAN y hora del pre-cierre → a la PRIMERA ruta del día.
 *  - Kilometraje final → a la ÚLTIMA ruta del día (las demás quedan sin km).
 * `membership`: id de shipment o carga → salida. Un paquete que no es de ninguna
 * salida del grupo es error (la pantalla está desactualizada).
 */
export function splitGroupClosure(
  input: GroupClosureInput,
  orderedDispatchIds: string[],
  membership: Map<string, string>,
): { dto: CreateRouteclosureDto; dispatchId: string }[] {
  const first = orderedDispatchIds[0];
  const last = orderedDispatchIds[orderedDispatchIds.length - 1];
  const empty = () => ({ pod: [] as any[], returned: [] as any[], manual: [] as any[] });
  const parts = new Map(orderedDispatchIds.map((id) => [id, empty()]));
  const unknown: string[] = [];

  const route = (pkg: any, bucket: 'pod' | 'returned') => {
    const id = idOf(pkg);
    if (isNoVan(id)) return; // los No VAN viajan aparte (noVanPackages)
    const owner = id ? membership.get(id) : undefined;
    if (!owner || !parts.has(owner)) { unknown.push(pkg?.trackingNumber ?? id ?? '?'); return; }
    parts.get(owner)![bucket].push(pkg);
  };
  (input.podPackages ?? []).forEach((p) => route(p, 'pod'));
  (input.returnedPackages ?? []).forEach((p) => route(p, 'returned'));
  for (const ch of input.manualStatusChanges ?? []) {
    const owner = membership.get(ch.id);
    if (!owner || !parts.has(owner)) { unknown.push(ch.trackingNumber); continue; }
    parts.get(owner)!.manual.push(ch);
  }
  if (unknown.length) {
    throw new Error(`Estos paquetes ya no pertenecen a las rutas que cierras: ${unknown.join(', ')}. Actualiza la pantalla.`);
  }

  return orderedDispatchIds.map((dispatchId) => {
    const part = parts.get(dispatchId)!;
    const dto: CreateRouteclosureDto = {
      ...(input as any),
      packageDispatch: { id: dispatchId } as any,
      podPackages: part.pod,
      returnedPackages: part.returned,
      manualStatusChanges: part.manual,
      collections: dispatchId === first ? input.collections ?? [] : [],
      noVanPackages: dispatchId === first ? input.noVanPackages ?? [] : [],
      preClosureGeneratedAt: dispatchId === first ? input.preClosureGeneratedAt ?? null : null,
      actualKms: dispatchId === last ? input.actualKms ?? '' : '',
    };
    return { dto, dispatchId };
  });
}
