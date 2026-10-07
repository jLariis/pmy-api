import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ApprovalRequest, ApprovalType } from 'src/entities/approval-request.entity';
import { HolidaysService } from 'src/holidays/holidays.service';
import { isSundayOrMexHoliday } from 'src/shipments/sunday-holiday.util';
import { toHermosilloDateString } from 'src/common/utils';
import { ConsolidatedFamilyLoader, familyKey } from './consolidated-family.loader';
import { ConsolidatedActionsExecutor } from './consolidated-actions.executor';
import { randomUUID } from 'crypto';
import { planChangeDate, planChangeSubsidiary, planDelete } from './consolidated-actions.plan';
import { planChangeType, TargetType } from './consolidated-type.plan';
import { ActionPlan, ConsolidatedFamily, PlanSummary } from './consolidated-actions.types';

export interface ConsolidatedActionPayload {
  newSubsidiaryId?: string;
  newDate?: string;
  /** Cambio de tipo: a carga (F2) o a paquete (master). */
  toType?: TargetType;
  /** Solo estas guías (vacío = consolidado completo). */
  trackingNumbers?: string[];
  /** Consolidado al que pasan las guías elegidas (p. ej. la F2 del mismo correo). */
  targetConsolidatedId?: string;
  /** Si se crea carga nueva: ¿es de 1.5 ton? */
  isHalfTon?: boolean;
}

