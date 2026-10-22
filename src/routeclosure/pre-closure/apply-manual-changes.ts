import { BadRequestException } from '@nestjs/common';
import { Between, EntityManager } from 'typeorm';
import { ChargeShipment, Income, Shipment, ShipmentStatus } from 'src/entities';
import { RouteClosureManualStatus } from 'src/entities/route-closure-manual-status.entity';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { shipmentIncomeWhere } from 'src/common/shipment-income-where.util';
import { annulDeliveredIncome } from 'src/common/income-annul.util';
import { AuditService } from 'src/audit/audit.service';
import { weekRange } from 'src/tracking-sync/income/week.util';
import { noVanIncomeDecision } from '../novan-income.util';
import {
  buildManualReason,
  MANUAL_OPTIONS,
  ManualOption,
  manualIncomeEffect,
  manualOptionToStatus,
  ROUTE_CLOSURE_MANUAL_SOURCE,
  statusLabel,
} from './manual-status.util';

/** Cambio de estatus que el usuario capturó en la comprobación con el chofer. */
export interface ManualStatusChangeInput {
  id: string;
  isCharge: boolean;
  trackingNumber: string;
  /** Estatus que el sistema tenía cuando se abrió la pantalla (detecta cambios del cron). */
  previousStatus: string;
  option: ManualOption;
  /**
   * Estatus con el que el cierre veía la guía (el del DÍA DE LA RUTA). Si es distinto del vivo, la
   * guía se movió después (p. ej. FedEx la entregó al día siguiente): el cambio queda SOLO como
   * registro del cierre y no toca el estatus vivo ni el ingreso (decisión del usuario 2026-10-21).
   */
  closureStatus?: string;
}

export interface ManualChangesContext {
  dispatchId: string;
  is315: boolean;
  subsidiary: { id: string; fedexCostPackage?: number | null };
  routeClosureId: string;
  userId: string | null;
  userName: string;
  folio: string | null;
  /** Día de la ruta (YYYY-MM-DD). */
  routeDay: string;
  driverNames: string;
  /** Fecha del ingreso: día de la ruta (igual que el resto del cierre). */
  routeIncomeDate: Date;
  /** Hora del cierre: va en el historial. */
  now: Date;
}

/** 23:59:59 Hermosillo del día de la ruta (routeIncomeDate = 00:00 Hermosillo = 07:00Z). */
const routeDayEnd = (ctx: ManualChangesContext) => new Date(ctx.routeIncomeDate.getTime() + 24 * 3600 * 1000 - 1000);

export interface ManualChangesResult {
  applied: number;
  /** Cambios que solo quedaron como registro del cierre (guía movida después del día de la ruta). */
  recordOnly: number;
  incomesCreated: number;
  incomesUpgraded: number;
  incomesAnnulled: number;
}

interface LoadedChange {
  input: ManualStatusChangeInput;
  entity: { id: string; trackingNumber: string; status: string; shipmentType: string };
}

/**
 * Aplica, dentro de la transacción del cierre, los estatus que el usuario corrigió a mano contra lo
 * que entregó el chofer. Primero valida TODO (la guía es de la salida, no es DHL, y su estatus no
 * cambió mientras se cerraba); si algo falla no se escribe nada. Luego, por cambio: estatus vivo,
 * renglón de historial con `source='route_closure_manual'`, auditoría en
 * `route_closure_manual_status` y el efecto en el ingreso (solo paquetes fuera de 31.5).
 */
