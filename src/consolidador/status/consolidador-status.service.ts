import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Shipment } from '../../entities/shipment.entity';
import { Income } from '../../entities/income.entity';
import { FedexStatusResolver } from '../../fedex-status/fedex-status.resolver';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { deriveStatusCorrection } from '../logic/status-correction.util';
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

  /** Busca un paquete y compone estatus interno vs FedEx canónico + income ligado. */
  async search(tracking: string) {
    const shipment = await this.shipmentRepo.findOne({ where: { trackingNumber: tracking } });
    const fedex = await this.resolver.getLatestStatus(tracking);
    const income = shipment
      ? await this.incomeRepo.findOne({
          where: { shipment: { id: shipment.id } },
          relations: ['shipment', 'charge'],
        })
      : null;
    const suggestion = shipment ? deriveStatusCorrection(shipment.status, fedex.status) : null;
    return {
      shipment: shipment ? { id: shipment.id, trackingNumber: shipment.trackingNumber, status: shipment.status } : null,
      internalStatus: shipment?.status ?? null,
      fedex,
      suggestion,
      income: income ? mapIncomeToRow(income) : null,
    };
  }

  /** Búsqueda por lote (hasta 30 guías). Usa el batch de FedEx y arma un resultado por guía. */
  async searchBatch(trackings: string[]) {
    const unique = [...new Set((trackings || []).map((t) => t.trim()).filter(Boolean))].slice(0, 30);
    if (unique.length === 0) return { results: [] };

    const [shipments, fedexList] = await Promise.all([
      this.shipmentRepo.find({ where: { trackingNumber: In(unique) } }),
      this.resolver.getLatestStatusBatch(unique),
    ]);
    const shipmentByTn = new Map(shipments.map((s) => [s.trackingNumber, s]));
    const fedexByTn = new Map(fedexList.map((f) => [f.trackingNumber, f]));

    const shipmentIds = shipments.map((s) => s.id);
    const incomes = shipmentIds.length
      ? await this.incomeRepo.find({ where: { shipment: { id: In(shipmentIds) } }, relations: ['shipment', 'charge'] })
      : [];
    const incomeByShipmentId = new Map(incomes.map((i) => [i.shipment?.id, i]));

    const results = unique.map((tn) => {
      const shipment = shipmentByTn.get(tn) ?? null;
      // getLatestStatusBatch devuelve una entrada por guía; el fallback es defensivo.
      const fedex = fedexByTn.get(tn) ?? { trackingNumber: tn, found: false, status: null, error: 'Sin datos' };
      const suggestion = shipment ? deriveStatusCorrection(shipment.status, fedex.status ?? null) : null;
      const income = shipment ? incomeByShipmentId.get(shipment.id) : null;
      return {
        tracking: tn,
        shipment: shipment ? { id: shipment.id, trackingNumber: shipment.trackingNumber, status: shipment.status } : null,
        internalStatus: shipment?.status ?? null,
        fedex,
        suggestion,
        income: income ? mapIncomeToRow(income) : null,
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
      relations: ['shipment', 'charge'],
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
}
