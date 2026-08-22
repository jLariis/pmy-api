import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Consolidated } from 'src/entities/consolidated.entity';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { Shipment } from 'src/entities/shipment.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { Income } from 'src/entities/income.entity';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { ApprovalType } from 'src/entities/approval-request.entity';

export interface ImpactSnapshot {
  type: ApprovalType;
  targetId: string;
  label: string;
  createdByName?: string;
  subsidiaryId?: string | null;
  counts: {
    shipments: number;
    charges: number;
    enRuta: number;
    withIncome: number;
    devoluciones?: number;
    hasRouteClosure?: boolean;
  };
}

/** Calcula el "impacto" (conteos) de un borrado para mostrarlo antes de solicitar. */
@Injectable()
export class ApprovalImpactService {
  constructor(
    @InjectRepository(Consolidated) private readonly consRepo: Repository<Consolidated>,
    @InjectRepository(PackageDispatch) private readonly dispatchRepo: Repository<PackageDispatch>,
    @InjectRepository(Shipment) private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ChargeShipment) private readonly chargeRepo: Repository<ChargeShipment>,
    @InjectRepository(Income) private readonly incomeRepo: Repository<Income>,
    @InjectRepository(RouteClosure) private readonly routeClosureRepo: Repository<RouteClosure>,
  ) {}

  async build(type: ApprovalType, targetId: string): Promise<ImpactSnapshot> {
    if (type === 'delete_consolidado') return this.buildConsolidado(targetId);
    return this.buildDispatch(targetId);
  }

  private async buildConsolidado(id: string): Promise<ImpactSnapshot> {
    const c = await this.consRepo.findOne({ where: { id }, relations: ['subsidiary', 'createdBy'] });
    if (!c) throw new NotFoundException('Consolidado no encontrado');
    const shipments = await this.shipmentRepo.count({ where: { consolidatedId: id } as any });
    const shpEnRuta = await this.shipmentRepo.count({ where: { consolidatedId: id, status: 'en_ruta' } as any });
    const charges = await this.chargeRepo.count({ where: { consolidatedId: id } as any });
    const chgEnRuta = await this.chargeRepo.count({ where: { consolidatedId: id, status: 'en_ruta' } as any });
    const withIncome = await this.incomeRepo
      .createQueryBuilder('i')
      .leftJoin('i.shipment', 's')
      .where('s.consolidatedId = :id', { id })
      .getCount()
      .catch(() => 0);
    return {
      type: 'delete_consolidado',
      targetId: id,
      label: `Consolidado ${(c as any).consNumber ?? id}`,
      createdByName: (c as any).createdBy?.name ?? undefined,
      subsidiaryId: (c as any).subsidiary?.id ?? null,
      counts: { shipments, charges, enRuta: shpEnRuta + chgEnRuta, withIncome },
    };
  }

  private async buildDispatch(id: string): Promise<ImpactSnapshot> {
    const d = await this.dispatchRepo.findOne({
      where: { id },
      relations: ['subsidiary', 'shipments', 'chargeShipments', 'routeClosure'],
    });
    if (!d) throw new NotFoundException('Salida a ruta no encontrada');
    const shipments = (d as any).shipments?.length ?? 0;
    const charges = (d as any).chargeShipments?.length ?? 0;
    const hasRouteClosure = !!(d as any).routeClosure;
    const withIncome = await this.incomeRepo
      .createQueryBuilder('i')
      .leftJoin('i.shipment', 's')
      .where('s.routeId = :id', { id })
      .getCount()
      .catch(() => 0);
    return {
      type: 'delete_route_dispatch',
      targetId: id,
      label: `Salida a ruta ${(d as any).trackingNumber ?? id}`,
      subsidiaryId: (d as any).subsidiary?.id ?? null,
      counts: { shipments, charges, enRuta: shipments + charges, withIncome, hasRouteClosure },
    };
  }
}