export async function applyManualChanges(
  manager: EntityManager,
  auditService: AuditService | undefined,
  ctx: ManualChangesContext,
  changes: ManualStatusChangeInput[],
): Promise<ManualChangesResult> {
  const result: ManualChangesResult = { applied: 0, recordOnly: 0, incomesCreated: 0, incomesUpgraded: 0, incomesAnnulled: 0 };
  if (!changes?.length) return result;

  const loaded = await loadAndValidate(manager, ctx.dispatchId, changes);

  for (const { input, entity } of loaded) {
    const { status, exceptionCode } = manualOptionToStatus(input.option);
    const recordOnly = !!input.closureStatus && String(input.closureStatus) !== String(entity.status);
    const fromStatus = recordOnly ? String(input.closureStatus) : entity.status;
    let reason = buildManualReason({
      userName: ctx.userName,
      trackingNumber: entity.trackingNumber,
      from: statusLabel(fromStatus),
      to: statusLabel(status, exceptionCode),
      folio: ctx.folio,
      routeDay: ctx.routeDay,
      driverNames: ctx.driverNames,
    });
    if (recordOnly) reason += ` Solo registro del cierre: después la guía quedó ${statusLabel(entity.status)}.`;

    if (!recordOnly) {
      await manager.update(input.isCharge ? ChargeShipment : Shipment, { id: entity.id }, { status });
    }

    await manager.save(
      ShipmentStatus,
      manager.create(ShipmentStatus, {
        ...(input.isCharge ? { chargeShipment: { id: entity.id } } : { shipment: { id: entity.id } }),
        status,
        exceptionCode: exceptionCode ?? '',
        // Solo registro: al final del día de la ruta, antes de lo que pasó después.
        timestamp: recordOnly ? routeDayEnd(ctx) : ctx.now,
        notes: reason,
        source: ROUTE_CLOSURE_MANUAL_SOURCE,
      } as any),
    );

    await manager.save(
      RouteClosureManualStatus,
      manager.create(RouteClosureManualStatus, {
        routeClosureId: ctx.routeClosureId,
        shipmentId: input.isCharge ? null : entity.id,
        chargeShipmentId: input.isCharge ? entity.id : null,
        trackingNumber: entity.trackingNumber,
        previousStatus: fromStatus,
        newStatus: status,
        exceptionCode,
        reason,
        appliedToLive: !recordOnly,
        createdById: ctx.userId,
      }),
    );

    if (recordOnly) result.recordOnly++;
    else await applyIncomeEffect(manager, auditService, ctx, input, entity, exceptionCode, result);
    result.applied++;
  }
  return result;
}

async function loadAndValidate(manager: EntityManager, dispatchId: string, changes: ManualStatusChangeInput[]): Promise<LoadedChange[]> {
  const history: { shipmentId: string | null; chargeShipmentId: string | null }[] = await manager.query(
    `SELECT shipmentId, chargeShipmentId FROM package_dispatch_history WHERE dispatchId = ?`,
    [dispatchId],
  );
  const inRoute = new Set(history.map((h) => (h.chargeShipmentId ? `c:${h.chargeShipmentId}` : `s:${h.shipmentId}`)));

  const loaded: LoadedChange[] = [];
  for (const input of changes) {
    const tn = input.trackingNumber;
    if (!MANUAL_OPTIONS.includes(input.option)) {
      throw new BadRequestException(`La guía ${tn} trae un estatus que no se puede capturar a mano.`);
    }
    if (!inRoute.has(`${input.isCharge ? 'c' : 's'}:${input.id}`)) {
      throw new BadRequestException(`La guía ${tn} no pertenece a esta salida a ruta.`);
    }
    const entity = await manager.findOne(input.isCharge ? ChargeShipment : Shipment, {
      where: { id: input.id },
      select: ['id', 'trackingNumber', 'status', 'shipmentType'] as any,
    });
    if (!entity) throw new BadRequestException(`La guía ${tn} no pertenece a esta salida a ruta.`);
    if (String(entity.shipmentType).toLowerCase() === ShipmentType.DHL) {
      throw new BadRequestException(`La guía ${tn} es DHL: se confirma con su código DHL.`);
    }
    if (String(entity.status) !== String(input.previousStatus)) {
      throw new BadRequestException(`La guía ${tn} cambió mientras cerrabas; recarga la pantalla.`);
    }
    // Copia: el estatus "antes" no debe cambiar cuando se actualiza la entidad.
    loaded.push({ input, entity: { ...(entity as any) } });
  }
  return loaded;
}

