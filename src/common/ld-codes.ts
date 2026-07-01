/**
 * Códigos de excepción FedEx que CANCELAN el Local Delay (LD) cuando ocurren el
 * día de vencimiento: el paquete tuvo movimiento, así que FedEx sí paga.
 * Incluye 42 (empresa cerrada) y 05 (retenido por seguridad en aduana).
 * Fuente ÚNICA para todos los reportes (rutas, bodega, etc.).
 */
export const LD_QUALIFYING_EXCEPTION_CODES = ['03', '05', '07', '08', '17', '42'] as const;

/** Lista lista para un `IN (...)` de SQL. Valores estáticos (sin inyección). */
export const LD_QUALIFYING_SQL_IN = LD_QUALIFYING_EXCEPTION_CODES.map((c) => `'${c}'`).join(',');
