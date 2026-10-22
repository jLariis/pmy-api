import { EntityManager } from 'typeorm';
import { Income } from 'src/entities';
import { shipmentIncomeWhere } from './shipment-income-where.util';
import { IncomeStatus } from './enums/income-status.enum';
import { IncomeSourceType } from './enums/income-source-type.enum';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction, AuditModule, AuditResult, AuditSeverity } from './enums/audit.enum';

export type IncomeAnnulReason = 'devolucion' | 'cierre_manual';

const REASON_LABEL: Record<IncomeAnnulReason, string> = {
  devolucion: 'por devolución',
  cierre_manual: 'por cambio manual en el cierre de ruta',
};

/**
 * Anula (soft) el/los ingreso(s) `entregado` VIGENTE(s) de una guía y crea por cada uno una
 * fila de REVERSA (−cost) ligada por `reversalOfIncomeId`. Ambas quedan `active=false`: los
 * reportes que SUMAN netean a 0 (incluyan o no inactivos) y los que CUENTAN filtran `active`.
 * Queda registrado quién anuló (en `annulledById` del original y en `createdById` de la reversa)
 * y una entrada en `audit_log`. Solo shipment (las cargas cobran agrupado).
 * Lo usan devoluciones y el cierre de ruta con pre-cierre.
 */
export async function annulDeliveredIncome(
  manager: EntityManager,
  auditService: Pick<AuditService, 'log'> | undefined,
  args: { trackingNumber: string; shipmentId: string; opDate: Date; userId: string | null; reason: IncomeAnnulReason },
): Promise<string[]> {
  const { trackingNumber, shipmentId, opDate, userId, reason } = args;
  // Solo el ingreso del registro elegido (o el de la guía sin registro ligado): el de otro
  // consolidado es otro flujo y no se toca.
  const originals = await manager.find(Income, {
    where: shipmentIncomeWhere(shipmentId, trackingNumber, {
      incomeType: IncomeStatus.ENTREGADO,
      sourceType: IncomeSourceType.SHIPMENT,
    }),
    relations: ['subsidiary', 'shipment'],
  });

  for (const original of originals) {
    // 1) Soft-anular el original (quién / cuándo).
    await manager.update(Income, original.id, {
      active: false,
      annulledAt: opDate,
      annulledById: userId,
    });

    // 2) Fila de reversa (−cost) atribuida a quien anuló, ligada al original.
    await manager.save(
      manager.create(Income, {
        trackingNumber: original.trackingNumber,
        subsidiary: original.subsidiary ? ({ id: original.subsidiary.id } as any) : null,
        shipment: original.shipment ? ({ id: original.shipment.id } as any) : null,
        shipmentType: original.shipmentType,
        cost: -Number(original.cost),
        incomeType: IncomeStatus.ENTREGADO,
        nonDeliveryStatus: original.nonDeliveryStatus,
        isGrouped: false,
        sourceType: IncomeSourceType.SHIPMENT,
        date: opDate,
        createdById: userId,
        active: false,
        reversalOfIncomeId: original.id,
      }),
    );

    // 3) Auditoría (dominio): quién anuló, monto, sucursal.
    auditService?.log({
      module: AuditModule.INGRESOS,
      action: AuditAction.DELETE,
      result: AuditResult.SUCCESS,
      severity: AuditSeverity.WARNING,
      userId: userId ?? undefined,
      subsidiaryId: original.subsidiary?.id,
      entityName: 'income',
      entityId: original.id,
      description: `Ingreso "entregado" anulado ${REASON_LABEL[reason]} de la guía ${trackingNumber} ($${Number(original.cost)})`,
      metadata: { trackingNumber, cost: Number(original.cost), reason },
    });
  }
  return originals.map((o) => o.id);
}
