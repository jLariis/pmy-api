/** Rango semanal lunes–domingo alrededor de `anchor` (interpretado en hora local del server). */
export function getWeekRangeMxLunDom(anchor: Date): { from: Date; to: Date } {
  const d = new Date(anchor);
  const dow = d.getDay(); // 0=dom..6=sáb
  const backToMonday = dow === 0 ? 6 : dow - 1;
  const from = new Date(d);
  from.setDate(d.getDate() - backToMonday);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(from.getDate() + 6);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}
