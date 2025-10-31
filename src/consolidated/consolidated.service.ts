import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { CreateConsolidatedDto } from './dto/create-consolidated.dto';
import { UpdateConsolidatedDto } from './dto/update-consolidated.dto';
import { Repository } from 'typeorm';
import { ChargeShipment, Consolidated, Shipment } from 'src/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { ShipmentConsolidatedDto } from './dto/shipment.dto';
import { ConsolidatedDto } from './dto/consolidated.dto';
import { ShipmentsService } from 'src/shipments/shipments.service';

@Injectable()
export class ConsolidatedService {
  private readonly logger = new Logger(ConsolidatedService.name);

  constructor(
    @InjectRepository(Consolidated)
    private readonly consolidatedRepository: Repository<Consolidated>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @Inject(forwardRef(() => ShipmentsService))
    private readonly shipmentService: ShipmentsService
  ){}

  async create(createConsolidatedDto: CreateConsolidatedDto) {
    const newConsolidated = await this.consolidatedRepository.create(createConsolidatedDto);
    return await this.consolidatedRepository.save(newConsolidated);
  }

  private calculateDaysDifference(startDate: Date, endDate: Date): number {
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  async findBySubsidiary(subdiaryId: string): Promise<{
    id: string, 
    type: string, 
    date: Date,
    consNumber: string,
    numberOfPackages: number,
    subsidiary: {
      id: string,
      name: string
    }
  }[]> {
    const result = await this.consolidatedRepository.find({
      select: {
        id: true,
        type: true,
        date: true,
        consNumber: true,
        numberOfPackages: true,
        subsidiary: {
          id: true,
          name: true,
        }
      },
      where: {
        subsidiary: {
          id: subdiaryId
        }
      },
      relations: [
        'subsidiary'
      ], order: {
        date: 'DESC'
      }
    });

    return result;
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

    // 2. Construir consulta única optimizada
    const queryBuilder = this.consolidatedRepository
      .createQueryBuilder('consolidated')
      .leftJoinAndSelect('consolidated.subsidiary', 'subsidiary')
      .leftJoin(
        'shipment',
        'shipment',
        'shipment.consolidatedId = consolidated.id AND shipment.consolidatedId IS NOT NULL'
      )
      .select([
        'consolidated.id AS id',
        'consolidated.date AS date',
        'consolidated.numberOfPackages AS numberOfPackages',
        'consolidated.consNumber AS consNumber',
        'consolidated.type AS type',
        // Solo necesitamos id y name de subsidiary
        'subsidiary.id AS subsidiary_id',
        'subsidiary.name AS subsidiary_name'
      ])
      .addSelect('COUNT(shipment.id)', 'totalShipments')
      .addSelect(`SUM(CASE WHEN shipment.status = 'en_ruta' THEN 1 ELSE 0 END)`, 'en_ruta')
      .addSelect(`SUM(CASE WHEN shipment.status = 'entregado' THEN 1 ELSE 0 END)`, 'entregado')
      .addSelect(`SUM(CASE WHEN shipment.status = 'no_entregado' THEN 1 ELSE 0 END)`, 'no_entregado')
      .addSelect(`SUM(CASE WHEN shipment.status NOT IN ('en_ruta', 'entregado', 'no_entregado') AND shipment.status IS NOT NULL THEN 1 ELSE 0 END)`, 'other')
      .groupBy('consolidated.id, subsidiary.id, subsidiary.name')
      .orderBy('consolidated.date', 'DESC');

    // 3. Aplicar filtros
    if (subsidiaryId) {
      queryBuilder.andWhere('consolidated.subsidiaryId = :subsidiaryId', { subsidiaryId });
    }

    if (utcFromDate && utcToDate) {
      queryBuilder.andWhere('consolidated.date BETWEEN :fromDate AND :toDate', {
        fromDate: utcFromDate,
        toDate: utcToDate
      });
      
      console.log('Buscando consolidados entre:', utcFromDate, 'y', utcToDate);
    }

    // 4. Ejecutar consulta
    const results = await queryBuilder.getRawMany();

    if (results.length === 0) {
      console.warn('No se encontraron consolidados con los filtros aplicados');
      return [];
    }

    // 5. Mapear resultados
    return results.map(result => {
      const total = parseInt(result.totalShipments, 10) || 0;
      const en_ruta = parseInt(result.en_ruta, 10) || 0;
      const entregado = parseInt(result.entregado, 10) || 0;
      const no_entregado = parseInt(result.no_entregado, 10) || 0;
      const other = parseInt(result.other, 10) || 0;

      // Validar que la suma de conteos sea igual al total
      const calculatedTotal = en_ruta + entregado + no_entregado + other;
      if (total !== calculatedTotal) {
        console.warn(`Discrepancia en conteos para consolidado ${result.consNumber}: total=${total}, calculado=${calculatedTotal}`);
      }

      const isComplete = total > 0 && en_ruta === 0;

      return {
        id: result.id,
        date: result.date,
        consolidatedDate: result.date,
        numberOfPackages: result.numberOfPackages,
        consNumber: result.consNumber,
        type: result.type,
        subsidiary: {
          id: result.subsidiary_id,
          name: result.subsidiary_name
        },
        isConsolidatedComplete: isComplete,
        shipmentCounts: {
          total,
          en_ruta,
          entregado,
          no_entregado,
          other
        },
        shipments: []
      };
    });
  }

  async getShipmentsByConsolidatedId(consolidatedId): Promise<ShipmentConsolidatedDto[]> { // Cambiamos el tipo de retorno a solo shipments
      // 1. Validación - consolidatedId es requerido
      if (!consolidatedId) {
        throw new Error('El consolidatedId es requerido');
      }

      // 2. Buscar el consolidado específico (solo para obtener la fecha)
      const consolidate = await this.consolidatedRepository.findOne({
        select: {
          id: true,
          date: true,
        },
        where: { id: consolidatedId },
      });

      if (!consolidate) {
        console.warn(`No se encontró el consolidado con ID: ${consolidatedId}`);
        return [];
      }

      // 3. Consulta de shipments solo para el consolidatedId específico
      const shipments = await this.shipmentRepository.find({
        select: {
          id: true,
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
        where: { 
          consolidatedId: consolidatedId // Solo shipments de este consolidado
        },
        relations: ['subsidiary', 'statusHistory'],
        order: { commitDateTime: 'DESC' },
      });

      // 4. Procesar los shipments (manteniendo toda la lógica original)
      return shipments.map(shipment => {
        // Ordenar historial de estados por fecha
        if (shipment.statusHistory?.length > 0) {
          shipment.statusHistory.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        }

        // Calcular días en ruta si está en estado 'en_ruta'
        const daysInRoute = shipment.status === 'en_ruta'
          ? this.calculateDaysDifference(new Date(consolidate.date), new Date())
          : 0;

        return {
          ...shipment,
          daysInRoute,
        } as ShipmentConsolidatedDto;
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

  async findShipmentsByConsolidatedId(id: string) {
    console.log("🔍 Buscando consolidated con id:", id);

    let consolidated = await this.consolidatedRepository.findOne({
      where: { id },
      select: ['id', 'consNumber', 'createdAt'],
    });

    console.log("🟢 consolidated:", consolidated);

    if (!consolidated) return [];

    console.log("🔹 consNumber del consolidated:", consolidated.consNumber);

    const shipments = await this.shipmentRepository.find({
      where: { consNumber: consolidated.consNumber },
      relations: [
        'packageDispatch',
        'packageDispatch.vehicle',
        'packageDispatch.subsidiary',
        'packageDispatch.drivers',
        'subsidiary',
        'unloading',
      ],
    });
    console.log("📦 Shipments encontrados:", shipments.length);

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { consNumber: consolidated.consNumber },
      relations: [
        'packageDispatch',
        'packageDispatch.vehicle',
        'packageDispatch.subsidiary',
        'packageDispatch.drivers',
        'subsidiary',
        'unloading',
      ],
    });
    console.log("⚡ ChargeShipments encontrados:", chargeShipments.length);

    if (shipments.length === 0 && chargeShipments.length === 0) {
      console.warn("⚠️ No se encontraron shipments ni chargeShipments con ese consNumber");
      return [];
    }

    const mapShipment = (shipment: any, isCharge: boolean) => {
      const dispatch = shipment.packageDispatch;
      const driverName = dispatch?.drivers?.length ? dispatch.drivers[0].name : null;
      const ubication = dispatch ? 'EN RUTA' : 'EN BODEGA';

      return {
        shipmentData: {
          id: shipment.id,
          trackingNumber: shipment.trackingNumber,
          shipmentStatus: shipment.status,
          commitDateTime: shipment.commitDateTime,
          warehouse: shipment.subsidiary.name,
          ubication,
          unloading: shipment.unloading
            ? {
                trackingNumber: shipment.unloading.trackingNumber,
                date: shipment.unloading.date,
              }
            : null,
          consolidated: {
            consNumber: consolidated.consNumber,
            date: consolidated.createdAt,
          },
          destination: shipment.recipientCity || null,
          payment: shipment.payment,
          createdDate: shipment.createdAt,
          isCharge,
        },
        packageDispatch: dispatch
          ? {
              id: dispatch.id,
              trackingNumber: dispatch.trackingNumber,
              createdAt: dispatch.createdAt,
              status: dispatch.status,
              driver: driverName,
              vehicle: dispatch.vehicle
                ? {
                    name: dispatch.vehicle.name || null,
                    plateNumber: dispatch.vehicle.plateNumber || null,
                  }
                : null,
              subsidiary: dispatch.subsidiary
                ? {
                    id: dispatch.subsidiary.id,
                    name: dispatch.subsidiary.name,
                  }
                : null,
            }
          : null,
      };
    };

    const normalShipments = shipments.map(s => mapShipment(s, false));
    const chargeShipmentsMapped = chargeShipments.map(s => mapShipment(s, true));

    const result = [...normalShipments, ...chargeShipmentsMapped];
    console.log("✅ Resultado final:", result.length);
    return result;
  }

  async updateFedexDataBySucursalAndDate(
    subsidiaryId?: string,
    fromDate?: Date,
    toDate?: Date
  ) {
    // 1. Validación y ajuste de fechas UTC
    let utcFromDate: Date | undefined;
    let utcToDate: Date | undefined;

    if (fromDate && toDate) {
      if (fromDate > toDate) {
        throw new Error('La fecha fromDate no puede ser mayor que toDate');
      }

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

    // 2. Construir consulta simple solo para consolidados
    const queryBuilder = this.consolidatedRepository
      .createQueryBuilder('consolidated')
      .select([
        'consolidated.id',
        'consolidated.consNumber'
      ])
      .orderBy('consolidated.date', 'DESC');

    // 3. Aplicar filtros
    if (subsidiaryId) {
      queryBuilder.andWhere('consolidated.subsidiaryId = :subsidiaryId', { subsidiaryId });
    }

    if (utcFromDate && utcToDate) {
      queryBuilder.andWhere('consolidated.date BETWEEN :fromDate AND :toDate', {
        fromDate: utcFromDate,
        toDate: utcToDate
      });
      
      console.log('Buscando consolidados entre:', utcFromDate, 'y', utcToDate);
    }

    // 4. Ejecutar consulta de consolidados
    const consolidates = await queryBuilder.getMany();

    if (consolidates.length === 0) {
      console.warn('No se encontraron consolidados con los filtros aplicados');
      return [];
    }

    console.log(`📊 Encontrados ${consolidates.length} consolidados`);

    // 5. Para cada consolidado, obtener solo IDs y tracking numbers de shipments
    const shipmentsForFedex = [];
    const shipmentsTrackingNumbers = [];
    const chargeShipmentsTrackingNumbers = [];

    for (const consolidated of consolidates) {
      console.log(`🔍 Buscando shipments para consolidado: ${consolidated.consNumber}`);

      // Obtener solo ID y trackingNumber de shipments normales
      const shipments = await this.shipmentRepository.find({
        where: { consolidatedId: consolidated.id },
        select: ['id', 'trackingNumber']
      });

      // Obtener solo ID y trackingNumber de chargeShipments
      const chargeShipments = await this.chargeShipmentRepository.find({
        where: { consolidatedId: consolidated.id },
        select: ['id', 'trackingNumber']
      });

      console.log(`📦 Shipments: ${shipments.length}, ChargeShipments: ${chargeShipments.length}`);

      if (shipments.length === 0 && chargeShipments.length === 0) {
        console.warn(`⚠️ No se encontraron shipments para consolidado ${consolidated.consNumber}`);
        continue;
      }

      // Combinar y mapear solo los datos necesarios
      const allShipments = [
        ...shipments.map(s => ({
          id: s.id,
          trackingNumber: s.trackingNumber,
          isCharge: false
        })),
        ...chargeShipments.map(s => ({
          id: s.id,
          trackingNumber: s.trackingNumber,
          isCharge: true
        }))
      ];

      shipmentsTrackingNumbers.push(...shipments.map(s => s.trackingNumber))
      chargeShipmentsTrackingNumbers.push(...chargeShipments.map(s => s.trackingNumber))
      shipmentsForFedex.push(...allShipments);
      console.log(`✅ Consolidado ${consolidated.consNumber}: ${allShipments.length} shipments listos para FedEx`);
    }

    console.log(`🎯 Total de shipments para actualizar FedEx: ${shipmentsForFedex.length}`);
    
    try {
      const result = await this.shipmentService.checkStatusOnFedexBySubsidiaryRulesTesting(shipmentsTrackingNumbers, true);
      const resultChargShipments = await this.shipmentService.checkStatusOnFedexChargeShipment(chargeShipmentsTrackingNumbers);

      // Registrar resultados para auditoría
      this.logger.log(
        `✅ Resultado: ${result.updatedShipments.length} envíos actualizados, ` +
        `${resultChargShipments.updatedChargeShipments.length} envíos F2 actualizados, ` +
        `${result.shipmentsWithError.length} errores, ` +
        `${resultChargShipments.chargeShipmentsWithError.length} errores de F2, ` +
        `${result.unusualCodes.length} códigos inusuales, ` +
        `${result.shipmentsWithOD.length} excepciones OD o fallos de validación`
      );

      // Registrar detalles de errores, códigos inusuales y excepciones OD si los hay
      if (result.shipmentsWithError.length) {
        this.logger.warn(`⚠️ Errores detectados: ${JSON.stringify(result.shipmentsWithError, null, 2)}`);
      }

      if (resultChargShipments.chargeShipmentsWithError.length) {
        this.logger.warn(`⚠️ Errores detectados en F2: ${JSON.stringify(resultChargShipments.chargeShipmentsWithError, null, 2)}`);
      }

      if (result.unusualCodes.length) {
        this.logger.warn(`⚠️ Códigos inusuales: ${JSON.stringify(result.unusualCodes, null, 2)}`);
      }
      if (result.shipmentsWithOD.length) {
        this.logger.warn(`⚠️ Excepciones OD o fallos de validación: ${JSON.stringify(result.shipmentsWithOD, null, 2)}`);
      }
    } catch (err) {
      this.logger.error(`❌ Error en handleCron: ${err.message}`);
    }

    return shipmentsForFedex;
  }

  async updateFedexDataByConsolidatedId(consolidatedId: string) {
    // Validar que se proporcione el ID del consolidado
    if (!consolidatedId) {
      throw new Error('El ID del consolidado es requerido');
    }

    // 1. Buscar el consolidado específico por ID
    const consolidated = await this.consolidatedRepository.findOne({
      where: { id: consolidatedId },
      select: ['id', 'consNumber']
    });

    if (!consolidated) {
      console.warn(`No se encontró el consolidado con ID: ${consolidatedId}`);
      return [];
    }

    console.log(`🔍 Procesando consolidado: ${consolidated.consNumber}`);

    // 2. Obtener solo IDs y tracking numbers de shipments
    const shipmentsForFedex = [];
    const shipmentsTrackingNumbers = [];
    const chargeShipmentsTrackingNumbers = [];

    // Obtener solo ID y trackingNumber de shipments normales
    const shipments = await this.shipmentRepository.find({
      where: { consolidatedId: consolidated.id },
      select: ['id', 'trackingNumber']
    });

    // Obtener solo ID y trackingNumber de chargeShipments
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { consolidatedId: consolidated.id },
      select: ['id', 'trackingNumber']
    });

    console.log(`📦 Shipments: ${shipments.length}, ChargeShipments: ${chargeShipments.length}`);

    if (shipments.length === 0 && chargeShipments.length === 0) {
      console.warn(`⚠️ No se encontraron shipments para consolidado ${consolidated.consNumber}`);
      return [];
    }

    // Combinar y mapear solo los datos necesarios
    const allShipments = [
      ...shipments.map(s => ({
        id: s.id,
        trackingNumber: s.trackingNumber,
        isCharge: false
      })),
      ...chargeShipments.map(s => ({
        id: s.id,
        trackingNumber: s.trackingNumber,
        isCharge: true
      }))
    ];

    shipmentsTrackingNumbers.push(...shipments.map(s => s.trackingNumber));
    chargeShipmentsTrackingNumbers.push(...chargeShipments.map(s => s.trackingNumber));
    shipmentsForFedex.push(...allShipments);

    console.log(`✅ Consolidado ${consolidated.consNumber}: ${allShipments.length} shipments listos para FedEx`);

    // 3. Procesar con FedEx
    try {
      const result = await this.shipmentService.checkStatusOnFedexBySubsidiaryRulesTesting(shipmentsTrackingNumbers, true);
      const resultChargShipments = await this.shipmentService.checkStatusOnFedexChargeShipment(chargeShipmentsTrackingNumbers);

      // Registrar resultados para auditoría
      this.logger.log(
        `✅ Resultado para consolidado ${consolidated.consNumber}: ` +
        `${result.updatedShipments.length} envíos actualizados, ` +
        `${resultChargShipments.updatedChargeShipments.length} envíos F2 actualizados, ` +
        `${result.shipmentsWithError.length} errores, ` +
        `${resultChargShipments.chargeShipmentsWithError.length} errores de F2, ` +
        `${result.unusualCodes.length} códigos inusuales, ` +
        `${result.shipmentsWithOD.length} excepciones OD o fallos de validación`
      );

      // Registrar detalles de errores, códigos inusuales y excepciones OD si los hay
      if (result.shipmentsWithError.length) {
        this.logger.warn(`⚠️ Errores detectados: ${JSON.stringify(result.shipmentsWithError, null, 2)}`);
      }

      if (resultChargShipments.chargeShipmentsWithError.length) {
        this.logger.warn(`⚠️ Errores detectados en F2: ${JSON.stringify(resultChargShipments.chargeShipmentsWithError, null, 2)}`);
      }

      if (result.unusualCodes.length) {
        this.logger.warn(`⚠️ Códigos inusuales: ${JSON.stringify(result.unusualCodes, null, 2)}`);
      }
      
      if (result.shipmentsWithOD.length) {
        this.logger.warn(`⚠️ Excepciones OD o fallos de validación: ${JSON.stringify(result.shipmentsWithOD, null, 2)}`);
      }

    } catch (err) {
      this.logger.error(`❌ Error al actualizar FedEx para consolidado ${consolidated.consNumber}: ${err.message}`);
      // Opcional: Guardar el error en un log persistente o enviar una notificación
    }

    return shipmentsForFedex;
  }

}
