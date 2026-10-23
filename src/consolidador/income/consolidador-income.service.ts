import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Income } from '../../entities/income.entity';
import { Subsidiary } from '../../entities/subsidiary.entity';
import { Shipment } from '../../entities/shipment.entity';
import { ShipmentType } from '../../common/enums/shipment-type.enum';
import { computeSecondAbordDelta } from '../logic/second-abord.util';
import { linkManualIncomeToShipment, ManualKind, resolveManualIncomeCost } from '../logic/manual-income.util';
import { mapIncomeToRow } from '../read/consolidador-row.mapper';
import { ConsolidadorRow } from '../consolidador.types';
import { ConsolidadorAuditService } from '../audit/consolidador-audit.service';
import { ChargeRulesService } from '../../charge-rules/charge-rules.service';
import { isCountableIncome } from '../../common/income-rules.util';
import { IncomeStatus } from '../../common/enums/income-status.enum';

@Injectable()
export class ConsolidadorIncomeService {
  constructor(
    @InjectRepository(Income) private readonly incomeRepo: Repository<Income>,
    @InjectRepository(Subsidiary) private readonly subsidiaryRepo: Repository<Subsidiary>,
    private readonly audit: ConsolidadorAuditService,
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    private readonly chargeRules: ChargeRulesService,
  ) {}

  private async load(id: string): Promise<Income> {
    const income = await this.incomeRepo.findOne({
      where: { id },
      relations: ['shipment', 'charge', 'subsidiary'],
    });
    if (!income) throw new NotFoundException('Ingreso no encontrado');
    return income;
  }

  /** Estampa la miga de auditoría y fija el nuevo costo (guarda `originalCost` la 1ª vez). */
  private stamp(income: Income, reason: string, userId: string, newCost: number) {
    if (income.originalCost == null) income.originalCost = Number(income.cost);
    income.cost = newCost;
    income.updatedById = userId;
    income.updatedAt = new Date();
    income.editReason = reason;
  }

  async editCost(id: string, cost: number, reason: string, userId: string): Promise<ConsolidadorRow> {
    const income = await this.load(id);
    const oldCost = Number(income.cost);
    const newCost = Number(cost.toFixed(2));
    this.stamp(income, reason, userId, newCost);
    await this.incomeRepo.save(income);
    await this.audit.record({
      incomeId: income.id,
      shipmentId: income.shipment?.id ?? null,
      action: 'cost_edit',
      field: 'cost',
      oldValue: oldCost,
      newValue: newCost,
      reason,
      userId,
    });
    return mapIncomeToRow(income);
  }

  async setSecondAbord(id: string, enabled: boolean, reason: string, userId: string): Promise<ConsolidadorRow> {
    const income = await this.load(id);
    const subsidiary: any = income.subsidiary ?? (await this.subsidiaryRepo.findOne({ where: { id: (income as any).subsidiaryId } }));
    const amount = Number(subsidiary?.secondAbordAmount ?? 0);
    // Estado actual: el flag por-fila manda; si es null, se infiere del default de la sucursal.
    const alreadyIncluded = income.secondAbordApplied ?? !!subsidiary?.chargeSecondAbord;
    const oldCost = Number(income.cost);
    const next = computeSecondAbordDelta(oldCost, amount, enabled, alreadyIncluded);
    this.stamp(income, reason, userId, next);
    income.secondAbordApplied = enabled;
    await this.incomeRepo.save(income);
    await this.audit.record({
      incomeId: income.id,
      shipmentId: income.shipment?.id ?? null,
      action: 'second_abord',
      field: enabled ? 'poner 2º a bordo' : 'quitar 2º a bordo',
      oldValue: oldCost,
      newValue: next,
      reason,
      userId,
    });
    return mapIncomeToRow(income);
  }

