import { Injectable } from '@nestjs/common';
import { CreateConsolidatedDto } from './dto/create-consolidated.dto';
import { UpdateConsolidatedDto } from './dto/update-consolidated.dto';
import { Between, IsNull, Not, Repository } from 'typeorm';
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

  private calculateDaysDifference(startDate: Date, endDate: Date): number {
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  async findAll(
    subsidiaryId?: string,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<ConsolidatedDto[]> {
    // 1. Validación y ajuste de fechas UTC
    let utcFromDate: Date | undefined;
    let utcToDate: Date | undefined;

    if (fromDate && toDate) {
      if (fromDate > toDate) {
        throw new Error('La fecha fromDate no puede ser mayor que toDate');
      }

      // Convertir fechas a UTC (final del día para toDate)
      utcFromDate = new Date(Date.UTC(
        fromDate.getUTCFullYear(),
        fromDate.getUTCMonth(),
        fromDate.getUTCDate(),
        0, 0, 0
      ));

      utcToDate = new Date(Date.UTC(
        toDate.getUTCFullYear(),
        toDate.getUTCMonth(),
        toDate.getUTCDate(),
        23, 59, 59
      ));
    } else if (fromDate || toDate) {
      throw new Error('Debe proporcionar ambas fechas (fromDate y toDate) para usar rangos');
    }

    // 2. Construcción del query con fechas UTC
    const consolidatedWhere: any = {};
    
    if (subsidiaryId) {
      consolidatedWhere.subsidiary = { id: subsidiaryId };
    }

    if (utcFromDate && utcToDate) {
      consolidatedWhere.date = Between(utcFromDate, utcToDate);
      console.log('Buscando entre:', utcFromDate, 'y', utcToDate); // Log para debug
    }

    // 3. Consulta a la base de datos
    const consolidates = await this.consolidatedRepository.find({
      select: {
        id: true,
        date: true,
        numberOfPackages: true,
        type: true,
        subsidiary: {
          id: true,
          name: true
        }
      },
      where: consolidatedWhere,
      relations: ['subsidiary'],
      order: { date: 'DESC' },
    });

    if (consolidates.length === 0) {
      console.warn('No se encontraron consolidados con los filtros aplicados');
      return [];
    }

    // 4. Consulta de shipments (optimizada)
    const shipmentWhere: any = { 
      consolidatedId: Not(IsNull()) 
    };

    if (subsidiaryId) {
      shipmentWhere.subsidiary = { id: subsidiaryId };
    }

    const shipments = await this.shipmentRepository.find({
      select: {
        trackingNumber: true,
        recipientName: true,
        commitDateTime: true,
        consolidatedId: true,
        status: true,
        statusHistory: {
          status: true,
          exceptionCode: true,
          timestamp: true
        },
        subsidiary: {
          id: true,
          name: true
        }
      },
      where: shipmentWhere,
      relations: ['subsidiary', 'statusHistory'],
    });

    // Agrupación de shipments por consolidatedId
    const consolidatedMap = new Map<string, Shipment[]>();

    for (const shipment of shipments) {
      if (!shipment.consolidatedId) continue;
      
      if (!consolidatedMap.has(shipment.consolidatedId)) {
        consolidatedMap.set(shipment.consolidatedId, []);
      }
      consolidatedMap.get(shipment.consolidatedId)?.push(shipment);
    }

    // Procesamiento de resultados
    return consolidates.map(consolidated => {
      const relatedShipments = consolidatedMap.get(consolidated.id) || [];

      // Procesar cada shipment
      const processedShipments = relatedShipments.map(shipment => {
        // Ordenar historial de estados por fecha
        if (shipment.statusHistory?.length > 0) {
          shipment.statusHistory.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        }

        // Calcular días en ruta si está en estado 'en_ruta'
        const daysInRoute = shipment.status === 'en_ruta'
          ? this.calculateDaysDifference(new Date(consolidated.date), new Date())
          : 0;

        return {
          ...shipment,
          daysInRoute,
        } as ShipmentConsolidatedDto;
      });

      // Determinar si el consolidado está completo
      const hasIncompleteShipments = relatedShipments.some(shipment => 
        ['en_ruta', 'pending'].includes(shipment.status)
      );
      const isComplete = relatedShipments.length > 0 && !hasIncompleteShipments;

      return {
        ...consolidated,
        isConsolidatedComplete: isComplete,
        shipments: processedShipments,
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

  async lastConsolidatedBySucursal(subsidiaryId: string) {
    console.log("🚀 ~ ConsolidatedService ~ lastConsolidatedBySucursal ~ subsidiaryId:", subsidiaryId)
    const todayUTC = new Date('2025-08-11');
    todayUTC.setUTCHours(0, 0, 0, 0);
    console.log("🚀 ~ ConsolidatedService ~ lastConsolidatedBySucursal ~ todayUTC:", todayUTC)

    const tomorrowUTC = new Date(todayUTC);
    tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);
    console.log("🚀 ~ ConsolidatedService ~ lastConsolidatedBySucursal ~ tomorrowUTC:", tomorrowUTC)

    const consolidated = await this.consolidatedRepository
      .createQueryBuilder('consolidated')
      .leftJoinAndSelect('consolidated.subsidiary', 'subsidiary')
      .where('subsidiary.id = :subsidiaryId', { subsidiaryId })
      //.andWhere('consolidated.date >= :start', { start: todayUTC })
      //.andWhere('consolidated.date < :end', { end: tomorrowUTC })
      .getMany();

    console.log("🚀 ~ ConsolidatedService ~ lastConsolidatedBySucursal ~ consolidated:", consolidated);

    return consolidated;
  }

}