/** Impacto que ve quien pide y quien autoriza (antes → después). */
export interface ConsolidatedImpact {
  type: ApprovalType;
  targetId: string;
  label: string;
  consNumber: string;
  subsidiaryId: string;
  subsidiaryName: string;
  targetKey: string;
  counts: { shipments: number; charges: number; enRuta: number; withIncome: number; withRoute: number; devoluciones: number };
  summary: PlanSummary;
  warnings: string[];
  /** Cambio pedido en llano: sucursal A → B / fecha A → B. */
  change: { from: string; to: string } | null;
  /** Sucursal cuyo supervisor autoriza (destino en cambio de sucursal). */
  approverSubsidiaryId: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACTION_LABEL: Partial<Record<ApprovalType, string>> = {
  delete_consolidado: 'eliminar',
  change_subsidiary_consolidado: 'cambiar de sucursal',
  change_date_consolidado: 'cambiar la fecha de',
  change_type_consolidado: 'cambiar el tipo de',
};

/**
 * Acciones sobre consolidado con autorización (borrar, cambiar sucursal, cambiar fecha):
 * valida, calcula el impacto y, al autorizar, aplica el plan en UNA transacción.
 * Spec: docs/superpowers/specs/2026-10-06-consolidado-acciones-design.md
 */
@Injectable()
export class ConsolidatedActionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly loader: ConsolidatedFamilyLoader,
    private readonly executor: ConsolidatedActionsExecutor,
    private readonly holidays: HolidaysService,
  ) {}

  static actionLabel(type: ApprovalType): string {
    return ACTION_LABEL[type] ?? 'modificar';
  }

  /** Reglas que deben cumplirse al pedir Y al autorizar (el estado pudo cambiar en medio). */
  private async validate(type: ApprovalType, f: ConsolidatedFamily, payload: ConsolidatedActionPayload, manager?: EntityManager) {
    if (ConsolidatedFamilyLoader.isEmpty(f)) {
      throw new BadRequestException('Este consolidado ya está dado de baja por completo.');
    }
    if (type === 'delete_consolidado') return;
    if (!f.consolidated.length) {
      throw new BadRequestException('El consolidado está dado de baja; no se puede cambiar.');
    }
    if (type === 'change_subsidiary_consolidado') {
      const to = payload?.newSubsidiaryId;
      if (!to) throw new BadRequestException('Elige la sucursal a la que se va a mover.');
      if (to === f.subsidiaryId) throw new BadRequestException('El consolidado ya es de esa sucursal.');
      if (!(await this.loader.isSubsidiaryActive(to, manager))) throw new BadRequestException('La sucursal destino no está activa.');
      if (await this.loader.activeFamilyExists(f.consNumber, to, manager)) {
        throw new BadRequestException(
          'La sucursal destino ya tiene este consolidado; elimina el duplicado en lugar de moverlo.',
        );
      }
      return;
    }
    if (type === 'change_date_consolidado') {
      const day = payload?.newDate ?? '';
      if (!DAY_RE.test(day) || isNaN(new Date(`${day}T00:00:00Z`).getTime())) {
        throw new BadRequestException('Elige una fecha válida.');
      }
      if (day > toHermosilloDateString(new Date())) throw new BadRequestException('La fecha no puede ser futura.');
      if (f.consolidated.every((c) => c.date.toISOString().slice(0, 10) === day)) {
        throw new BadRequestException('El consolidado ya tiene esa fecha.');
      }
      return;
    }
    if (type === 'change_type_consolidado') {
      if (payload?.toType !== 'carga' && payload?.toType !== 'paquete') throw new BadRequestException('Elige si pasa a carga (F2) o a paquete.');
      const source = payload.toType === 'carga' ? f.shipments : f.chargeShipments;
      if (!source.length) {
        throw new BadRequestException(payload.toType === 'carga' ? 'Este consolidado no tiene paquetes que pasar a carga.' : 'Este consolidado no tiene cargas que pasar a paquete.');
      }
      return;
    }
    throw new BadRequestException('Acción no válida para un consolidado.');
  }

  private async buildPlan(
    type: ApprovalType,
    f: ConsolidatedFamily,
    payload: ConsolidatedActionPayload,
    manager?: EntityManager,
    actorId: string | null = null,
  ): Promise<{ plan: ActionPlan; change: ConsolidatedImpact['change']; approverSubsidiaryId: string; originName: string }> {
    const origin = await this.loader.loadTariff(f.subsidiaryId, manager);
    if (type === 'delete_consolidado') {
      return { plan: planDelete(f), change: null, approverSubsidiaryId: f.subsidiaryId, originName: origin.name };
    }
    const extra = await this.holidays.getHolidayInputs();
    if (type === 'change_subsidiary_consolidado') {
      const dest = await this.loader.loadTariff(payload.newSubsidiaryId!, manager);
      return {
        plan: planChangeSubsidiary(f, dest, (day) => isSundayOrMexHoliday(day, extra)),
        change: { from: origin.name, to: dest.name },
        approverSubsidiaryId: dest.id,
        originName: origin.name,
      };
    }
    if (type === 'change_type_consolidado') {
      const toType = payload.toType!;
      const whole = !payload.trackingNumbers?.length;
      const d = await this.loader.loadTypeDetails(f, { toType, trackingNumbers: payload.trackingNumbers, targetConsolidatedId: payload.targetConsolidatedId }, manager);
      if (d.missing.length) {
        const shown = d.missing.slice(0, 5).join(', ');
        throw new BadRequestException(`Estas guías no están como ${toType === 'carga' ? 'paquete' : 'carga'} en el consolidado: ${shown}${d.missing.length > 5 ? '…' : ''}`);
      }
      if (!d.packages.length) throw new BadRequestException('No hay guías que cambiar.');
      const destDay = (d.destConsolidated ?? d.familyConsolidated[0])?.date.toISOString().slice(0, 10) ?? toHermosilloDateString(new Date());
      const other = toType === 'carga' ? await this.loader.otherChargeIncomeOnDay(f.subsidiaryId, destDay, f.charges.map((c) => c.id), manager) : false;
      const plan = planChangeType({
        family: f,
        familyConsolidated: d.familyConsolidated,
        toType,
        packages: d.packages,
        whole,
        destConsolidated: d.destConsolidated,
        destChargeId: d.destChargeId,
        alreadyInDest: d.alreadyInDest,
        tariff: origin,
        isHalfTon: d.familyIsHalfTon ?? !!payload.isHalfTon,
        isSundayHoliday: isSundayOrMexHoliday(destDay, extra),
        otherChargeIncomeOnDay: other,
        userId: actorId,
        now: new Date(),
        newId: randomUUID,
      });
      const what = whole ? '' : ` (${d.packages.length} guía${d.packages.length === 1 ? '' : 's'})`;
      return {
        plan,
        change: toType === 'carga' ? { from: `Paquete${what}`, to: `Carga F2${d.destConsolidated && !whole ? ` ${d.destConsolidated.consNumber}` : ''}` } : { from: `Carga F2${what}`, to: 'Paquete' },
        approverSubsidiaryId: f.subsidiaryId,
        originName: origin.name,
      };
    }
    const day = payload.newDate!;
    const other = await this.loader.otherChargeIncomeOnDay(f.subsidiaryId, day, f.charges.map((c) => c.id), manager);
    return {
      plan: planChangeDate(f, origin, day, isSundayOrMexHoliday(day, extra), other),
      change: { from: f.consolidated[0].date.toISOString().slice(0, 10), to: day },
      approverSubsidiaryId: f.subsidiaryId,
      originName: origin.name,
    };
  }

  private toImpact(type: ApprovalType, targetId: string, f: ConsolidatedFamily, built: Awaited<ReturnType<ConsolidatedActionsService['buildPlan']>>): ConsolidatedImpact {
    return {
      type,
      targetId,
      label: `Consolidado ${f.consNumber}`,
      consNumber: f.consNumber,
      subsidiaryId: f.subsidiaryId,
      subsidiaryName: built.originName,
      targetKey: familyKey(f.consNumber, f.subsidiaryId),
      counts: {
        shipments: f.shipments.length,
        charges: f.chargeShipments.length,
        enRuta: f.enRuta,
        withIncome: f.incomes.length,
        withRoute: f.withRoute,
        devoluciones: f.devolutions.length,
      },
      summary: built.plan.summary,
      warnings: built.plan.warnings,
      change: built.change,
      approverSubsidiaryId: built.approverSubsidiaryId,
    };
  }

  /** Guías del consolidado (paquete y carga) para elegir en "Cambiar tipo". */
  async typeOptions(targetId: string) {
    const f = await this.loader.load(targetId);
    const q = this.dataSource.manager;
    const statusOf = async (table: 'shipment' | 'charge_shipment', ids: string[]) =>
      ids.length ? new Map<string, string>((await q.query(`SELECT id, status FROM \`${table}\` WHERE id IN (?)`, [ids])).map((r: any) => [r.id, r.status])) : new Map<string, string>();
    const [ss, cs] = await Promise.all([statusOf('shipment', f.shipments.map((s) => s.id)), statusOf('charge_shipment', f.chargeShipments.map((s) => s.id))]);
    return {
      consNumber: f.consNumber,
      subsidiaryId: f.subsidiaryId,
      packages: f.shipments.map((s) => ({ trackingNumber: s.trackingNumber, status: ss.get(s.id) ?? null })),
      charges: f.chargeShipments.map((s) => ({ trackingNumber: s.trackingNumber, status: cs.get(s.id) ?? null })),
      hasCharge: f.charges.length > 0,
      isHalfTon: f.charges[0]?.isHalfTon ?? null,
    };
  }

  /** Impacto para mostrar antes de pedir (también valida: si no se puede, avisa desde aquí). */
  async impact(type: ApprovalType, targetId: string, payload: ConsolidatedActionPayload = {}): Promise<ConsolidatedImpact> {
    const f = await this.loader.load(targetId);
    await this.validate(type, f, payload);
    const built = await this.buildPlan(type, f, payload);
    return this.toImpact(type, targetId, f, built);
  }

  /** Aplica la solicitud autorizada en UNA transacción. Si algo falla, no cambia nada. */
  async execute(
    req: ApprovalRequest,
    actor: { userId: string; name?: string },
  ): Promise<{ impactAfter: ConsolidatedImpact; summary: PlanSummary }> {
    return this.dataSource.transaction(async (manager) => {
      const payload: ConsolidatedActionPayload = req.payload ?? {};
      const f = await this.loader.load(req.targetId, manager);
      await this.validate(req.type, f, payload, manager);
      const built = await this.buildPlan(req.type, f, payload, manager, actor.userId ?? null);
      const reasonBase = `${ConsolidatedActionsService.actionLabel(req.type)} consolidado ${f.consNumber}`;
      await this.executor.apply(manager, built.plan, {
        requestId: req.id,
        action: req.type,
        consNumber: f.consNumber,
        userId: actor.userId ?? null,
        userName: actor.name ?? null,
        reason: `Autorizado: ${reasonBase}. ${req.justification ?? ''}`.trim(),
      });
      return { impactAfter: this.toImpact(req.type, req.targetId, f, built), summary: built.plan.summary };
    });
  }
}
