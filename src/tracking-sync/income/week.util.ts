/**
 * Semana canónica ÚNICA (lunes 00:00 → domingo 23:59:59.999), para deduplicar cobros por
 * (guía, semana) de forma consistente en TODO el sistema. Una sola definición evita el hueco
 * de "dos ventanas de semana" que causaba cobros duplicados/perdidos en el borde.
 */
export function weekRange(date: Date): { start: Date; end: Date } {
  const d = new Date(date);
  const day = d.getDay(); // 0=domingo … 6=sábado
  const diffToMonday = (day + 6) % 7; // domingo→6, lunes→0, martes→1 …
  const start = new Date(d);
  start.setDate(d.getDate() - diffToMonday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