async function applyIncomeEffect(
  manager: EntityManager,
  auditService: AuditService | undefined,
  ctx: ManualChangesContext,
  input: ManualStatusChangeInput,
  entity: LoadedChange['entity'],
  exceptionCode: string | null,
  result: ManualChangesResult,
): Promise<void> {
  if (input.isCharge || ctx.is315) return;
  const { status: to } = manualOptionToStatus(input.option);

  // Se decide con lo que hay en la BD, no con lo que creía la pantalla.
  const delivered = await manager.findOne(Income, {
    where: shipmentIncomeWhere(entity.id, entity.trackingNumber, { incomeType: IncomeStatus.ENTREGADO, sourceType: IncomeSourceType.SHIPMENT }),
  });
  const effect = manualIncomeEffect({ isCharge: false, is315: false, from: entity.status, to, hasDeliveredIncome: !!delivered });
  const cost = Number(ctx.subsidiary.fedexCostPackage ?? 0);

  if (effect === 'create_delivered') {
    // Mismo antiduplicado que el motor (income-executor): un ingreso por shipment+semana; si hay un
    // NO_ENTREGADO se sube a ENTREGADO; si ya hay ENTREGADO, nada.
    const { start, end } = weekRange(ctx.routeIncomeDate);
    const existing = await manager.findOne(Income, {
      where: shipmentIncomeWhere(entity.id, entity.trackingNumber, { sourceType: IncomeSourceType.SHIPMENT, date: Between(start, end) }),
    });
    if (!existing) {
      await createIncome(manager, ctx, entity, IncomeStatus.ENTREGADO, null, cost);
      result.incomesCreated++;
    } else if (String(existing.incomeType) !== String(IncomeStatus.ENTREGADO)) {
      await manager.update(Income, existing.id, { incomeType: IncomeStatus.ENTREGADO, nonDeliveryStatus: null } as any);
      result.incomesUpgraded++;
    }
    return;
  }

  if (effect === 'annul_delivered') {
    const annulled = await annulDeliveredIncome(manager, auditService, {
      trackingNumber: entity.trackingNumber,
      shipmentId: entity.id,
      opDate: ctx.routeIncomeDate,
      userId: ctx.userId,
      reason: 'cierre_manual',
    });
    result.incomesAnnulled += annulled.length;

    // El DEX nuevo cobra por la misma regla que el resto del cierre (charge_rule decide en lectura;
    // DEX08 solo con 3 días distintos en la semana).
    if (!exceptionCode) return;
    const dex08Rows: { timestamp: Date }[] =
      exceptionCode === '08'
        ? await manager.query(`SELECT timestamp FROM shipment_status WHERE shipmentId = ? AND exceptionCode = '08'`, [entity.id])
        : [];
    const decision = noVanIncomeDecision({
      trackingNumber: entity.trackingNumber,
      delivered: false,
      dexCode: exceptionCode,
      resolved: true,
      dex08Dates: [...dex08Rows.map((r) => new Date(r.timestamp)), ctx.now],
    });
    if (decision) {
      await createIncome(manager, ctx, entity, decision.incomeType, decision.nonDeliveryStatus, cost);
      result.incomesCreated++;
    }
  }
}

async function createIncome(
  manager: EntityManager,
  ctx: ManualChangesContext,
  entity: LoadedChange['entity'],
  incomeType: IncomeStatus,
  nonDeliveryStatus: string | null,
  cost: number,
): Promise<void> {
  await manager.save(
    Income,
    manager.create(Income, {
      trackingNumber: entity.trackingNumber,
      subsidiary: { id: ctx.subsidiary.id } as any,
      shipment: { id: entity.id } as any,
      shipmentType: ShipmentType.FEDEX,
      cost,
      incomeType,
      nonDeliveryStatus,
      isGrouped: false,
      sourceType: IncomeSourceType.SHIPMENT,
      date: ctx.routeIncomeDate,
      createdById: ctx.userId,
    } as any),
  );
}
