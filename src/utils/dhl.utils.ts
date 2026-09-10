import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';
import { DhlStatusType } from '../common/enums/dhl-status-type.enum';

/** Resultado de traducir un código de carrier a la capa canónica interna. */
export interface CarrierStatusResolution {
  /** Estatus canónico interno (agnóstico al carrier) para trazabilidad/reportes. */
  internalStatus: ShipmentStatusType;
  /** ¿Este código genera ingreso al cerrar ruta? */
  chargeable: boolean;
  /** ¿Es un desenlace final (no se espera más movimiento)? */
  terminal: boolean;
}

/**
 * TRADUCTOR DHL (adapter carrier → capa canónica). Mapea un código propio de DHL
 * (`DhlStatusType`) al estatus canónico interno + reglas de negocio (cobro / terminal).
 *
 * Es la ÚNICA pieza que conoce la semántica DHL; el resto del sistema consume solo
 * la capa canónica. Un carrier nuevo = su propio catálogo + su propio traductor,
 * sin tocar consumidores internos.
 *
 * Regla de negocio (2026-07): SOLO `OK` (entregado/POD) cobra y es terminal.
 * Código desconocido → pendiente, sin cobro, no terminal.
 *
 * Lo alimenta `resolveDhlNativeStatus` con el código de evento de la API oficial de DHL.
 */
export function mapDhlCodeToInternal(code: string): CarrierStatusResolution {
  const key = (code || '').trim().toUpperCase();
  const map: Record<string, CarrierStatusResolution> = {
    [DhlStatusType.OK]: { internalStatus: ShipmentStatusType.ENTREGADO, chargeable: true, terminal: true },
    [DhlStatusType.NH]: { internalStatus: ShipmentStatusType.CLIENTE_NO_DISPONIBLE, chargeable: false, terminal: false },
    [DhlStatusType.BA]: { internalStatus: ShipmentStatusType.DIRECCION_INCORRECTA, chargeable: false, terminal: false },
    [DhlStatusType.RD]: { internalStatus: ShipmentStatusType.RECHAZADO, chargeable: false, terminal: false },
    [DhlStatusType.CM]: { internalStatus: ShipmentStatusType.CAMBIO_DOMICILIO, chargeable: false, terminal: false },
  };
  return map[key] ?? { internalStatus: ShipmentStatusType.PENDIENTE, chargeable: false, terminal: false };
}

export function mapDhlStatusTextToEnum(code: string): ShipmentStatusType {
  const statusMap: Record<string, ShipmentStatusType> = {
    'PU': ShipmentStatusType.RECOLECCION,
    'PL': ShipmentStatusType.EN_RUTA,
    'DF': ShipmentStatusType.EN_RUTA,
    'AR': ShipmentStatusType.EN_RUTA,
    'OH': ShipmentStatusType.PENDIENTE,
    'FD': ShipmentStatusType.ENTREGADO,
    'MS': ShipmentStatusType.PENDIENTE, // INCIDENCIA
    'TD': ShipmentStatusType.PENDIENTE, // INCIDENCIA
    'CI': ShipmentStatusType.EN_RUTA,
    'RW': ShipmentStatusType.EN_RUTA,
    'SA': ShipmentStatusType.EN_RUTA,
    'HN': ShipmentStatusType.EN_RUTA,
    'IA': ShipmentStatusType.EN_RUTA
  };

  return statusMap[code] || ShipmentStatusType.PENDIENTE;
}

/** Códigos de RESULTADO de entrega de DHL (los únicos con semántica de cobro/terminal). */
const DHL_OUTCOME_CODES = new Set<string>([
  DhlStatusType.OK, DhlStatusType.NH, DhlStatusType.BA, DhlStatusType.RD, DhlStatusType.CM,
]);

