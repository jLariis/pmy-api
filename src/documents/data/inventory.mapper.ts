import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { truncate } from './unloading.mapper';

const TZ = 'America/Hermosillo';
const MAX_PREVIEW = 15;

export interface InventoryPackage {
  trackingNumber: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientZip?: string;
  recipientPhone?: string;
  commitDateTime?: string;
  isCharge?: boolean;
  isHighValue?: boolean;
  /** No persistido en backend (Shipment/ChargeShipment no tienen columna `isValid`); default true. */
  isValid?: boolean;
  payment?: { amount: number | string; type: string } | null;
}

export interface InventoryInput {
  subsidiaryName: string;
  trackingNumber?: string;
  /** Fecha del inventario (createdAt del folio). Default: `now`. */
  inventoryDate?: string | Date;
  packages: InventoryPackage[];
  /** Gap conocido: `Inventory` (entidad) no persiste estas listas (solo viven en el
   * payload transitorio del frontend antes de guardar); si no se proveen, las
   * secciones correspondientes simplemente no aparecen (`when` en Excel / condicional en PDF). */
  missingTrackings?: string[];
  unScannedTrackings?: string[];
  now?: Date;
}

/** `${type} $${amount}` crudo (sin Intl), fiel a C5/C6 (frontend `inventory-pdf/excel-generator`). */
export function formatPayment(payment?: { amount: number | string; type: string } | null): string {
  if (!payment || payment.amount == null) return '';
  return `${payment.type} $${payment.amount}`;
}

export function buildInventoryData(input: InventoryInput): Record<string, any> {
  const now = input.now ?? new Date();
  const zonedNow = toZonedTime(now, TZ);
  const generatedDate = format(zonedNow, 'yyyy-MM-dd');
  const generatedTime = format(zonedNow, 'HH:mm:ss');

  const invDate = input.inventoryDate ? new Date(input.inventoryDate) : now;
  const zonedInvDate = toZonedTime(invDate, TZ);
  const inventoryDate = format(zonedInvDate, 'yyyy-MM-dd');
  const inventoryDateTime = format(zonedInvDate, 'yyyy-MM-dd HH:mm');

  const packages = input.packages ?? [];
  const rows = packages.map((p, i) => {
    const hasPayment = p.payment?.amount != null;
    const isValid = p.isValid !== false;
    let date = '';
    let time = '';
    let timeXlsx = '';
    if (p.commitDateTime) {
      const z = toZonedTime(new Date(p.commitDateTime), TZ);
      date = format(z, 'yyyy-MM-dd');
      time = format(z, 'HH:mm');
      timeXlsx = format(z, 'HH:mm:ss');
    }
    return {
      index: i + 1,
      isCharge: !!p.isCharge,
      hasPayment,
      isHighValue: !!p.isHighValue,
      isValid,
      trackingNumber: p.trackingNumber,
      recipientName: truncate(p.recipientName || '', 20),
      recipientNameXlsx: p.recipientName || '',
      recipientAddress: truncate(p.recipientAddress || '', 22),
      recipientAddressXlsx: p.recipientAddress || '',
      recipientZip: p.recipientZip || '',
      payment: formatPayment(p.payment),
      date,
      time,
      timeXlsx,
      recipientPhone: p.recipientPhone || '',
      rowClass: i % 2 === 0 ? 'even' : '',
      rowFill: i % 2 === 0 ? 'F2F2F2' : null,
    };
  });

  const stats = {
    total: rows.length,
    valid: rows.filter((r) => r.isValid).length,
    carga: rows.filter((r) => r.isCharge).length,
    highValue: rows.filter((r) => r.isHighValue).length,
  };

  const missingTrackings = input.missingTrackings ?? [];
  const unScannedTrackings = input.unScannedTrackings ?? [];
  const missingPreview = missingTrackings.slice(0, MAX_PREVIEW);
  const missingExtra = Math.max(0, missingTrackings.length - MAX_PREVIEW);
  const unScannedPreview = unScannedTrackings.slice(0, MAX_PREVIEW);
  const unScannedExtra = Math.max(0, unScannedTrackings.length - MAX_PREVIEW);

  return {
    subsidiaryName: input.subsidiaryName || 'N/A',
    trackingNumber: input.trackingNumber || '',
    inventoryDate,
    inventoryDateTime,
    generatedDate,
    generatedTime,
    totalPackages: rows.length,
    stats,
    rows,
    missingTrackings,
    hasMissing: missingTrackings.length > 0,
    missingPreview,
    missingExtra,
    hasMissingExtra: missingExtra > 0,
    unScannedTrackings,
    hasUnScanned: unScannedTrackings.length > 0,
    unScannedPreview,
    unScannedExtra,
    hasUnScannedExtra: unScannedExtra > 0,
  };
}
