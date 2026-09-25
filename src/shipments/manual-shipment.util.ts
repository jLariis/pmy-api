import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { ShipmentStatusType, TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';

/**
 * Alta manual de paquetes (desembarque "sobrante → Crear nuevo" y el "+" del
 * header). Reglas puras para que ambos flujos validen igual.
 */

/** Qué se crea: paquete normal (`shipment`) o carga/F2 (`charge_shipment`). */
export type ManualPackageKind = 'shipment' | 'charge';

export interface ManualTrackingInput {
  carrier?: ShipmentType | string | null;
  trackingNumber?: string | null;
  dhlUniqueId?: string | null;
}

export type ManualTrackingResult =
  | { ok: true; carrier: ShipmentType; trackingNumber: string; dhlUniqueId: string | null }
  | { ok: false; message: string };

/** Guía FedEx (master): 10 a 12 dígitos, igual que el escáner. */
const FEDEX_VALID = /^\d{10,12}$/;
/** Guía DHL (waybill): 10 dígitos. Es con la que se rastrea en la API de DHL. */
const DHL_WAYBILL_VALID = /^\d{10}$/;
/** ID de pieza DHL: JD/JJD + 16-20 dígitos, o numérico de 18. */
const DHL_PIECE_VALID = /^(J?JD\d{16,20}|\d{18})$/;

const clean = (v?: string | null) => (v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** "FedEx" por defecto; cualquier otro valor distinto de DHL cae a FedEx. */
export function resolveManualCarrier(carrier?: string | null): ShipmentType {
  return String(carrier ?? '').toLowerCase() === ShipmentType.DHL ? ShipmentType.DHL : ShipmentType.FEDEX;
}

export function resolveManualKind(kind?: string | null): ManualPackageKind {
  return String(kind ?? '').toLowerCase() === 'charge' ? 'charge' : 'shipment';
}

/**
 * Valida y normaliza la guía según la paquetería. Mensajes en lenguaje simple
 * (los ve el usuario operativo tal cual).
 */
export function normalizeManualTracking(input: ManualTrackingInput): ManualTrackingResult {
  const carrier = resolveManualCarrier(input.carrier);
  const tn = clean(input.trackingNumber);

  if (carrier === ShipmentType.FEDEX) {
    if (!tn) return { ok: false, message: 'Escribe el número de guía.' };
    if (!FEDEX_VALID.test(tn)) {
      return { ok: false, message: 'La guía de FedEx debe tener de 10 a 12 números.' };
    }
    return { ok: true, carrier, trackingNumber: tn, dhlUniqueId: null };
  }

  // DHL: la guía (10 dígitos) es obligatoria; el ID de pieza (JD) es opcional.
  if (!tn) return { ok: false, message: 'Escribe la guía de DHL (10 números).' };
  if (DHL_PIECE_VALID.test(tn)) {
    return {
      ok: false,
      message: 'Eso es el ID de pieza (JD). Ponlo en "ID de pieza" y escribe la guía de DHL de 10 números.',
    };
  }
  if (!DHL_WAYBILL_VALID.test(tn)) {
    return { ok: false, message: 'La guía de DHL debe tener 10 números.' };
  }

  const piece = clean(input.dhlUniqueId);
  if (piece && !DHL_PIECE_VALID.test(piece)) {
    return { ok: false, message: 'El ID de pieza de DHL no es válido (empieza con JD).' };
  }
  // El lector entrega "JJD"; la BD guarda "JD".
  const dhlUniqueId = piece ? piece.replace(/^JJD/, 'JD') : null;
  return { ok: true, carrier, trackingNumber: tn, dhlUniqueId };
}

/**
 * ¿Un registro existente bloquea el alta? Solo si sigue "vivo": una guía en
 * estado terminal (entregada, devuelta…) puede volver a entrar (números
 * reciclados / reingresos).
 */
export function blocksManualDuplicate(existing: { status?: ShipmentStatusType | string | null; active?: boolean | null }): boolean {
  if (existing.active === false) return false;
  return !TERMINAL_SHIPMENT_STATUSES.includes(existing.status as ShipmentStatusType);
}
