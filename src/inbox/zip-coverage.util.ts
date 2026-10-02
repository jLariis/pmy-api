/**
 * Cálculo puro de la cobertura de CP: a partir de conteos (zip, sucursal, ciudad)
 * obtiene, por cada (zip, sucursal), cuántas guías, qué proporción del CP le toca
 * y la ciudad más frecuente.
 */

export interface ZipCountRow {
  zip: string;
  subsidiaryId: string;
  city: string | null;
  n: number;
  firstSeen?: Date | null;
  lastSeen?: Date | null;
}

export interface ZipShare {
  zip: string;
  subsidiaryId: string;
  city: string | null;
  shipmentCount: number;
  share: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export function cleanZip(raw: unknown): string | null {
  const m = String(raw ?? '').match(/\d{4,5}/);
  if (!m) return null;
  const z = m[0].padStart(5, '0');
  return z === '00000' ? null : z;
}

export function computeZipShares(rows: ZipCountRow[]): ZipShare[] {
  type Acc = { n: number; cities: Map<string, number>; first: Date | null; last: Date | null };
  const byPair = new Map<string, Acc>();
  const totalByZip = new Map<string, number>();
  for (const r of rows) {
    const zip = cleanZip(r.zip);
    if (!zip || !r.subsidiaryId || r.n <= 0) continue;
    const key = `${zip}|${r.subsidiaryId}`;
    const acc = byPair.get(key) ?? { n: 0, cities: new Map(), first: null, last: null };
    acc.n += r.n;
    const city = (r.city ?? '').trim();
    if (city) acc.cities.set(city, (acc.cities.get(city) ?? 0) + r.n);
    if (r.firstSeen && (!acc.first || r.firstSeen < acc.first)) acc.first = r.firstSeen;
    if (r.lastSeen && (!acc.last || r.lastSeen > acc.last)) acc.last = r.lastSeen;
    byPair.set(key, acc);
    totalByZip.set(zip, (totalByZip.get(zip) ?? 0) + r.n);
  }
  const out: ZipShare[] = [];
  for (const [key, acc] of byPair) {
    const [zip, subsidiaryId] = key.split('|');
    const city = [...acc.cities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    out.push({
      zip,
      subsidiaryId,
      city,
      shipmentCount: acc.n,
      share: +(acc.n / (totalByZip.get(zip) ?? acc.n)).toFixed(4),
      firstSeenAt: acc.first,
      lastSeenAt: acc.last,
    });
  }
  return out.sort((a, b) => a.zip.localeCompare(b.zip) || b.share - a.share);
}

/** Minutos entre la llegada del correo y la subida al sistema (nunca negativo). */
export function uploadMinutes(receivedAt: Date, uploadedAt: Date): number {
  return Math.max(0, Math.round((uploadedAt.getTime() - receivedAt.getTime()) / 60_000));
}
