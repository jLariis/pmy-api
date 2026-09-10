import { Income } from '../../entities/income.entity';
import { ConsolidadorRow } from '../consolidador.types';

/** Mapea un `Income` (con relaciones shipment/charge cargadas) a la fila del consolidador. */
export function mapIncomeToRow(i: Income): ConsolidadorRow {
  const shipment: any = i.shipment ?? null;
  const charge: any = i.charge ?? null;
  const date = i.date instanceof Date ? i.date : new Date(i.date);
  return {
    id: i.id,
    trackingNumber: i.trackingNumber ?? null,
    sourceType: i.sourceType,
    incomeType: i.incomeType,
    cost: Number(i.cost),
    originalCost: i.originalCost != null ? Number(i.originalCost) : null,
    date: date.toISOString(),
    consNumber: charge?.consNumber ?? null,
    consolidatedId: shipment?.consolidatedId ?? null,
    routeId: shipment?.routeId ?? null,
    shipmentId: shipment?.id ?? null,
    shipmentStatus: shipment?.status ?? null,
    editReason: i.editReason ?? null,
    secondAbordApplied: i.secondAbordApplied ?? null,
  };
}
