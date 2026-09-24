/**
 * Una guía puede tener varias filas (reingreso en otro consolidado, guía reciclada o
 * carga F2). Para diagnosticar un día hay que usar la fila VIGENTE ese día: la más
 * reciente cuyo consolidado es ≤ día; si todas son posteriores, la más antigua.
 * Se prefiere la sucursal consultada y el envío sobre la carga F2.
 */
export interface GuideRowLike {
  id: string;
  subsidiaryId: string | null;
  kind: 'shipment' | 'charge';
  consDay: string | null; // 'YYYY-MM-DD'
  createdAt: string | Date;
}

export function pickShipmentRowForDay<T extends GuideRowLike>(rows: T[], subsidiaryId: string, day: string): T | null {
  if (!rows.length) return null;
  const effDay = (r: T) => r.consDay ?? new Date(r.createdAt).toISOString().slice(0, 10);
  const score = (r: T) => (r.subsidiaryId === subsidiaryId ? 4 : 0) + (r.kind === 'shipment' ? 2 : 0) + (effDay(r) <= day ? 1 : 0);
  return [...rows].sort((a, b) => {
    const d = score(b) - score(a);
    if (d) return d;
    // Mismo puntaje: si están vigentes (≤ día) gana la más reciente; si no, la más antigua.
    const cmp = effDay(a).localeCompare(effDay(b));
    return effDay(a) <= day ? -cmp : cmp;
  })[0];
}
