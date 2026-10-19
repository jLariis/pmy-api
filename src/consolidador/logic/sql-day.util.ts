const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 'AAAA-MM-DD' de una columna DATE de MySQL. mysql2 la entrega como Date a medianoche LOCAL del
 * servidor, así que se leen los campos locales (toISOString la correría de día en zonas UTC+).
 */
export function sqlDay(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  return String(v).slice(0, 10);
}
