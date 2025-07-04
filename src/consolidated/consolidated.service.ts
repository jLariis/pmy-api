import { Injectable } from '@nestjs/common';
import { CreateConsolidatedDto } from './dto/create-consolidated.dto';
import { UpdateConsolidatedDto } from './dto/update-consolidated.dto';
import { Repository } from 'typeorm';
import { Consolidated, Shipment } from 'src/entities';
import { InjectRepository } from '@nestjs/typeorm';

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

  async findAll(subsidiaryId?: string, fromDate?: Date, toDate?: Date) {
    const consolidates = await this.consolidatedRepository.find({
      relations: ['subsidiary'], // Incluye relaciones si aplica
    });

    const shipments = await this.shipmentRepository.find({
      relations: ['subsidiary', 'statusHistory'],
    });

    const consolidatedMap = new Map<string, Shipment[]>();

    for (const shipment of shipments) {
      if (!shipment.consolidatedId) continue;
      if (!consolidatedMap.has(shipment.consolidatedId)) {
        consolidatedMap.set(shipment.consolidatedId, []);
      }
      consolidatedMap.get(shipment.consolidatedId)!.push(shipment);
    }

    return consolidates.map((consolidated) => {
      const relatedShipments = consolidatedMap.get(consolidated.id) ?? [];

      const isComplete =
        relatedShipments.length > 0 &&
        relatedShipments.every((s) => s.status === 'entregado');

      return {
        ...consolidated,
        isConsolidatedComplete: isComplete,
        shipments: relatedShipments,
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