/**
 * Resuelve el estatus de la **API oficial de DHL** (Shipment Tracking - Unified,
 * `api-eu.dhl.com/track/shipments`) a la capa canónica interna.
 *
 * Combina dos señales de la respuesta:
 *  - `statusCode` de alto nivel: `pre-transit | transit | delivered | failure | unknown`.
 *  - `eventCode`: el código DHL del último evento (`status`): OK/NH/BA/RD/CM (resultado de
 *    entrega) o FD/PL/AR/… (movimientos de tránsito).
 *
 * Precedencia: entrega > incidencia con código fino (DEX) > fallo genérico > tránsito >
 * pre-tránsito. Devuelve `null` cuando NO conviene persistir (`unknown`/sin dato), para que
 * el llamador simplemente lo omita. Es la ÚNICA pieza que conoce la semántica DHL nativa.
 */
export function resolveDhlNativeStatus(
  statusCode?: string,
  eventCode?: string,
): CarrierStatusResolution | null {
  const sc = (statusCode || '').trim().toLowerCase();
  const ec = (eventCode || '').trim().toUpperCase();

  // 1. Entrega: lo más específico y terminal (cobra).
  if (sc === 'delivered' || ec === DhlStatusType.OK) return mapDhlCodeToInternal(DhlStatusType.OK);

  // 2. Incidencia con código de resultado conocido → DEX exacto (NH/BA/RD/CM).
  if (DHL_OUTCOME_CODES.has(ec)) return mapDhlCodeToInternal(ec);

  // 3. Fallo genérico sin código fino.
  if (sc === 'failure') {
    return { internalStatus: ShipmentStatusType.NO_ENTREGADO, chargeable: false, terminal: false };
  }

  // 4. En tránsito (paridad con FedEx IT/OD → EN_RUTA).
  if (sc === 'transit') {
    return { internalStatus: ShipmentStatusType.EN_RUTA, chargeable: false, terminal: false };
  }

  // 5. Pre-tránsito: etiqueta creada / info recibida, aún sin movimiento real.
  if (sc === 'pre-transit' || sc === 'pretransit') {
    return { internalStatus: ShipmentStatusType.PENDIENTE, chargeable: false, terminal: false };
  }

  // 6. Desconocido / sin dato → no persistir.
  return null;
}

/**
 * Clasifica el texto de una incidencia DHL (descripción del evento) a un código DEX
 * de la taxonomía de la app, por palabras clave. Útil cuando solo se tiene la
 * descripción libre del evento (a veces en otro idioma) y no un código fino.
 *
 * DEX03 = dirección incorrecta · DEX07 = rechazado · DEX08 = cliente no disponible
 * · DEX17 = cambio de fecha. Devuelve {code,label} o null si no se reconoce.
 * Ampliar los `keys` conforme veamos descripciones reales (incl. otros idiomas).
 */
export function classifyDhlException(
  text?: string | null,
): { code: '03' | '07' | '08' | '17'; label: string } | null {
  const t = (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // sin acentos
  if (!t) return null;

  const RULES: { code: '03' | '07' | '08' | '17'; label: string; keys: string[] }[] = [
    { code: '07', label: 'Rechazado', keys: ['rechaz', 'refus', 'reject', 'declin', 'devuelto por el cliente'] },
    { code: '03', label: 'Dirección incorrecta', keys: ['direccion', 'address', 'incorrect', 'wrong address', 'dom no exist', 'domicilio no exist', 'datos incorrect', 'no existe el domicilio'] },
    { code: '08', label: 'Cliente no disponible', keys: ['no disponible', 'ausente', 'cerrad', 'closed', 'not available', 'nobody', 'no one', 'recipient not', 'nadie', 'visita', 'sin moradores'] },
    { code: '17', label: 'Cambio de fecha solicitado', keys: ['cambio de fecha', 'reschedul', 'date change', 'future delivery', 'reprogram'] },
  ];

  for (const r of RULES) {
    if (r.keys.some((k) => t.includes(k))) return { code: r.code, label: r.label };
  }
  return null;
}