  async createManual(
    dto: { subsidiaryId: string; kind: ManualKind; trackingNumber?: string; cost: number; date: string; reason: string },
    userId: string,
  ): Promise<ConsolidadorRow> {
    // Con guía que existe en el sistema, el ingreso se liga a su registro más reciente: así
    // cuenta como uno automático, en la columna de su paquetería.
    const shipment = dto.trackingNumber ? await this.findLatestShipment(dto.trackingNumber) : null;
    const { cost, sourceType, incomeType, nonDeliveryStatus, shipmentId, shipmentType } = linkManualIncomeToShipment(
      resolveManualIncomeCost(dto.kind, { cost: dto.cost }),
      shipment,
    );

    // Día de la operación (mediodía local para caer con holgura dentro del día).
    const day = new Date(`${dto.date}T12:00:00.000`);

    // Anti-duplicado: misma sucursal + guía + tipo + día. Solo cuando hay guía (una manual
    // libre sin guía no se puede deduplicar con certeza).
    if (dto.trackingNumber) {
      const existing = await this.findSameDayIncome(dto.subsidiaryId, dto.trackingNumber, dto.date, { incomeType, nonDeliveryStatus });
      if (existing) {
        throw new ConflictException('Ya existe un ingreso equivalente ese día para esa guía');
      }
    }

    const income = this.incomeRepo.create({
      subsidiary: { id: dto.subsidiaryId } as Subsidiary,
      trackingNumber: dto.trackingNumber,
      shipmentType: (shipmentType as ShipmentType) ?? ShipmentType.FEDEX,
      incomeType,
      nonDeliveryStatus,
      cost,
      isGrouped: false,
      sourceType,
      ...(shipmentId ? { shipment: { id: shipmentId } as Shipment } : {}),
      date: day,
      createdById: userId,
      editReason: dto.reason,
    });
    await this.incomeRepo.save(income);
    await this.audit.record({
      incomeId: income.id,
      shipmentId,
      action: 'manual_create',
      field: dto.kind,
      oldValue: null,
      newValue: cost,
      reason: dto.reason,
      userId,
    });
    return mapIncomeToRow(income);
  }

  /** Cambia la fecha del ingreso (fecha mal registrada). `date` = YYYY-MM-DD. Solo toca `income`. */
  async editDate(id: string, date: string, reason: string, userId: string): Promise<ConsolidadorRow> {
    const income = await this.load(id);
    const old = income.date ? new Date(income.date).toISOString() : null;
    // Mediodía local para caer con holgura dentro del día elegido (evita corrimientos por zona).
    income.date = new Date(`${date}T12:00:00.000`);
    income.updatedById = userId;
    income.updatedAt = new Date();
    income.editReason = reason;
    await this.incomeRepo.save(income);
    await this.audit.record({
      incomeId: income.id,
      shipmentId: income.shipment?.id ?? null,
      action: 'date_edit',
      field: 'date',
      oldValue: old,
      newValue: income.date.toISOString(),
      reason,
      userId,
    });
    return mapIncomeToRow(income);
  }

  /** Reasigna el ingreso a otra sucursal (ingreso mal asignado). Solo toca `income`. */
  async reassignSubsidiary(id: string, subsidiaryId: string, reason: string, userId: string): Promise<ConsolidadorRow> {
    const income = await this.load(id);
    const oldSubId = (income.subsidiary as any)?.id ?? null;
    income.subsidiary = { id: subsidiaryId } as Subsidiary;
    income.updatedById = userId;
    income.updatedAt = new Date();
    income.editReason = reason;
    await this.incomeRepo.save(income);
    await this.audit.record({
      incomeId: income.id,
      shipmentId: income.shipment?.id ?? null,
      action: 'reassign',
      field: 'subsidiary',
      oldValue: oldSubId,
      newValue: subsidiaryId,
      reason,
      userId,
    });
    // Recarga para traer el nombre de la nueva sucursal en la fila.
    const reloaded = await this.incomeRepo.findOne({ where: { id }, relations: ['shipment', 'charge', 'subsidiary'] });
    return mapIncomeToRow(reloaded ?? income);
  }

  /** Elimina (soft-delete) un ingreso: deja de contar en los reportes. Solo toca `income`. */
  async deleteIncome(id: string, reason: string, userId: string): Promise<{ id: string; deleted: true }> {
    const income = await this.load(id);
    income.active = false;
    income.annulledAt = new Date();
    income.annulledById = userId;
    income.updatedById = userId;
    income.updatedAt = new Date();
    income.editReason = reason;
    await this.incomeRepo.save(income);
    await this.audit.record({
      incomeId: income.id,
      shipmentId: income.shipment?.id ?? null,
      action: 'delete',
      field: 'active',
      oldValue: '1',
      newValue: '0',
      reason,
      userId,
    });
    return { id, deleted: true };
  }

