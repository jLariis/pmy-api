import type { ScopeSubsidiary } from '../zone/zone.types';

/** Roles que ven todas las sucursales (mismo criterio que ConsolidadorAccessGuard.GLOBAL_ROLES). */
const GLOBAL_ROLES = ['superadmin', 'superamin', 'owner'];

/**
 * Sucursales de una zona que el usuario puede revisar: activas, de la zona y, si no es global,
 * solo las que tiene asignadas. Ordenadas por nombre.
 */
export function pickScopeSubsidiaries(
  rows: { id: string; name: string; zoneId: string | null; active: boolean }[],
  zoneId: string,
  user: { role: string; subsidiaryIds?: string[] },
): ScopeSubsidiary[] {
  const isGlobal = GLOBAL_ROLES.includes(String(user.role ?? '').toLowerCase());
  const allowed = new Set(user.subsidiaryIds ?? []);
  return rows
    .filter((r) => r.zoneId === zoneId && r.active && (isGlobal || allowed.has(r.id)))
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Corre `fn` sobre cada elemento con a lo más `limit` a la vez; conserva el orden y no se cae por un rechazo. */
export async function runWithLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}
