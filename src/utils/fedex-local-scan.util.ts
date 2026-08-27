/**
 * Utilidades para el "código 44" de FedEx (escaneo en la estación local).
 *
 * A DIFERENCIA del 67 —que FedEx entrega como `scanEvent.exceptionCode = '67'`— el 44
 * NO tiene un campo numérico fijo en los scanEvents. FedEx expone el escaneo local como
 * el evento "At local FedEx facility" (eventType 'AR'); y solo A VECES marca un '44' en
 * `latestStatusDetail.ancillaryDetails[].reason` (transitorio: puede venir 07/14/nada).
 *
 * Por eso el algoritmo BUSCA EL 44 EN TODOS LADOS (evidencia: 5 guías reales):
 *   1. el escaneo "At local FedEx facility" (señal confiable, presente siempre), y
 *   2. el 44 LITERAL si algún día llega en `exceptionCode` o `eventType` del scan, y
 *   3. como REFUERZO, `ancillaryDetails.reason='44'` a nivel estatus (ancla al scan más
 *      reciente si no hubo escaneo local detectable).
 *
 * Los readers (welcome/inventarios/monitoreo leen `exceptionCode='44'` en BD; Visibilidad44
 * y check44 leen FedEx en vivo) usan estas funciones como fuente única de la regla.
 */

/** Descripción canónica del escaneo local diario de FedEx (equivalente al 67). */
export const LOCAL_FACILITY_SCAN_DESCRIPTION = 'At local FedEx facility';

/** True si la descripción del evento es el escaneo local ("At local FedEx facility"). */
export function isLocalFacilityScan(eventDescription?: string | null): boolean {
  return String(eventDescription || '').trim().toLowerCase() === LOCAL_FACILITY_SCAN_DESCRIPTION.toLowerCase();
}

/** True si el estatus vigente de FedEx trae la reason indicada en ancillaryDetails. */
export function hasAncillaryReason(latestStatusDetail: any, reason: string): boolean {
  return (latestStatusDetail?.ancillaryDetails || []).some(
    (a: any) => String(a?.reason || '').trim() === reason,
  );
}

/**
 * True si el scan trae el 44 LITERAL (exceptionCode/eventType). Caso defensivo: en la
 * práctica FedEx NO pone el 44 en los scanEvents (verificado en 80 guías), solo en
 * `latestStatusDetail.ancillaryDetails.reason`. Se deja por si alguna guía lo expusiera ahí.
 */
export function is44LocalScan(scan: any): boolean {
  if (String(scan?.exceptionCode ?? '').trim() === '44') return true;
  if (String(scan?.eventType ?? '').trim() === '44') return true;
  return false;
}

/**
 * Timestamps (ms) de los escaneos que cuentan como código 44 de una guía.
 *
 * REGLA (confirmada con negocio + 80 guías reales): el 44 DEBE venir de FedEx como CÓDIGO.
 * FedEx lo entrega en `latestStatusDetail.ancillaryDetails.reason = '44'` ("At FedEx
 * destination facility" = el paquete está en la estación local, de nuestro lado). NO basta
 * el escaneo "At local FedEx facility" por sí solo (es un estatus interno de FedEx, demasiado
 * abierto). Cuando el 44 está presente, se ancla a los escaneos "At local FedEx facility"
 * para tener la(s) fecha(s) del/los día(s) en la estación; si no hubiera, al scan más reciente.
 */
export function localFacilityScanTimes(latestStatusDetail: any, scanEvents: any[]): number[] {
  // Caso raro: el 44 vino LITERAL en un scanEvent.
  const literal = (scanEvents || [])
    .filter((e) => is44LocalScan(e) && e?.date)
    .map((e) => new Date(e.date).getTime())
    .filter((t) => !isNaN(t));
  if (literal.length) return literal;

  // Exigimos el CÓDIGO 44 de FedEx (ancillary reason). Sin él, NO es 44.
  if (!hasAncillaryReason(latestStatusDetail, '44')) return [];

  // Ancla el 44 a los escaneos locales (dan la fecha del día en la estación).
  const local = (scanEvents || [])
    .filter((e) => isLocalFacilityScan(e?.eventDescription) && e?.date)
    .map((e) => new Date(e.date).getTime())
    .filter((t) => !isNaN(t));
  if (local.length) return local;

  // Sin escaneo local: al scan más reciente (para no perder el 44).
  const all = (scanEvents || [])
    .filter((e) => e?.date)
    .map((e) => new Date(e.date).getTime())
    .filter((t) => !isNaN(t));
  return all.length ? [Math.max(...all)] : [];
}

/**
 * Timestamp (ms) del escaneo local MÁS RECIENTE de código 44, o `null` si no hay ninguno.
 * Lo usa la persistencia (cron) para anclar el 44 a la fila del escaneo local del día.
 */
export function resolveCode44ScanTime(latestStatusDetail: any, scanEvents: any[]): number | null {
  const times = localFacilityScanTimes(latestStatusDetail, scanEvents);
  return times.length ? Math.max(...times) : null;
}
