import { Injectable } from '@nestjs/common';
import { CreateConsolidatedDto } from './dto/create-consolidated.dto';
import { UpdateConsolidatedDto } from './dto/update-consolidated.dto';
import { Repository } from 'typeorm';
import { Consolidated, Shipment } from 'src/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { ShipmentConsolidatedDto } from './dto/shipment.dto';
import { ConsolidatedDto } from './dto/consolidated.dto';

@Injectable()
export class ConsolidatedService {
  constructor(
    @InjectRepository(Consolidated)
    private readonly consolidatedRepository: Repository<Consolidated>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>
  ){}

  async create(createConsolidatedDto: CreateConsolidatedDto) {
    const newConsolidated = await this.consolidatedRepository.create(createConsolidatedDto);
    return await this.consolidatedRepository.save(newConsolidated);
  }

  async findAll(subsidiaryId?: string, fromDate?: Date, toDate?: Date): Promise<ConsolidatedDto[]> {
    // Construimos filtros para consolidateds
    const consolidatedWhere: any = {};

    if (subsidiaryId) consolidatedWhere.subsidiary = { id: subsidiaryId };
    if (fromDate || toDate) {
      consolidatedWhere.date = {};
      if (fromDate) consolidatedWhere.date['$gte'] = fromDate;
      if (toDate) consolidatedWhere.date['$lte'] = toDate;
    }

    const consolidates = await this.consolidatedRepository.find({
      where: consolidatedWhere,
      relations: ['subsidiary'],
      order: { date: 'DESC' }, // Orden por fecha de mayor a menor
    });

    // Construimos filtros para shipments
    const shipmentWhere: any = {};
    if (subsidiaryId) shipmentWhere.subsidiary = { id: subsidiaryId };

    const shipments = await this.shipmentRepository.find({
      where: shipmentWhere,
      relations: ['subsidiary', 'statusHistory'],
    });

    // Agrupamos los shipments por consolidatedId
    const consolidatedMap = new Map<string, Shipment[]>();

    for (const shipment of shipments) {
      if (!shipment.consolidatedId) continue;
      if (!consolidatedMap.has(shipment.consolidatedId)) {
        consolidatedMap.set(shipment.consolidatedId, []);
      }
      consolidatedMap.get(shipment.consolidatedId)!.push(shipment);
    }

    // Función auxiliar para calcular diferencia en días
    function daysDiff(fromDate: Date, toDate: Date) {
      const diffMs = toDate.getTime() - fromDate.getTime();
      return Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }

    // Formamos el resultado final
    return consolidates.map((consolidated) => {
      const relatedShipments = consolidatedMap.get(consolidated.id) ?? [];

      relatedShipments.forEach((shipment) => {
        if (shipment.statusHistory && shipment.statusHistory.length > 0) {
          shipment.statusHistory.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        }

        let daysInRoute = 0;
        if (shipment.status === 'en_ruta') {
          const consolidatedDate = new Date(consolidated.date);
          const now = new Date();
          daysInRoute = Math.floor((now.getTime() - consolidatedDate.getTime()) / (1000 * 60 * 60 * 24));
        }

        // Retornamos una copia tipo DTO con la propiedad extra
        Object.assign(shipment, { daysInRoute });
      });

      const isComplete =
        relatedShipments.length > 0 &&
        relatedShipments.every((s) => s.status === 'entregado');

      return {
        ...consolidated,
        isConsolidatedComplete: isComplete,
        shipments: relatedShipments as ShipmentConsolidatedDto[],
        consolidatedDate: consolidated.date,
      };
    });
  }

  async findOne(id: string) {
    return await this.consolidatedRepository.findOneBy({id});
  }

  async update(id: string, updateConsolidatedDto: UpdateConsolidatedDto) {
    return await this.consolidatedRepository.update(id, updateConsolidatedDto);
  }

  async remove(id: string) {
    return await this.consolidatedRepository.delete(id);
  }
}