  /** Registro más reciente de una guía (al que se liga un alta manual). */
  private findLatestShipment(trackingNumber: string) {
    return this.shipmentRepo.findOne({
      where: { trackingNumber },
      relations: ['subsidiary'],
      // createdAt va en el select porque se ordena por él: con `relations`, TypeORM arma una
      // subconsulta DISTINCT y truena ("Unknown column distinctAlias.Shipment_createdAt") si falta.
      select: { id: true, shipmentType: true, status: true, createdAt: true, subsidiary: { id: true, name: true } },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Ingreso activo de la guía ese día en la sucursal; con `kind`, solo del mismo tipo y código
   * (un DEX08 no bloquea un DEX07 del mismo día).
   */
  private findSameDayIncome(
    subsidiaryId: string,
    trackingNumber: string,
    date: string,
    kind?: { incomeType: IncomeStatus; nonDeliveryStatus: string },
  ) {
    return this.incomeRepo.findOne({
      where: {
        subsidiary: { id: subsidiaryId },
        trackingNumber,
        ...(kind ? { incomeType: kind.incomeType, ...(kind.nonDeliveryStatus ? { nonDeliveryStatus: kind.nonDeliveryStatus } : {}) } : {}),
        date: Between(new Date(`${date}T00:00:00.000`), new Date(`${date}T23:59:59.999`)),
        active: true,
      },
    });
  }

  /**
   * Vista previa del alta manual ("Así quedará"): cómo se guardará, en qué columna de
   * Finanzas → Ingresos cae, si suma según las reglas de la sucursal y avisos (guía que no
   * existe, ingreso de esa guía ese mismo día). No escribe nada.
   */
  async previewManual(dto: {
    subsidiaryId: string;
    kind: ManualKind;
    trackingNumber?: string;
    date?: string;
  }): Promise<ManualIncomePreview> {
    const tracking = dto.trackingNumber?.trim() || undefined;
    const [shipment, subsidiary, resolver] = await Promise.all([
      tracking ? this.findLatestShipment(tracking) : Promise.resolve(null),
      this.subsidiaryRepo.findOne({
        where: { id: dto.subsidiaryId },
        select: ['id', 'countTransfersAsIncome', 'fedexCostPackage', 'dhlCostPackage'],
      }),
      this.chargeRules.buildResolver(dto.subsidiaryId),
    ]);
    const linked = linkManualIncomeToShipment(resolveManualIncomeCost(dto.kind, {}), shipment);
    const shipmentType = linked.shipmentType ?? ShipmentType.FEDEX;
    const countable = isCountableIncome(
      { ...linked, shipmentType, date: dto.date ? new Date(`${dto.date}T12:00:00.000`) : new Date() },
      { resolver, countTransfers: subsidiary?.countTransfersAsIncome ?? true },
    );
    const existing = tracking && dto.date ? await this.findSameDayIncome(dto.subsidiaryId, tracking, dto.date) : null;

    const suggestedCost =
      dto.kind === 'manual'
        ? null
        : Number((shipmentType === ShipmentType.DHL ? subsidiary?.dhlCostPackage : subsidiary?.fedexCostPackage) ?? 0) || null;

    return {
      shipment: shipment
        ? {
            carrier: shipment.shipmentType,
            status: shipment.status,
            subsidiaryId: shipment.subsidiary?.id ?? null,
            subsidiaryName: shipment.subsidiary?.name ?? null,
          }
        : null,
      sourceType: linked.sourceType,
      incomeType: linked.incomeType,
      nonDeliveryStatus: linked.nonDeliveryStatus,
      shipmentType,
      column: manualIncomeColumn(linked.sourceType, shipmentType),
      countable,
      suggestedCost,
      sameDayIncome: existing ? { cost: Number(existing.cost), sourceType: existing.sourceType, incomeType: existing.incomeType } : null,
    };
  }
}

/** Respuesta de la vista previa del alta manual. */
export interface ManualIncomePreview {
  shipment: { carrier: string; status: string; subsidiaryId: string | null; subsidiaryName: string | null } | null;
  sourceType: string;
  incomeType: string;
  nonDeliveryStatus: string;
  shipmentType: string;
  /** Columna de Finanzas → Ingresos donde suma. */
  column: 'fedex' | 'dhl' | 'collections' | 'otros';
  /** ¿Suma según las reglas de cobro de la sucursal? */
  countable: boolean;
  /** Tarifa de la sucursal para precargar el monto; null si no aplica. */
  suggestedCost: number | null;
  /** Ingreso activo de esa guía ese día (aviso antes de duplicar). */
  sameDayIncome: { cost: number; sourceType: string; incomeType: string } | null;
}

function manualIncomeColumn(sourceType: string, shipmentType: string): ManualIncomePreview['column'] {
  if (sourceType === 'collection') return 'collections';
  if (sourceType === 'manual') return 'otros';
  return shipmentType === ShipmentType.DHL ? 'dhl' : 'fedex';
}
