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
 * Listo para enchufar la API oficial de DHL: basta llamar aquí con el código que
 * devuelva DHL. (17track/WhereParcel quedaron descartados.)
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

/**
 * Mapea el ESTATUS PRINCIPAL de 17TRACK v2.4 (`track_info.latest_status.status`)
 * al estatus local de la app. OJO: son los valores de 17TRACK (InTransit,
 * Delivered, …), NO los códigos nativos de DHL (PU/PL/…); por eso es un mapa
 * aparte de `mapDhlStatusTextToEnum`.
 *
 * Devuelve `null` para estados que NO conviene persistir (NotFound / sin dato),
 * para que el servicio simplemente los omita.
 */
export function map17TrackStatusToLocal(status: string): ShipmentStatusType | null {
  const key = (status || '').trim().toLowerCase();
  const map: Record<string, ShipmentStatusType | null> = {
    delivered: ShipmentStatusType.ENTREGADO,
    outfordelivery: ShipmentStatusType.EN_RUTA,
    intransit: ShipmentStatusType.EN_TRANSITO,
    inforeceived: ShipmentStatusType.RECOLECCION,
    availableforpickup: ShipmentStatusType.ES_OCURRE,
    deliveryfailure: ShipmentStatusType.NO_ENTREGADO,
    exception: ShipmentStatusType.PENDIENTE, // incidencia (espejo de MS/TD)
    expired: ShipmentStatusType.PENDIENTE,
    notfound: null,
    undelivered: ShipmentStatusType.NO_ENTREGADO,
  };
  return key in map ? map[key] : ShipmentStatusType.PENDIENTE;
}

/**
 * Clasifica el texto de una incidencia DHL (descripción del evento de WhereParcel)
 * a un código DEX de la taxonomía de la app, por palabras clave. WhereParcel NO
 * entrega el código DEX directo para DHL (solo `exception` + descripción libre,
 * a veces en otro idioma), por eso se infiere del texto.
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

/**
 * Mapea el ESTATUS normalizado de WhereParcel (campo `data.status`) al estatus
 * local de la app. WhereParcel usa un set estándar (delivered, in_transit,
 * out_for_delivery, …). Normalizamos quitando separadores para tolerar variantes
 * (snake_case / camelCase / espacios).
 *
 * Devuelve `null` para estados que NO conviene persistir (sin info), para que el
 * servicio simplemente los omita.
 */
export function mapWhereParcelStatusToLocal(status: string): ShipmentStatusType | null {
  const key = (status || '').trim().toLowerCase().replace(/[\s_-]/g, '');
  const map: Record<string, ShipmentStatusType | null> = {
    delivered: ShipmentStatusType.ENTREGADO,
    outfordelivery: ShipmentStatusType.EN_RUTA,
    intransit: ShipmentStatusType.EN_TRANSITO,
    inforeceived: ShipmentStatusType.RECOLECCION,
    pending: ShipmentStatusType.PENDIENTE,
    availableforpickup: ShipmentStatusType.ES_OCURRE,
    failedattempt: ShipmentStatusType.NO_ENTREGADO,
    deliveryfailure: ShipmentStatusType.NO_ENTREGADO,
    undelivered: ShipmentStatusType.NO_ENTREGADO,
    returned: ShipmentStatusType.NO_ENTREGADO,
    returntosender: ShipmentStatusType.NO_ENTREGADO,
    exception: ShipmentStatusType.PENDIENTE, // incidencia
    expired: ShipmentStatusType.PENDIENTE,
    notfound: null,
    unknown: null,
  };
  return key in map ? map[key] : ShipmentStatusType.PENDIENTE;
}