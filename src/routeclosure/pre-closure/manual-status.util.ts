import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { isDeliveredStatus } from 'src/common/ld-rule.util';

/** Opciones FedEx del selector "Según el chofer" del cierre con pre-cierre. */
export const MANUAL_OPTIONS = ['ENTREGADO', 'DEX03', 'DEX07', 'DEX08', 'DEX12', 'OCURRE'] as const;
export type ManualOption = (typeof MANUAL_OPTIONS)[number];

/** Origen del renglón de `shipment_status` capturado a mano en el cierre. */
export const ROUTE_CLOSURE_MANUAL_SOURCE = 'route_closure_manual';

/**
 * Estatus + código con el que se guarda cada opción. DEX12 no tiene estatus propio en el sistema
 * (`empresa_cerrada` es el STAT42): va como `no_entregado` con código '12', que es lo que cuentan
 * el PDF y el Excel del cierre (route-closure.mapper).
 */
const OPTION_STATUS: Record<ManualOption, { status: ShipmentStatusType; exceptionCode: string | null }> = {
  ENTREGADO: { status: ShipmentStatusType.ENTREGADO, exceptionCode: null },
  DEX03: { status: ShipmentStatusType.DIRECCION_INCORRECTA, exceptionCode: '03' },
  DEX07: { status: ShipmentStatusType.RECHAZADO, exceptionCode: '07' },
  DEX08: { status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE, exceptionCode: '08' },
  DEX12: { status: ShipmentStatusType.NO_ENTREGADO, exceptionCode: '12' },
  OCURRE: { status: ShipmentStatusType.ES_OCURRE, exceptionCode: null },
};

export function manualOptionToStatus(option: ManualOption): { status: ShipmentStatusType; exceptionCode: string | null } {
  return { ...OPTION_STATUS[option] };
}

const CODE_LABEL: Record<string, string> = {
  [ShipmentStatusType.ENTREGADO]: 'Entregado',
  [ShipmentStatusType.DIRECCION_INCORRECTA]: 'DEX03',
  [ShipmentStatusType.RECHAZADO]: 'DEX07',
  [ShipmentStatusType.CLIENTE_NO_DISPONIBLE]: 'DEX08',
  [ShipmentStatusType.ES_OCURRE]: 'Ocurre',
};

/** Etiqueta en llano de un estatus para el motivo ("Entregado", "DEX08", "En ruta"…). */
export function statusLabel(status: string, exceptionCode?: string | null): string {
  const s = String(status ?? '').toLowerCase();
  if (s === ShipmentStatusType.NO_ENTREGADO && exceptionCode) return `DEX${exceptionCode}`;
  if (CODE_LABEL[s]) return CODE_LABEL[s];
  const text = s.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface ManualReasonInput {
  userName: string;
  trackingNumber: string;
  from: string;
  to: string;
  folio: string | null;
  routeDay: string;
  driverNames: string;
}

/** Motivo automático del cambio manual (va en `shipment_status.notes` y en la auditoría). */
export function buildManualReason(i: ManualReasonInput): string {
  return (
    `Cambio manual en cierre de ruta por ${i.userName}: guía ${i.trackingNumber} de ${i.from} a ${i.to}. ` +
    `Ruta ${i.folio || 'sin folio'} del ${i.routeDay}, chofer ${i.driverNames || 'sin chofer'}.`
  );
}

export type ManualIncomeEffect = 'create_delivered' | 'annul_delivered' | 'none';

/**
 * Qué hace el cambio manual con el ingreso. Solo paquetes en rutas que no son 31.5: las cargas
 * (F2) cobran agrupado y las rutas 31.5 no cobran por paquete.
 */
export function manualIncomeEffect(i: {
  isCharge: boolean;
  is315: boolean;
  from: string;
  to: string;
  hasDeliveredIncome: boolean;
}): ManualIncomeEffect {
  if (i.isCharge || i.is315) return 'none';
  const wasDelivered = isDeliveredStatus(i.from);
  const isDelivered = isDeliveredStatus(i.to);
  if (isDelivered && !wasDelivered) return 'create_delivered';
  if (wasDelivered && !isDelivered && i.hasDeliveredIncome) return 'annul_delivered';
  return 'none';
}
