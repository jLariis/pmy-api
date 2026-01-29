import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { CreateConsolidatedDto } from './dto/create-consolidated.dto';
import { UpdateConsolidatedDto } from './dto/update-consolidated.dto';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { ChargeShipment, Consolidated, Shipment, ShipmentStatus } from 'src/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { ShipmentConsolidatedDto } from './dto/shipment.dto';
import { ConsolidatedDto } from './dto/consolidated.dto';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

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
    private readonly shipmentService: ShipmentsService,
    @InjectRepository(ShipmentStatus)
    private readonly shipmentStatusRepository: Repository<ShipmentStatus>
  ){}

  async create(createConsolidatedDto: CreateConsolidatedDto) {
    const newConsolidated = await this.consolidatedRepository.create(createConsolidatedDto);
    return await this.consolidatedRepository.save(newConsolidated);
  }

  private calculateDaysDifference(startDate: Date, endDate: Date): number {
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  async findBySubsidiaryResp(subdiaryId: string): Promise<{
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

  /**** Nuevo para solo obtener 5 días atras */
  async findBySubsidiary(subsidiaryId: string): Promise<{
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
    // Calcular la fecha límite (5 días antes de hoy)
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 15);
    // Opcional: establecer a medianoche para incluir todo el día
    fiveDaysAgo.setHours(0, 0, 0, 0);
    
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
          id: subsidiaryId
        },
        date: MoreThanOrEqual(fiveDaysAgo)
      },
      relations: [
        'subsidiary'
      ], 
      order: {
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
    let utcFromDate: Date | undefined;
    let utcToDate: Date | undefined;

    if (fromDate && toDate) {
      utcFromDate = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate(), 0, 0, 0));
      utcToDate = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate(), 23, 59, 59));
    }

    const queryBuilder = this.consolidatedRepository
      .createQueryBuilder('consolidated')
      .leftJoinAndSelect('consolidated.subsidiary', 'subsidiary')
      .leftJoin('shipment', 'shipment', 'shipment.consolidatedId = consolidated.id')
      // Unimos con el historial para rescatar códigos de paquetes viejos ('no_entregado')
      .leftJoin('shipment_status', 'status_history', 
        'status_history.id = (SELECT id FROM shipment_status WHERE shipmentId = shipment.id ORDER BY timestamp DESC LIMIT 1)')
      .select([
        'consolidated.id AS id',
        'consolidated.date AS date',
        'consolidated.numberOfPackages AS numberOfPackages',
        'consolidated.consNumber AS consNumber',
        'consolidated.type AS type',
        'subsidiary.id AS subsidiary_id',
        'subsidiary.name AS subsidiary_name'
      ])
      .addSelect('COUNT(shipment.id)', 'total')
      .addSelect(`SUM(CASE WHEN shipment.status = 'en_ruta' THEN 1 ELSE 0 END)`, 'en_ruta')
      .addSelect(`SUM(CASE WHEN shipment.status = 'en_bodega' THEN 1 ELSE 0 END)`, 'en_bodega')
      .addSelect(`SUM(CASE WHEN shipment.status = 'entregado' THEN 1 ELSE 0 END)`, 'entregado')
      
      // Lógica Híbrida para DEX:
      // Cuenta si el status ya es el nuevo O si es 'no_entregado' pero el historial dice el código correspondiente
      .addSelect(`SUM(CASE 
          WHEN shipment.status = 'direccion_incorrecta' THEN 1 
          WHEN shipment.status = 'no_entregado' AND status_history.exceptionCode = '03' THEN 1 
          ELSE 0 END)`, 'dex03')
      
      .addSelect(`SUM(CASE 
          WHEN shipment.status = 'rechazado' THEN 1 
          WHEN shipment.status = 'no_entregado' AND status_history.exceptionCode = '07' THEN 1 
          ELSE 0 END)`, 'dex07')
      
      .addSelect(`SUM(CASE 
          WHEN shipment.status = 'cliente_no_disponible' THEN 1 
          WHEN shipment.status = 'no_entregado' AND status_history.exceptionCode = '08' THEN 1 
          ELSE 0 END)`, 'dex08')
      
      // Otros: Ajustamos el NOT IN para incluir el caso genérico de no_entregado que no mapeó a ningún DEX anterior
      .addSelect(`SUM(CASE 
          WHEN shipment.status NOT IN ('en_ruta', 'en_bodega', 'entregado', 'direccion_incorrecta', 'rechazado', 'cliente_no_disponible') 
              AND (shipment.status != 'no_entregado' OR (status_history.exceptionCode NOT IN ('03','07','08') OR status_history.exceptionCode IS NULL))
              AND shipment.status IS NOT NULL THEN 1 
          ELSE 0 END)`, 'other')
      .groupBy('consolidated.id, subsidiary.id, subsidiary.name')
      .orderBy('consolidated.date', 'DESC');

    if (subsidiaryId) queryBuilder.andWhere('consolidated.subsidiaryId = :subsidiaryId', { subsidiaryId });
    if (utcFromDate && utcToDate) {
      queryBuilder.andWhere('consolidated.date BETWEEN :fromDate AND :toDate', { fromDate: utcFromDate, toDate: utcToDate });
    }

    const results = await queryBuilder.getRawMany();

    return results.map(res => {
      const total = parseInt(res.total, 10) || 0;
      const counts = {
        total,
        en_ruta: parseInt(res.en_ruta, 10) || 0,
        en_bodega: parseInt(res.en_bodega, 10) || 0,
        entregado: parseInt(res.entregado, 10) || 0,
        dex03: parseInt(res.dex03, 10) || 0,
        dex07: parseInt(res.dex07, 10) || 0,
        dex08: parseInt(res.dex08, 10) || 0,
        other: parseInt(res.other, 10) || 0,
      };

      return {
        id: res.id,
        date: res.date,
        consolidatedDate: res.date,
        numberOfPackages: res.numberOfPackages,
        consNumber: res.consNumber,
        type: res.type,
        subsidiary: { id: res.subsidiary_id, name: res.subsidiary_name },
        isConsolidatedComplete: total > 0 && counts.en_ruta === 0 && counts.en_bodega === 0,
        shipmentCounts: counts,
        shipments: []
      };
    });
  }

  async findByConsNumber(consNumber: string): Promise<Consolidated | null> {
    return await this.consolidatedRepository.findOne({
      where: { consNumber }
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
      .andWhere('consolidated.type IN (:...types)', { types: ['ordinario', 'aereo'] })
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
      where: { consolidatedId: consolidated.id },
      relations: [
        'packageDispatch',
        'packageDispatch.vehicle',
        'packageDispatch.subsidiary',
        'packageDispatch.drivers',
        'subsidiary',
        'payment',
        'unloading',
      ],
    });
    console.log("📦 Shipments encontrados:", shipments.length);

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { consolidatedId: consolidated.id },
      relations: [
        'packageDispatch',
        'packageDispatch.vehicle',
        'packageDispatch.subsidiary',
        'packageDispatch.drivers',
        'payment',
        'subsidiary',
        'unloading',
      ],
    });
    console.log("⚡ ChargeShipments encontrados:", chargeShipments.length);

    if (shipments.length === 0 && chargeShipments.length === 0) {
      console.warn("⚠️ No se encontraron shipments ni chargeShipments con ese consNumber");
      return [];
    }

    // ========= 🔥 Helper: calcular días en bodega =========
    const calcDaysInWarehouse = (createdAt: Date, status: string) => {
      //if (status !== 'entre') return "N/A";
      const today = new Date();
      const created = new Date(createdAt);
      const diff = Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      return diff;
    };

    // ========= 🔥 Helper: obtener dexCode =========
    const getDexCode = async (shipmentId: string, status: string) => {
      const rejectedStatuses = [
        'rechazado',
        'no_entregado',
        'direccion_incorrecta',
        'cliente_no_encontrado',
        'cambio_fecha_solicitado'
      ];

      if (!rejectedStatuses.includes(status)) {
        return null;
      }

      const row = await this.shipmentStatusRepository
        .createQueryBuilder('ss')
        .select('ss.exceptionCode', 'exceptionCode')
        .where('ss.shipmentId = :shipmentId', { shipmentId })
        .orderBy('ss.createdAt', 'DESC')
        .limit(1)
        .getRawOne();

      return row?.exceptionCode ?? null;
    };

    // ========= 🔥 MAPEO FINAL CORREGIDO =========
    const mapShipment = async (shipment: any, isCharge: boolean) => {
      const dispatch = shipment.packageDispatch;
      const driverName = dispatch?.drivers?.length ? dispatch.drivers[0].name : null;
      const ubication = dispatch ? 'EN RUTA' : 'EN BODEGA';

      // 👉 Days in warehouse
      const daysInWarehouse = calcDaysInWarehouse(shipment.createdAt, shipment.status);

      // 👉 dexCode solo si está no_entregado
      const dexCode = await getDexCode(shipment.id, shipment.status);

      return {
        shipmentData: {
          id: shipment.id,
          trackingNumber: shipment.trackingNumber,
          shipmentStatus: shipment.status,
          commitDateTime: shipment.commitDateTime,
          ubication,
          // 🛡️ PROTECCIÓN: Si subsidiary es null, ponemos "SIN SUCURSAL"
          warehouse: shipment.subsidiary?.name ?? 'SIN SUCURSAL', 
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
          payment: shipment.payment
            ? {
                type: shipment.payment.type,
                amount: +shipment.payment.amount,
              }
            : null,
          createdDate: shipment.createdAt,
          recipientName: shipment.recipientName,
          recipientAddress: shipment.recipientAddress,
          recipientPhone: shipment.recipientPhone,
          recipientZip: shipment.recipientZip,

          shipmentType: shipment.shipmentType,
          daysInWarehouse,
          dexCode,
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

    const mappedNormal = await Promise.all(shipments.map(s => mapShipment(s, false)));
    const mappedCharge = await Promise.all(chargeShipments.map(s => mapShipment(s, true)));

    const result = [...mappedNormal, ...mappedCharge];

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
      await this.shipmentService.processMasterFedexUpdate(shipmentsTrackingNumbers);
      await this.shipmentService.processChargeFedexUpdate(chargeShipmentsTrackingNumbers);
    } catch (err) {
      this.logger.error(`❌ Error al actualizar FedEx para consolidados ${consolidates}: ${err.message}`);
    }

    return "Proceso terminado.";
  }

  async updateFedexDataByConsolidatedId(consolidatedId: string) {
    this.logger.log(`🚀 Iniciando actualización FedEx para consolidatedId: ${consolidatedId}`);

    if (!consolidatedId) {
      throw new Error('El ID del consolidado es requerido');
    }

    // ==============================
    // 1. Buscar el Consolidado
    // ==============================
    const consolidated = await this.consolidatedRepository.findOne({
      where: { id: consolidatedId },
      select: ['id', 'consNumber']
    });

    if (!consolidated) {
      this.logger.warn(`❌ No se encontró el consolidado con ID: ${consolidatedId}`);
      return [];
    }

    this.logger.log(`🔍 Procesando consolidado #${consolidated.consNumber} (${consolidated.id})`);

    // ==============================
    // 2. Obtener shipments que SÍ requieren revisión FedEx
    // ==============================

    const statusesForFedex = [
      ShipmentStatusType.EN_RUTA,
      ShipmentStatusType.EN_BODEGA,
      ShipmentStatusType.DESCONOCIDO,
      ShipmentStatusType.PENDIENTE,
      ShipmentStatusType.NO_ENTREGADO,
      ShipmentStatusType.DIRECCION_INCORRECTA,
      ShipmentStatusType.CAMBIO_FECHA_SOLICITADO,
      ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
    ];

    this.logger.log(`📌 Status que SÍ se revisarán en FedEx: ${statusesForFedex.join(', ')}`);
    this.logger.log(`📌 EXCLUYENDO status ENTREGADO`);

    const shipments = await this.shipmentRepository.find({
      where: {
        consolidatedId: consolidated.id,
        status: In(statusesForFedex)
      },
      select: ['id', 'trackingNumber', 'status']
    });

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: {
        consolidatedId: consolidated.id,
        status: In(statusesForFedex)
      },
      select: ['id', 'trackingNumber', 'status']
    });

    this.logger.log(`📦 Shipments candidatos a revisión: ${shipments.length}`);
    this.logger.log(`⚡ ChargeShipments candidatos a revisión: ${chargeShipments.length}`);

    if (shipments.length === 0 && chargeShipments.length === 0) {
      this.logger.warn(
        `⚠️ No hay envíos pendientes de revisión FedEx en el consolidado ${consolidated.consNumber}`
      );
      return [];
    }

    // ==============================
    // 3. Combinar datos necesarios
    // ==============================

    const shipmentsForFedex = [
      ...shipments.map(s => ({ id: s.id, trackingNumber: s.trackingNumber, status: s.status, isCharge: false })),
      ...chargeShipments.map(cs => ({ id: cs.id, trackingNumber: cs.trackingNumber, status: cs.status, isCharge: true }))
    ];

    const shipmentsTrackingNumbers = shipments.map(s => s.trackingNumber);
    const chargeTrackingNumbers = chargeShipments.map(cs => cs.trackingNumber);

    this.logger.log(`🔢 Total general a revisar: ${shipmentsForFedex.length}`);
    this.logger.log(`📝 Listado de tracking normales:\n${JSON.stringify(shipmentsTrackingNumbers, null, 2)}`);
    this.logger.log(`📝 Listado de tracking F2:\n${JSON.stringify(chargeTrackingNumbers, null, 2)}`);

    // ==============================
    // 4. Enviar a FedEx
    // ==============================

    let fedexResult = null;
    let fedexChargeResult = null;

    try {
      await this.shipmentService.processMasterFedexUpdate(shipmentsTrackingNumbers)
      await this.shipmentService.processChargeFedexUpdate(chargeTrackingNumbers);

      this.logger.log(`✅ Consolidado ${consolidated.consNumber} procesado exitosamente.`);
    } catch (err) {
      this.logger.error(`❌ Error al consultar FedEx: ${err.message}`);
    }

    // ==============================
    // 5. Resumen Final
    // ==============================

    const statusCount = shipmentsForFedex.reduce((acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    this.logger.log(
      "📊 RESUMEN FINAL:\n" +
      `- Consolidado: ${consolidated.consNumber}\n` +
      `- Revisados totales: ${shipmentsForFedex.length}\n` +
      `- Breakdown por status:\n${JSON.stringify(statusCount, null, 2)}\n` +
      `- Normal: ${shipments.length}\n` +
      `- ChargeShipment: ${chargeShipments.length}`
    );

    this.logger.log("🟢 Proceso FedEx finalizado.");

    return shipmentsForFedex;
  }

  async getShipmentsWithout67ByConsolidated(id: string){
    const shipmentsWithout67 = [];

    const shipments = await this.shipmentRepository.find({
      where: { consolidatedId: id },
      relations: [
        'statusHistory',
      ],
    });

    console.log("📦 Shipments encontrados:", shipments.length);

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { consolidatedId: id },
      relations: [
        'statusHistory',
      ],
    });

    console.log("⚡ ChargeShipments encontrados:", chargeShipments.length);

    const allShipments = [...shipments, ...chargeShipments];

    for (const shipment of allShipments) {
        try {
          if (!shipment.statusHistory || shipment.statusHistory.length === 0) {
            shipmentsWithout67.push({
              trackingNumber: shipment.trackingNumber,
              currentStatus: shipment.status,
              statusHistoryCount: 0,
              exceptionCodes: [],
              firstStatusDate: null,
              lastStatusDate: null,
              comment: 'Sin historial de estados',
            });
            continue;
          }

          const sortedHistory = shipment.statusHistory.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );

          const hasExceptionCode67 = sortedHistory.some(status => 
            status.exceptionCode === '67'
          );

          if (!hasExceptionCode67) {
            const firstStatus = sortedHistory[0];
            const lastStatus = sortedHistory[sortedHistory.length - 1];

            const exceptionCodes = sortedHistory
              .map(h => h.exceptionCode)
              .filter(code => code !== null && code !== undefined);

            shipmentsWithout67.push({
              trackingNumber: shipment.trackingNumber,
              recipientAddress: shipment.recipientAddress,
              recipientName: shipment.recipientName,
              recipientCity: shipment.recipientCity,
              recipientZip: shipment.recipientZip,
              currentStatus: shipment.status,
              statusHistoryCount: sortedHistory.length,
              exceptionCodes: [...new Set(exceptionCodes)],
              firstStatusDate: firstStatus?.timestamp,
              lastStatusDate: lastStatus?.timestamp,
              comment: 'No tiene exceptionCode 67',
            });
          }

        } catch (error) {
          shipmentsWithout67.push({
            trackingNumber: shipment.trackingNumber,
            currentStatus: shipment.status,
            statusHistoryCount: 0,
            exceptionCodes: [],
            firstStatusDate: null,
            lastStatusDate: null,
            comment: `Error: ${error.message}`,
          });
        }
      }

    return { 
      count: shipmentsWithout67.length,
      shipments: shipmentsWithout67
    };

  }

  async getShipmentsWithout44ByConsolidated(id: string) {
    const shipmentsWithout44 = [];

    // 1. Obtener embarques normales
    const shipments = await this.shipmentRepository.find({
      where: { consolidatedId: id },
      relations: ['statusHistory'],
    });

    // 2. Obtener embarques de carga (ChargeShipments)
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { consolidatedId: id },
      relations: ['statusHistory'],
    });

    console.log("📦 Shipments encontrados:", shipments.length);
    console.log("⚡ ChargeShipments encontrados:", chargeShipments.length);

    const allShipments = [...shipments, ...chargeShipments];

    for (const shipment of allShipments) {
      try {
        // Caso: No hay historial de estados
        if (!shipment.statusHistory || shipment.statusHistory.length === 0) {
          shipmentsWithout44.push({
            trackingNumber: shipment.trackingNumber,
            currentStatus: shipment.status,
            statusHistoryCount: 0,
            exceptionCodes: [],
            firstStatusDate: null,
            lastStatusDate: null,
            comment: 'Sin historial de estados',
          });
          continue;
        }

        // Ordenar historial por fecha
        const sortedHistory = shipment.statusHistory.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        // --- CAMBIO CLAVE: Validar código 44 ---
        const hasExceptionCode44 = sortedHistory.some(status => 
          status.exceptionCode === '44'
        );

        if (!hasExceptionCode44) {
          const firstStatus = sortedHistory[0];
          const lastStatus = sortedHistory[sortedHistory.length - 1];

          const exceptionCodes = sortedHistory
            .map(h => h.exceptionCode)
            .filter(code => code !== null && code !== undefined);

          shipmentsWithout44.push({
            trackingNumber: shipment.trackingNumber,
            recipientAddress: shipment.recipientAddress,
            recipientName: shipment.recipientName,
            recipientCity: shipment.recipientCity,
            recipientZip: shipment.recipientZip,
            currentStatus: shipment.status,
            statusHistoryCount: sortedHistory.length,
            exceptionCodes: [...new Set(exceptionCodes)],
            firstStatusDate: firstStatus?.timestamp,
            lastStatusDate: lastStatus?.timestamp,
            comment: 'No tiene exceptionCode 44',
          });
        }

      } catch (error) {
        shipmentsWithout44.push({
          trackingNumber: shipment.trackingNumber,
          currentStatus: shipment.status,
          statusHistoryCount: 0,
          exceptionCodes: [],
          firstStatusDate: null,
          lastStatusDate: null,
          comment: `Error: ${error.message}`,
        });
      }
    }

    return { 
      count: shipmentsWithout44.length,
      shipments: shipmentsWithout44
    };
  }

}
