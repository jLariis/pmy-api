import {
  ConsolidatedType, DispatchStatus, Frequency, IncomeSourceType, IncomeStatus,
  InventoryType, PaymentStatus, PaymentTypeEnum, Priority, ShipmentStatusType, ShipmentType,
  StatusEnum, TransferType, VehicleStatus, VehicleTypeEnum, ShipmentCanceledStatus, ShipmentFedexStatusType,
  DhlStatusType,
} from 'src/common/enums';
import { OutboundType } from 'src/common/enums/outbound-type.enum';
import { AuditAction, AuditModule, AuditResult, AuditSeverity } from 'src/common/enums/audit.enum';
import { AuditEntityType } from 'src/shipments/dto/audit-entity-type.dto';

export interface CatalogDef {
  type: string;
  label: string;
  enumObj: Record<string, string | number>;
  /** Valores extra (ej. variantes del frontend que no están en el enum backend). */
  extraKeys?: string[];
  /** Etiquetas explícitas por key. Si falta una key, se cae a `prettify(key)`. */
  labels?: Record<string, string>;
}

/** TODOS los enums del sistema → catálogo (unión front+back; los front-only van en extraKeys). */
export const CATALOG_DEFS: CatalogDef[] = [
  { type: 'status', label: 'Estatus (general)', enumObj: StatusEnum as any },
  { type: 'vehicle_type', label: 'Tipo de vehículo', enumObj: VehicleTypeEnum as any },
  { type: 'vehicle_status', label: 'Estatus de vehículo', enumObj: VehicleStatus as any },
  { type: 'priority', label: 'Prioridad', enumObj: Priority as any },
  { type: 'shipment_type', label: 'Tipo de envío', enumObj: ShipmentType as any },
  { type: 'shipment_status', label: 'Estatus de envío', enumObj: ShipmentStatusType as any },
  { type: 'shipment_canceled_status', label: 'Estatus cancelado (DEX)', enumObj: ShipmentCanceledStatus as any },
  { type: 'fedex_status', label: 'Estatus FedEx', enumObj: ShipmentFedexStatusType as any },
  // Estatus DHL: catálogo propio del carrier (namespace independiente de FedEx). Extendible desde UI.
  {
    type: 'dhl_status', label: 'Estatus DHL', enumObj: DhlStatusType as any,
    labels: {
      OK: 'POD / Entregado',
      NH: 'No estaba',
      BA: 'Dirección incorrecta',
      RD: 'Rechazado',
      CM: 'Cambio de domicilio',
    },
  },
  { type: 'income_status', label: 'Estatus de ingreso', enumObj: IncomeStatus as any },
  { type: 'income_source_type', label: 'Origen de ingreso', enumObj: IncomeSourceType as any },
  { type: 'payment_status', label: 'Estatus de pago', enumObj: PaymentStatus as any },
  { type: 'payment_type', label: 'Tipo de pago', enumObj: PaymentTypeEnum as any },
  { type: 'frequency', label: 'Frecuencia', enumObj: Frequency as any },
  { type: 'consolidated_type', label: 'Tipo de consolidado', enumObj: ConsolidatedType as any },
  { type: 'inventory_type', label: 'Tipo de inventario', enumObj: InventoryType as any },
  { type: 'outbound_type', label: 'Tipo de salida', enumObj: OutboundType as any },
  { type: 'transfer_type', label: 'Tipo de traslado', enumObj: TransferType as any },
  // DispatchStatus diverge entre back ('Pendiente'...) y front ('pendiente'/'en_progreso'/'cancelada'): unión.
  { type: 'dispatch_status', label: 'Estatus de despacho', enumObj: DispatchStatus as any, extraKeys: ['pendiente', 'en_progreso', 'cancelada'] },
  { type: 'audit_action', label: 'Auditoría · Acción', enumObj: AuditAction as any },
  { type: 'audit_module', label: 'Auditoría · Módulo', enumObj: AuditModule as any },
  { type: 'audit_result', label: 'Auditoría · Resultado', enumObj: AuditResult as any },
  { type: 'audit_severity', label: 'Auditoría · Severidad', enumObj: AuditSeverity as any },
  { type: 'audit_entity', label: 'Auditoría · Entidad', enumObj: AuditEntityType as any },
];

/** Etiqueta legible por defecto a partir de la key ('en_ruta' → 'En ruta'). */
export function prettify(value: string): string {
  const s = String(value).replace(/[_-]/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface SeedItem { type: string; key: string; label: string; sortOrder: number }

/** Deriva los items (key = valor del enum; dedupe por key). */
export function deriveItems(def: CatalogDef): SeedItem[] {
  const keys: string[] = [
    ...Object.values(def.enumObj).map((v) => String(v)),
    ...(def.extraKeys || []),
  ];
  // Dedupe CASE-INSENSITIVE: el índice único de la BD usa collation utf8mb4_unicode_ci,
  // así que 'Pendiente' y 'pendiente' colisionan. Tratamos las variantes de solo-mayúsculas
  // como duplicados (gana la primera, normalmente la del enum backend).
  const seen = new Set<string>();
  const items: SeedItem[] = [];
  let order = 0;
  for (const key of keys) {
    const norm = key.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    const label = def.labels?.[key] ?? prettify(key);
    items.push({ type: def.type, key, label, sortOrder: order++ });
  }
  return items;
}

/**
 * Mapa de USO en BD para el guard de borrado: dónde se almacena cada key.
 * Si un valor está referenciado en estas columnas, NO se permite borrarlo.
 * (Los valores `isSystem` están protegidos aparte; esto cubre valores agregados
 * por el usuario y da el aviso de "está en uso".)
 */
export const CATALOG_USAGE: Record<string, { table: string; column: string }[]> = {
  vehicle_type: [{ table: 'vehicle', column: 'type' }],
  vehicle_status: [{ table: 'vehicle', column: 'status' }],
  frequency: [{ table: 'expense', column: 'frequency' }],
  priority: [{ table: 'shipment', column: 'priority' }],
  shipment_type: [
    { table: 'shipment', column: 'shipmentType' },
    { table: 'charge_shipment', column: 'shipmentType' },
    { table: 'income', column: 'shipmentType' },
  ],
  shipment_status: [
    { table: 'shipment', column: 'status' },
    { table: 'charge_shipment', column: 'status' },
    { table: 'shipment_status', column: 'status' },
  ],
  income_status: [{ table: 'income', column: 'incomeType' }],
  income_source_type: [{ table: 'income', column: 'sourceType' }],
  payment_status: [{ table: 'payment', column: 'status' }],
  transfer_type: [{ table: 'transfer', column: 'type' }],
};
