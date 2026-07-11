export function hydratePackageIds(shipments: { id: string }[]): string[] {
  return Array.from(new Set((shipments || []).map((s) => s.id).filter(Boolean)));
}

export function splitShipmentIds(
  shipments: { id: string; isCharge?: boolean }[],
): { normalIds: string[]; chargeIds: string[] } {
  const normalIds: string[] = [];
  const chargeIds: string[] = [];
  for (const s of shipments || []) {
    if (s.isCharge) chargeIds.push(s.id);
    else normalIds.push(s.id);
  }
  return { normalIds, chargeIds };
}
