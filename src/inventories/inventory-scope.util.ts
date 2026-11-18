/** Roles que ven todas las sucursales (mismo criterio que SubsidiaryScopeGuard). */
export const GLOBAL_SUBSIDIARY_ROLES = ['superadmin', 'superamin', 'owner'];

/** ¿El usuario puede operar la sucursal? Roles globales sí; los demás solo las de `subsidiaryIds`. */
export function canAccessSubsidiary(
  user: { role?: string | null; subsidiaryIds?: string[] | null } | null | undefined,
  subsidiaryId?: string | null,
): boolean {
  const role = String(user?.role ?? '').toLowerCase();
  if (GLOBAL_SUBSIDIARY_ROLES.includes(role)) return true;
  if (!subsidiaryId) return false;
  return (user?.subsidiaryIds ?? []).includes(subsidiaryId);
}

/** Guías (únicas) cuyos paquetes NO son de la sucursal indicada. */
export function foreignTrackings(
  packages: { trackingNumber?: string | null; subsidiary?: { id?: string | null } | null }[],
  subsidiaryId: string,
): string[] {
  const out = new Set<string>();
  for (const p of packages ?? []) {
    if (p?.subsidiary?.id !== subsidiaryId) out.add(String(p?.trackingNumber ?? '¿sin guía?'));
  }
  return [...out];
}
