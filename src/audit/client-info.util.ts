/**
 * Utilidades para enriquecer eventos con info del cliente:
 *  - Dispositivo/"máquina": derivado del User-Agent (la web NO expone el hostname
 *    real del equipo por privacidad; lo más cercano es navegador + sistema operativo).
 *  - Ubicación: geolocalización por IP usando `geoip-lite` (offline). Es OPCIONAL:
 *    si el paquete no está instalado, simplemente no se resuelve ubicación.
 *    Para habilitarla: `npm i geoip-lite`.
 */

// Carga opcional de geoip-lite (no rompe si no está instalado).
let geoip: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  geoip = require('geoip-lite');
} catch {
  geoip = null;
}

/** Parsea el User-Agent a "Navegador · SO (móvil)". */
export function parseDevice(ua?: string): string {
  if (!ua) return 'Desconocido';

  let os = 'SO desconocido';
  if (/windows nt 10/i.test(ua)) os = 'Windows 10/11';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/mac os x/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Navegador';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/(chrome|crios)\//i.test(ua) && !/edg\//i.test(ua)) browser = 'Chrome';
  else if (/(firefox|fxios)\//i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua) && !/(chrome|crios)\//i.test(ua)) browser = 'Safari';

  const isMobile = /mobile|iphone|android/i.test(ua);
  return `${browser} · ${os}${isMobile ? ' (móvil)' : ''}`;
}

/** Geolocaliza una IP. Devuelve etiqueta "Ciudad, Región, País" o null. */
export function geoFromIp(ip?: string): string | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, '').trim();

  // IPs privadas/loopback no geolocalizan.
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1|fc|fd)/i.test(clean)) {
    return 'Red local';
  }
  if (!geoip) return null;

  try {
    const g = geoip.lookup(clean);
    if (!g) return null;
    return [g.city, g.region, g.country].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}
