/**
 * Ciudad de un paquete para agrupar/ordenar el inventario.
 *
 * Fuente principal: la memoria de CP por sucursal (`subsidiary_zip_coverage`), que ya
 * normaliza la ciudad que más se repite en el historial de cada CP. Si el CP no está
 * ahí, se usa la ciudad que trae la guía. Sin nada usable → null ("Sin ciudad").
 */
export interface ZipCoverageRow {
  zip: string;
  city: string | null;
  subsidiaryId: string;
  share: string | number | null;
  status: string | null;
}

const JUNK_CITIES = new Set(['', 'N/A', 'NA', 'S/N', 'SIN CIUDAD', 'NULL', '-']);

export function normalizeCity(raw: string | null | undefined): string | null {
  const city = (raw ?? '').toString().trim().replace(/\s+/g, ' ').toUpperCase();
  if (JUNK_CITIES.has(city)) return null;
  // La importación DHL guarda el nombre de la sucursal como ciudad ("BODEGA OBREGON") y eso
  // también llegó a la memoria de CP. No es una ciudad: se descarta para usar la siguiente opción.
  if (city.startsWith('BODEGA ')) return null;
  return city;
}

/**
 * Elige la ciudad de cada CP. Prioridad: fila de la sucursal del inventario → fila
 * confirmada → la de mayor proporción. Se ignoran las excluidas y las sin ciudad.
 */
export function buildZipCityMap(rows: ZipCoverageRow[], subsidiaryId?: string | null): Map<string, string> {
  const best = new Map<string, { city: string; rank: number }>();
  for (const r of rows) {
    if (r.status === 'excluido') continue;
    const city = normalizeCity(r.city);
    const zip = (r.zip ?? '').trim();
    if (!city || !zip) continue;
    const rank =
      (subsidiaryId && r.subsidiaryId === subsidiaryId ? 10 : 0) +
      (r.status === 'confirmado' ? 5 : 0) +
      Number(r.share || 0);
    const current = best.get(zip);
    if (!current || rank > current.rank) best.set(zip, { city, rank });
  }
  return new Map([...best].map(([zip, v]) => [zip, v.city]));
}

export function resolveZoneCity(
  pkg: { recipientZip?: string | null; recipientCity?: string | null },
  zipCities: Map<string, string>,
): string | null {
  const zip = (pkg.recipientZip ?? '').trim();
  return (zip && zipCities.get(zip)) || normalizeCity(pkg.recipientCity);
}
