/**
 * Tipos del Consolidador por zona. Espejo en app-pmy: `lib/types/consolidador-zone.ts` — mantener en sync.
 */

/** Sucursal dentro del alcance (zona o sucursal sola). */
export interface ScopeSubsidiary {
  id: string;
  name: string;
}

/** Resultado de una vista para UNA sucursal de la zona. `error` en llano si esa sucursal no se pudo cargar. */
export interface ZonePart<T> {
  subsidiaryId: string;
  subsidiaryName: string;
  data: T | null;
  error: string | null;
}

/** Vistas que se pueden pedir por zona (`GET consolidador/zone/:zoneId/:from/:to/:view`). */
export type ZoneView =
  | 'week'
  | 'by-route'
  | 'by-consolidado'
  | 'cobros-audit'
  | 'summary'
  | 'charge-guides'
  | 'collections'
  | 'novan';

export const ZONE_VIEWS: ZoneView[] = ['week', 'by-route', 'by-consolidado', 'cobros-audit', 'summary', 'charge-guides', 'collections', 'novan'];
