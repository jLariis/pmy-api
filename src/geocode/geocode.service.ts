import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeocodeCache } from '../entities/geocode-cache.entity';

/**
 * Geocoder gratuito (Nominatim / OpenStreetMap) para México con:
 *  - Parsing INTELIGENTE: expande abreviaturas (AV→Avenida, BLVD→Boulevard…),
 *    extrae el número de casa/lote, limpia el ruido y usa calle + número + ciudad
 *    + CP, anclando la búsqueda a un viewbox de la región (evita matches lejanos).
 *  - Caché PERSISTENTE en BD ("ML casero"): cada acierto se guarda; las correcciones
 *    MANUALES del usuario (manual=true) son verdad de campo y SIEMPRE ganan.
 *  - Serialización upstream (lock + 1.1s + retry 429) para respetar a Nominatim.
 */

export interface GeoResult {
  lat: string;
  lon: string;
  display_name?: string;
  source: 'address' | 'postalcode' | 'city' | 'manual';
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const PHOTON = 'https://photon.komoot.io/api/';
const USER_AGENT = 'PMY-RouteOptimizer/1.0 (javier.lopez@derevo.com.mx)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Abreviaturas comunes en direcciones mexicanas → forma completa (mejor match). */
const ABBR: Record<string, string> = {
  AV: 'Avenida', 'AV.': 'Avenida', AVE: 'Avenida', AVDA: 'Avenida',
  BLVD: 'Boulevard', BLV: 'Boulevard', BVD: 'Boulevard', BLVRD: 'Boulevard',
  CALZ: 'Calzada', CARR: 'Carretera', COL: 'Colonia', FRACC: 'Fraccionamiento',
  PRIV: 'Privada', PROL: 'Prolongacion', AND: 'Andador', CDA: 'Cerrada',
  CTO: 'Circuito', CJON: 'Callejon', C: 'Calle', PSO: 'Paseo',
};

function expandAbbrev(s?: string): string {
  return (s || '')
    .split(/\s+/)
    .map((t) => ABBR[t.replace(/\.$/, '').toUpperCase()] ?? t)
    .join(' ');
}

/**
 * Limpia una dirección dejando solo la calle/landmark, quitando el "detalle"
 * (lote, manzana, casa, número, bodega, #, S/N…). Ej:
 *   "AV PASEO DE LA MARINA LOTE 7A" -> "AVENIDA PASEO DE LA MARINA"
 */
function cleanStreet(raw?: string): string {
  let s = expandAbbrev(raw).toUpperCase().trim();
  if (!s) return '';
  const noise = /\b(LOTE|LT|MZA?|MNZ|MANZANA|CASA|BODEGA|BOD|DEPTO|DEPARTAMENTO|OFICINA|OFNA|LOCAL|INT|EXT|EDIFICIO|EDIF|MODULO|FRENTE|FTE|NUM|NO)\b/;
  const idx = s.search(noise);
  if (idx > 3) s = s.slice(0, idx);
  s = s.replace(/#.*/g, ' ');
  s = s.replace(/\bS\s*\/?\s*N\b/g, ' ');
  s = s.replace(/[.,;]+/g, ' ');
  s = s.replace(/\s+\d+[A-Z]?\s*$/, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Número de casa/edificio (con o sin letra): "# 16", "NUM. 11", "CASA 121", "LOTE 7A", "LT 7A" o el final. */
function parseHouseNumber(raw?: string): string {
  if (!raw) return '';
  const s = raw.toUpperCase();
  const m =
    s.match(/#\s*(\d+[A-Z]?)/) ||
    s.match(/\bNUM\.?\s*(\d+[A-Z]?)/) ||
    s.match(/\bNO\.?\s*(\d+[A-Z]?)/) ||
    s.match(/\bCASA\s*(\d+[A-Z]?)/) ||
    s.match(/\bLOTE\s*(\d+[A-Z]?)/) ||
    s.match(/\bLT\.?\s*(\d+[A-Z]?)/) ||
    s.match(/\b(\d+[A-Z]?)\s*$/);
  return m ? m[1] : '';
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const normKey = (s?: string) => stripAccents((s ?? '').toLowerCase()).replace(/\s+/g, ' ').trim();

@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);

  private lastUpstream = 0;
  private lock: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(GeocodeCache)
    private readonly cacheRepo: Repository<GeocodeCache>,
  ) {}

  private keyOf(address?: string, city?: string, zip?: string, q?: string): string {
    return [normKey(address), normKey(city), normKey(zip), normKey(q)].join('|');
  }

  private async throttledFetch(url: string): Promise<Response> {
    let release!: () => void;
    const prev = this.lock;
    this.lock = new Promise<void>((r) => (release = r));
    await prev;
    try {
      const wait = 1100 - (Date.now() - this.lastUpstream);
      if (wait > 0) await sleep(wait);
      const headers = { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-MX', Referer: 'https://pmy.local/' };
      let res = await fetch(url, { headers });
      if (res.status === 429) { await sleep(1500); res = await fetch(url, { headers }); }
      this.lastUpstream = Date.now();
      return res;
    } finally {
      release();
    }
  }

  /** viewbox de Nominatim "minLon,maxLat,maxLon,minLat" (~13km por lado con d=0.12). */
  private viewbox(lat: number, lon: number, d = 0.12): string {
    return `${lon - d},${lat + d},${lon + d},${lat - d}`;
  }

  /** bbox de Photon "minLon,minLat,maxLon,maxLat". */
  private photonBbox(lat: number, lon: number, d = 0.12): string {
    return `${lon - d},${lat - d},${lon + d},${lat + d}`;
  }

  /**
   * Photon (komoot, OSM, gratis) — geocoder con TOLERANCIA A TYPOS y nombres
   * parciales (ej. "VENUZTIANO CARRANZA" → "Calle Venustiano Carranza"). Se
   * RESTRINGE a un bbox de la región (clave: sin bbox trae resultados lejanos).
   */
  private async photon(q: string, bbox: string): Promise<GeoResult[]> {
    const url = new URL(PHOTON);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '1');
    url.searchParams.set('bbox', bbox);
    const res = await this.throttledFetch(url.toString());
    if (!res.ok) return [];
    const data: any = await res.json().catch(() => null);
    const f = data?.features?.[0];
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) return [];
    return [{ lat: String(c[1]), lon: String(c[0]), display_name: f.properties?.name, source: 'address' }];
  }

  private async nominatim(params: Record<string, string>, source: GeoResult['source']): Promise<GeoResult[]> {
    const url = new URL(NOMINATIM);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'mx');
    url.searchParams.set('addressdetails', '1');
    for (const [k, v] of Object.entries(params)) {
      if (v && v.trim()) url.searchParams.set(k, v.trim());
    }
    const res = await this.throttledFetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    if (!Array.isArray(data) || data.length === 0) return [];
    return data.map((d: any) => ({ lat: d.lat, lon: d.lon, display_name: d.display_name, source }));
  }

  /** Cascada inteligente (Photon fuzzy + Nominatim), anclada a la región del CP/ciudad. */
  private async runCascade(address: string, city: string, zip: string, q: string): Promise<GeoResult[]> {
    const street = cleanStreet(address);
    const cityPart = city ? `, ${city}` : '';

    // Ancla de región: CP, si no hay, la ciudad. Evita matches en otro estado.
    let anchor: GeoResult | null = null;
    if (zip) { const r = await this.nominatim({ postalcode: zip, country: 'México' }, 'postalcode'); if (r.length) anchor = r[0]; }
    if (!anchor && city) { const r = await this.nominatim({ city, country: 'México' }, 'city'); if (r.length) anchor = r[0]; }

    const aLat = anchor ? parseFloat(anchor.lat) : null;
    const aLon = anchor ? parseFloat(anchor.lon) : null;
    const vb = anchor ? this.viewbox(aLat!, aLon!) : null;
    const bbox = anchor ? this.photonBbox(aLat!, aLon!) : null;

    const num = parseHouseNumber(address);
    // Candidatos de mayor a menor precisión. El tipo de vía del dato puede estar
    // mal (AV vs Blvd), pero el fuzzy de Photon matchea por el nombre significativo,
    // así que NO forzamos un tipo; sí intentamos primero CON número de casa.
    const tries = [
      num ? `${street} ${num}${cityPart}` : '',
      `${street}${cityPart}`,
      cityPart ? street : '',
    ].filter(Boolean);

    let result: GeoResult[] = [];

    // 1) PHOTON acotado al bbox (tolera typos / nombre parcial; intenta nº de casa).
    if (street && bbox) {
      for (const t of tries) { result = await this.photon(t, bbox); if (result.length) break; }
    }

    // 2) NOMINATIM acotado (calle/dirección).
    if (!result.length && street && vb) {
      for (const t of tries) {
        result = await this.nominatim({ q: `${t}, México`, viewbox: vb, bounded: '1' }, 'address');
        if (result.length) break;
      }
    }
    if (!result.length && vb && (address || q)) {
      result = await this.nominatim({ q: `${q || address}${cityPart}${zip ? ', ' + zip : ''}, México`, viewbox: vb, bounded: '1' }, 'address');
    }

    // 3) Fallback: centroide del CP/ciudad (zona correcta; el usuario afina).
    if (!result.length && anchor) result = [anchor];

    // 4) Último recurso (sin ancla): texto libre sin acotar.
    if (!result.length) {
      const ft = [q || address, city, 'México'].filter(Boolean).join(', ');
      if (ft.replace(/méxico/i, '').trim().length > 2) {
        const r = await this.nominatim({ q: ft }, 'city');
        if (r.length) result = r;
      }
    }
    return result;
  }

  async geocode(opts: { address?: string; city?: string; zip?: string; q?: string }): Promise<GeoResult[]> {
    const address = opts.address ?? '';
    const city = opts.city ?? '';
    const zip = opts.zip ?? '';
    const q = opts.q ?? '';
    const key = this.keyOf(address, city, zip, q);

    // 1) Caché en BD. Se sirve DIRECTO solo lo confiable (manual o 'address').
    //    Las de baja confianza (centroide de CP/ciudad) se REINTENTAN con la
    //    cascada actual (Photon) → auto-cura cachés viejos sin intervención.
    let cached: GeocodeCache | null = null;
    try {
      cached = await this.cacheRepo.findOne({ where: { cacheKey: key } });
      if (cached && (cached.manual || cached.source === 'address')) {
        this.cacheRepo.increment({ id: cached.id }, 'hits', 1).catch(() => undefined);
        return [{ lat: String(cached.latitude), lon: String(cached.longitude), source: (cached.manual ? 'manual' : 'address') }];
      }
    } catch (err: any) {
      this.logger.warn(`Lectura de caché falló (${key}): ${err?.message}`);
    }

    // 2) Cascada (Photon fuzzy + Nominatim).
    let result: GeoResult[] = [];
    try {
      result = await this.runCascade(address, city, zip, q);
    } catch (err: any) {
      this.logger.warn(`Geocode falló (${key}): ${err?.message}`);
    }

    // 3) Persistir el acierto (no pisa manual; SÍ mejora un centroide viejo).
    if (result.length > 0) {
      await this.persist(key, address, city, zip, result[0], false).catch(() => undefined);
      return result;
    }

    // 4) Si la cascada no encontró nada pero había un centroide cacheado, sírvelo.
    if (cached) {
      return [{ lat: String(cached.latitude), lon: String(cached.longitude), source: cached.source as GeoResult['source'] }];
    }
    return [];
  }

  /** Guarda/actualiza una corrección MANUAL del usuario (verdad de campo). */
  async saveManual(opts: { address?: string; city?: string; zip?: string; lat: number; lng: number }): Promise<{ ok: boolean }> {
    const key = this.keyOf(opts.address, opts.city, opts.zip, '');
    await this.persist(key, opts.address ?? '', opts.city ?? '', opts.zip ?? '', { lat: String(opts.lat), lon: String(opts.lng), source: 'manual' }, true);
    return { ok: true };
  }

  // ===================== Administración del caché aprendido =====================

  async listCache(search?: string, limit = 300): Promise<GeocodeCache[]> {
    const qb = this.cacheRepo.createQueryBuilder('g');
    if (search && search.trim()) {
      const t = `%${search.trim().toLowerCase()}%`;
      qb.where('LOWER(g.rawAddress) LIKE :t OR g.cacheKey LIKE :t OR LOWER(g.city) LIKE :t OR g.zip LIKE :t', { t });
    }
    qb.orderBy('g.manual', 'DESC').addOrderBy('g.hits', 'DESC').addOrderBy('g.updatedAt', 'DESC').limit(limit);
    return qb.getMany();
  }

  async countCache(): Promise<{ total: number; manual: number }> {
    const total = await this.cacheRepo.count();
    const manual = await this.cacheRepo.count({ where: { manual: true } });
    return { total, manual };
  }

  async updateCache(id: string, lat: number, lng: number): Promise<GeocodeCache | null> {
    const e = await this.cacheRepo.findOne({ where: { id } });
    if (!e) return null;
    e.latitude = lat;
    e.longitude = lng;
    e.manual = true;
    e.source = 'manual';
    return this.cacheRepo.save(e);
  }

  async deleteCache(id: string): Promise<{ ok: boolean }> {
    await this.cacheRepo.delete(id);
    return { ok: true };
  }

  /** scope 'auto' borra solo las automáticas (conserva las manuales); 'all' borra todo. */
  async clearCache(scope: 'all' | 'auto' = 'auto'): Promise<{ deleted: number }> {
    const res = await this.cacheRepo
      .createQueryBuilder()
      .delete()
      .where(scope === 'auto' ? 'manual = 0' : '1=1')
      .execute();
    return { deleted: res.affected ?? 0 };
  }

  private async persist(key: string, address: string, city: string, zip: string, geo: GeoResult, manual: boolean) {
    const lat = Number(geo.lat);
    const lng = Number(geo.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    const existing = await this.cacheRepo.findOne({ where: { cacheKey: key } });
    if (existing) {
      // No degradar una corrección manual con un resultado automático.
      if (existing.manual && !manual) return;
      existing.latitude = lat;
      existing.longitude = lng;
      existing.source = manual ? 'manual' : geo.source;
      if (manual) existing.manual = true;
      await this.cacheRepo.save(existing);
      return;
    }
    await this.cacheRepo.save(this.cacheRepo.create({
      cacheKey: key, rawAddress: address, city, zip,
      latitude: lat, longitude: lng,
      source: manual ? 'manual' : geo.source, manual,
    }));
  }
}
