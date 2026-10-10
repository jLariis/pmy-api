/**
 * Visibilidad del escaneo local de FedEx (códigos 44 y 67) — motor común de los reportes
 * ("Sin código 44", "Visibilidad 67", Inventarios, Último inventario, Desembarques, Rutas) y del
 * welcome dashboard ("Sin escaneo local").
 *
 * El código lo dice FedEx, no la configuración de la sucursal: el 44 (paquete en la estación) y el
 * 67 (tercero en camino) son dos fases del mismo escaneo local, y una sucursal puede recibir ambos
 * (las satélite de Obregón están configuradas en 67 y FedEx les manda el 44 — caso 2026-10-09).
 * Cualquiera de los dos cuenta como "con código". `subsidiary.monitorFedexCode44` solo sirve de
 * etiqueta cuando FedEx nunca ha dado ninguno.
 */

export type LocalScanCode = '44' | '67';
export const LOCAL_SCAN_CODES: readonly LocalScanCode[] = ['44', '67'];

/** Fragmento SQL para filtrar `shipment_status` por escaneo local (44 o 67). */
export const LOCAL_SCAN_CODES_SQL = `('44','67')`;

export function isLocalScanCode(code: unknown): code is LocalScanCode {
  const c = String(code ?? '').trim();
  return c === '44' || c === '67';
}

/** Código configurado de la sucursal (solo etiqueta): '44' si `monitorFedexCode44`, si no '67'. */
export function configuredScanCode(subsidiary?: { monitorFedexCode44?: boolean | null } | null): LocalScanCode {
  return subsidiary?.monitorFedexCode44 === true ? '44' : '67';
}

export interface LocalScan { at: Date; code: LocalScanCode }

/** Último escaneo local (44 o 67) de un historial de estatus. `null` si nunca hubo. */
export function lastLocalScanOf(history: { exceptionCode?: string | null; timestamp?: Date | string | null }[] | null | undefined): LocalScan | null {
  let last: LocalScan | null = null;
  for (const h of history || []) {
    if (!h?.timestamp || !isLocalScanCode(h.exceptionCode)) continue;
    const at = new Date(h.timestamp);
    if (isNaN(at.getTime())) continue;
    if (!last || at > last.at) last = { at, code: String(h.exceptionCode).trim() as LocalScanCode };
  }
  return last;
}

/** El más reciente de dos escaneos locales (cualquiera puede ser null). */
export function latestLocalScan(a: LocalScan | null, b: LocalScan | null): LocalScan | null {
  if (!a) return b;
  if (!b) return a;
  return b.at > a.at ? b : a;
}

/** Inicio (ms, como fecha UTC) del día local de Hermosillo (UTC-7 fijo, sin horario de verano). */
export function hermosilloDayMs(d: Date): number {
  return Date.parse(new Date(d.getTime() - 7 * 3600 * 1000).toISOString().slice(0, 10));
}

/** Días de calendario (Hermosillo) entre `from` y `now`. */
export function hermosilloCalendarDays(from: Date, now: Date = new Date()): number {
  return Math.round((hermosilloDayMs(now) - hermosilloDayMs(from)) / 86400000);
}

/**
 * "Días sin código" = días COMPLETOS sin escaneo, en hora de Hermosillo. FedEx escanea de noche
 * (~21:30–23:00), así que en la mañana el último posible es el de anoche: escaneada anoche → 0
 * (al día); antenoche → 1 (le faltó ayer). Hoy en la noche también es 0. `null` = nunca.
 */
export function daysWithoutLocalScan(lastAt: Date | null | undefined, now: Date = new Date()): number | null {
  if (!lastAt) return null;
  return Math.max(0, hermosilloCalendarDays(lastAt, now) - 1);
}

export type LocalScanCategory = 'hoy' | 'sinCodigo' | 'nunca';

/** 'hoy' = al día (0 días sin código); 'sinCodigo' = le faltan días; 'nunca' = jamás escaneado. */
export function localScanCategory(daysWithout: number | null): LocalScanCategory {
  return daysWithout == null ? 'nunca' : daysWithout === 0 ? 'hoy' : 'sinCodigo';
}

/** Texto llano para la persona: "Al día", "Nunca escaneado", "2 días sin escaneo". */
export function localScanLabel(daysWithout: number | null): string {
  if (daysWithout == null) return 'Nunca escaneado';
  if (daysWithout === 0) return 'Al día';
  return `${daysWithout} ${daysWithout === 1 ? 'día' : 'días'} sin escaneo`;
}
