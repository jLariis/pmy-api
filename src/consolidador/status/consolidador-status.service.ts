import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Shipment } from '../../entities/shipment.entity';
import { Income } from '../../entities/income.entity';
import { FedexStatusResolver } from '../../fedex-status/fedex-status.resolver';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { ShipmentType } from '../../common/enums/shipment-type.enum';
import { IncomeSourceType } from '../../common/enums/income-source-type.enum';
import { deriveStatusCorrection } from '../logic/status-correction.util';
import { deriveRepairIncome } from '../logic/repair-income.util';
import { detectAnomalies } from '../logic/detect-anomalies.util';
import { mapIncomeToRow } from '../read/consolidador-row.mapper';
import { ConsolidadorRow } from '../consolidador.types';
import { ConsolidadorAuditService } from '../audit/consolidador-audit.service';

@Injectable()
export class ConsolidadorStatusService {
  constructor(
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(Income) private readonly incomeRepo: Repository<Income>,
    private readonly resolver: FedexStatusResolver,
    private readonly audit: ConsolidadorAuditService,
  ) {}

  /** Historial de estatus del shipment (status + timestamp), más reciente primero. */
  private statusHistoryOf(shipment: Shipment | null): Array<{ status: string; timestamp: string | null }> {
    const hist = (shipment as any)?.statusHistory as Array<{ status?: string; timestamp?: Date }> | undefined;
    if (!hist?.length) return [];
    return hist
      .map((s) => ({ status: String(s.status ?? ''), timestamp: s.timestamp ? new Date(s.timestamp).toISOString() : null }))
      .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime());
  }

  /** Fecha del último evento de estatus (shipment_status.timestamp) — fecha "del cobro" por estatus. */
  private latestStatusDate(shipment: Shipment | null): string | null {
    const hist = (shipment as any)?.statusHistory as Array<{ timestamp?: Date }> | undefined;
    if (!hist?.length) return null;
    const max = hist.reduce<Date | null>((acc, s) => {
      const t = s.timestamp ? new Date(s.timestamp) : null;
      return t && (!acc || t > acc) ? t : acc;
    }, null);
    return max ? max.toISOString() : null;
  }

  /** Busca un paquete y compone estatus interno vs FedEx canónico + income ligado (activo). */
  async search(tracking: string) {
    const shipment = await this.shipmentRepo.findOne({ where: { trackingNumber: tracking }, relations: ['statusHistory'] });
    const fedex = await this.resolver.getLatestStatus(tracking);
    const income = shipment
      ? await this.incomeRepo.findOne({
          where: { shipment: { id: shipment.id }, active: true },
          relations: ['shipment', 'charge', 'subsidiary'],
        })
      : null;
    const suggestion = shipment ? deriveStatusCorrection(shipment.status, fedex.status) : null;
    // ¿Se puede reparar el ingreso? Solo si hay shipment, NO tiene ingreso activo y su estatus es cobrable.
    const repair = shipment && !income ? deriveRepairIncome(shipment.status) : { create: false, incomeType: null };
    return {
      shipment: shipment ? { id: shipment.id, trackingNumber: shipment.trackingNumber, status: shipment.status } : null,
      internalStatus: shipment?.status ?? null,
      fedex,
      suggestion,
      income: income ? mapIncomeToRow(income) : null,
      incomeRepairNeeded: repair.create,
      incomeRepairType: repair.incomeType,
      statusDate: this.latestStatusDate(shipment),
      incomeDate: income ? (income.date instanceof Date ? income.date.toISOString() : new Date(income.date).toISOString()) : null,
      anomalies: detectAnomalies({
        currentStatus: shipment?.status ?? null,
        history: (shipment as any)?.statusHistory ?? [],
        income: income ? { date: income.date } : null,
        statusDate: this.latestStatusDate(shipment),
      }),
      statusHistory: this.statusHistoryOf(shipment),
    };
  }

  /** Búsqueda por lote (hasta 30 guías). Usa el batch de FedEx y arma un resultado por guía. */
  async searchBatch(trackings: string[]) {
    const unique = [...new Set((trackings || []).map((t) => t.trim()).filter(Boolean))].slice(0, 30);
    if (unique.length === 0) return { results: [] };

    const [shipments, fedexList] = await Promise.all([
      this.shipmentRepo.find({ where: { trackingNumber: In(unique) }, relations: ['statusHistory'] }),
      this.resolver.getLatestStatusBatch(unique),
    ]);
    const shipmentByTn = new Map(shipments.map((s) => [s.trackingNumber, s]));
    const fedexByTn = new Map(fedexList.map((f) => [f.trackingNumber, f]));

    const shipmentIds = shipments.map((s) => s.id);
    const incomes = shipmentIds.length
      ? await this.incomeRepo.find({ where: { shipment: { id: In(shipmentIds) }, active: true }, relations: ['shipment', 'charge', 'subsidiary'] })
      : [];
    const incomeByShipmentId = new Map(incomes.map((i) => [i.shipment?.id, i]));

    const results = unique.map((tn) => {
      const shipment = shipmentByTn.get(tn) ?? null;
      // getLatestStatusBatch devuelve una entrada por guía; el fallback es defensivo.
      const fedex = fedexByTn.get(tn) ?? { trackingNumber: tn, found: false, status: null, error: 'Sin datos' };
      const suggestion = shipment ? deriveStatusCorrection(shipment.status, fedex.status ?? null) : null;
      const income = shipment ? incomeByShipmentId.get(shipment.id) : null;
      const repair = shipment && !income ? deriveRepairIncome(shipment.status) : { create: false, incomeType: null };
      return {
        tracking: tn,
        shipment: shipment ? { id: shipment.id, trackingNumber: shipment.trackingNumber, status: shipment.status } : null,
        internalStatus: shipment?.status ?? null,
        fedex,
        suggestion,
        income: income ? mapIncomeToRow(income) : null,
        incomeRepairNeeded: repair.create,
        incomeRepairType: repair.incomeType,
        statusDate: this.latestStatusDate(shipment),
        incomeDate: income ? (income.date instanceof Date ? income.date.toISOString() : new Date(income.date).toISOString()) : null,
        anomalies: detectAnomalies({
          currentStatus: shipment?.status ?? null,
          history: (shipment as any)?.statusHistory ?? [],
          income: income ? { date: income.date } : null,
          statusDate: this.latestStatusDate(shipment),
        }),
        statusHistory: this.statusHistoryOf(shipment),
      };
    });
    return { results };
  }

  /** Corrige `shipment.status` (verificado contra FedEx) y ajusta el income ligado. */
  async fixStatus(
    shipmentId: string,
    newStatus: ShipmentStatusType,
    reason: string,
    userId: string,
  ): Promise<{ shipmentStatus: ShipmentStatusType; income: ConsolidadorRow | null }> {
    const shipment = await this.shipmentRepo.findOne({ where: { id: shipmentId } });
    if (!shipment) throw new NotFoundException('Shipment no encontrado');

    // Verificación contra FedEx: no se corrige si FedEx no confirma.
    const fedex = await this.resolver.getLatestStatus(shipment.trackingNumber);
    if (!fedex.found || fedex.error) {
      throw new BadRequestException('No se pudo verificar el estatus contra FedEx');
    }

    const { newStatus: resolved, incomeEffect } = deriveStatusCorrection(shipment.status, fedex.status);
    if (!resolved || resolved !== newStatus) {
      throw new BadRequestException('El estatus solicitado no coincide con lo que reporta FedEx');
    }

    const oldStatus = shipment.status;
    shipment.status = resolved; // escribe SHIPMENT
    await this.shipmentRepo.save(shipment);

    // Ajusta el income ligado según el efecto acotado.
    const income = await this.incomeRepo.findOne({
      where: { shipment: { id: shipment.id } },
      relations: ['shipment', 'charge', 'subsidiary'],
    });
    let oldIncomeType: string | null = null;
    if (income && incomeEffect.kind === 'reclassify') {
      oldIncomeType = income.incomeType;
      income.incomeType = incomeEffect.incomeType;
      income.updatedById = userId;
      income.updatedAt = new Date();
      income.editReason = reason;
      await this.incomeRepo.save(income);
    }

    await this.audit.record({
      incomeId: income?.id ?? null,
      shipmentId: shipment.id,
      action: 'status_fix',
      field: 'shipment.status',
      oldValue: oldStatus,
      newValue: resolved,
      reason,
      userId,
    });
    if (income && incomeEffect.kind === 'reclassify') {
      await this.audit.record({
        incomeId: income.id,
        shipmentId: shipment.id,
        action: 'status_fix',
        field: 'income.incomeType',
        oldValue: oldIncomeType,
        newValue: incomeEffect.incomeType,
        reason,
        userId,
      });
    }

    return { shipmentStatus: shipment.status, income: income ? mapIncomeToRow(income) : null };
  }

  /**
   * Repara el ingreso de un paquete: si NO tiene ingreso activo y su estatus es cobrable, crea uno
   * (sourceType=shipment, costo=subsidiary.fedexCostPackage, tipo según el estatus). Solo toca `income`.
   */
  async repairIncome(
    shipmentId: string,
    reason: string,
    userId: string,
  ): Promise<{ created: boolean; reason?: string; income: ConsolidadorRow | null }> {
    const shipment = await this.shipmentRepo.findOne({ where: { id: shipmentId }, relations: ['subsidiary'] });
    if (!shipment) throw new NotFoundException('Shipment no encontrado');

    const existing = await this.incomeRepo.findOne({
      where: { shipment: { id: shipmentId }, active: true },
      relations: ['shipment', 'charge', 'subsidiary'],
    });
    if (existing) {
      return { created: false, reason: 'El paquete ya tiene un ingreso activo', income: mapIncomeToRow(existing) };
    }

    const { create, incomeType } = deriveRepairIncome(shipment.status);
    if (!create || !incomeType) {
      return { created: false, reason: 'El estatus del paquete no genera ingreso (no es cobrable/terminal)', income: null };
    }

    const cost = Number((shipment.subsidiary as any)?.fedexCostPackage ?? 0);
    const income = this.incomeRepo.create({
      subsidiary: shipment.subsidiary,
      trackingNumber: shipment.trackingNumber,
      shipmentType: shipment.shipmentType ?? ShipmentType.FEDEX,
      incomeType,
      cost,
      isGrouped: false,
      sourceType: IncomeSourceType.SHIPMENT,
      shipment: { id: shipment.id } as any,
      date: new Date(),
      createdById: userId,
      editReason: reason,
    });
    await this.incomeRepo.save(income);
    await this.audit.record({
      incomeId: income.id,
      shipmentId,
      action: 'income_repair',
      field: 'create',
      oldValue: null,
      newValue: cost,
      reason,
      userId,
    });
    return { created: true, income: mapIncomeToRow(income) };
  }
}
