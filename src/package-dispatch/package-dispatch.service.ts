import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreatePackageDispatchDto } from './dto/create-package-dispatch.dto';
import { UpdatePackageDispatchDto } from './dto/update-package-dispatch.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { DataSource, In, Not, Repository } from 'typeorm';
import { Shipment, ChargeShipment, Consolidated, ShipmentStatus } from 'src/entities';
import { ValidatedPackageDispatchDto } from './dto/validated-package-dispatch.dto';
import { Devolution } from 'src/entities/devolution.entity';
import { MailService } from 'src/mail/mail.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { FedexService } from 'src/shipments/fedex.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { PackageDispatchHistory } from 'src/entities/package-dispatch-history.entity';
import { DateTime } from 'luxon';
import * as ExcelJS from 'exceljs';

@Injectable()
export class PackageDispatchService {
  private readonly logger = new Logger(PackageDispatchService.name);

  constructor(
    @InjectRepository(PackageDispatch)
    private readonly packageDispatchRepository: Repository<PackageDispatch>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(Consolidated)
    private readonly consolidatedRepository: Repository<Consolidated>,
    @InjectRepository(Devolution)
    private readonly devolutionRepository: Repository<Devolution>,
    private readonly mailService: MailService,
    private readonly fedexService: FedexService,
    @Inject(forwardRef(() => ShipmentsService))
    private readonly shipmentService: ShipmentsService,
    @InjectRepository(ShipmentStatus)
    private readonly shipmentStatusRepository: Repository<ShipmentStatus>,
    private readonly dataSource: DataSource,

  ){

  }

  async createResp2801(dto: CreatePackageDispatchDto): Promise<PackageDispatch> {
    const allShipmentIds = dto.shipments;

    // 1. Buscar en shipmentRepository
    const shipments = await this.shipmentRepository.find({
      where: { id: In(allShipmentIds) },
    });

    const foundShipmentIds = shipments.map(s => s.id);
    const missingIds = allShipmentIds.filter(id => !foundShipmentIds.includes(id));

    // 2. Buscar los faltantes en chargeShipmentRepository
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { id: In(missingIds) },
    });

    const foundChargeShipmentIds = chargeShipments.map(s => s.id);
    const stillMissing = missingIds.filter(id => !foundChargeShipmentIds.includes(id));

    if (stillMissing.length > 0) {
      throw new Error(`Algunos IDs de envíos no fueron encontrados: ${stillMissing.join(', ')}`);
    }

    // 3. Crear el despacho
    const newPackageDispatch = this.packageDispatchRepository.create({
      routes: dto.routes || [],
      drivers: dto.drivers || [],
      vehicle: dto.vehicle,
      subsidiary: dto.subsidiary,
      kms: dto.kms
    });

    const savedDispatch = await this.packageDispatchRepository.save(newPackageDispatch);

    // 4. Relacionar y ACTUALIZAR ESTATUS (Shipments)
    if (shipments.length > 0) {
      await Promise.all([
        // Relación
        this.shipmentRepository
          .createQueryBuilder()
          .relation(PackageDispatch, 'shipments')
          .of(savedDispatch)
          .add(shipments),
        
        // Actualización de Estatus Masiva
        this.shipmentRepository.update(
          { id: In(foundShipmentIds) },
          { status: ShipmentStatusType.EN_RUTA } // Asegúrate de tener este Enum importado
        )
      ]);
    }

    // 5. Relacionar y ACTUALIZAR ESTATUS (ChargeShipments)
    if (chargeShipments.length > 0) {
      await Promise.all([
        // Relación
        this.chargeShipmentRepository
          .createQueryBuilder()
          .relation(PackageDispatch, 'chargeShipments')
          .of(savedDispatch)
          .add(chargeShipments),

        // Actualización de Estatus Masiva
        this.chargeShipmentRepository.update(
          { id: In(foundChargeShipmentIds) },
          { status: ShipmentStatusType.EN_RUTA }
        )
      ]);
    }

    return savedDispatch;
  }

  async create(dto: CreatePackageDispatchDto): Promise<PackageDispatch> {
    const allShipmentIds = dto.shipments;
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Identificar Shipments y ChargeShipments
      const shipments = await queryRunner.manager.find(Shipment, {
        where: { id: In(allShipmentIds) },
      });
      
      const foundShipmentIds = shipments.map(s => s.id);
      const missingIds = allShipmentIds.filter(id => !foundShipmentIds.includes(id));

      const chargeShipments = await queryRunner.manager.find(ChargeShipment, {
        where: { id: In(missingIds) },
      });

      const foundChargeShipmentIds = chargeShipments.map(s => s.id);
      const stillMissing = missingIds.filter(id => !foundChargeShipmentIds.includes(id));

      if (stillMissing.length > 0) {
        throw new BadRequestException(`No se encontraron los IDs: ${stillMissing.join(', ')}`);
      }

      // 2. Crear y Guardar el Despacho primero
      const newDispatch = queryRunner.manager.create(PackageDispatch, {
        routes: dto.routes || [],
        drivers: dto.drivers || [],
        vehicle: dto.vehicle,
        subsidiary: dto.subsidiary,
        kms: dto.kms,
      });

      const savedDispatch = await queryRunner.manager.save(newDispatch);

      // 3. Función de Actualización Forzada (Write)
      const processUpdates = async (ids: string[], entity: any, relationKey: 'shipment' | 'chargeShipment') => {
        if (ids.length === 0) return;

        // FORZAR ESCRITURA: Usamos QueryBuilder para asegurar el UPDATE en la DB
        const updateResult = await queryRunner.manager
          .createQueryBuilder()
          .update(entity)
          .set({ status: ShipmentStatusType.EN_RUTA }) // Asegúrate que este valor sea el que espera el ENUM/VARCHAR
          .whereInIds(ids)
          .execute();

        if (updateResult.affected === 0) {
          this.logger.warn(`Ojo: No se actualizaron filas para ${relationKey} con IDs: ${ids}`);
        }

        // Creación de Historial
        const now = new Date();
        const historyRecords = ids.map(id => {
          return queryRunner.manager.create(ShipmentStatus, {
            status: ShipmentStatusType.EN_RUTA,
            exceptionCode: '', 
            notes: `Salida a ruta (Folio Despacho: ${savedDispatch.id})`,
            timestamp: now,
            [relationKey]: { id } // Relación directa
          });
        });

        await queryRunner.manager.save(ShipmentStatus, historyRecords);
      };

      // Ejecutar actualizaciones
      await processUpdates(foundShipmentIds, Shipment, 'shipment');
      await processUpdates(foundChargeShipmentIds, ChargeShipment, 'chargeShipment');

      // 4. Vincular tablas Pivot (Many-to-Many)
      // Usamos el manager del queryRunner para que sea parte de la misma transacción
      if (foundShipmentIds.length > 0) {
        await queryRunner.manager
          .createQueryBuilder()
          .relation(PackageDispatch, 'shipments')
          .of(savedDispatch)
          .add(foundShipmentIds);
      }

      if (foundChargeShipmentIds.length > 0) {
        await queryRunner.manager
          .createQueryBuilder()
          .relation(PackageDispatch, 'chargeShipments')
          .of(savedDispatch)
          .add(foundChargeShipmentIds);
      }

      const dispatchHistoryRecords = [
        ...foundShipmentIds.map(id =>
          queryRunner.manager.create(PackageDispatchHistory, {
            dispatch: { id: savedDispatch.id },
            shipment: { id },
          })
        ),
        ...foundChargeShipmentIds.map(id =>
          queryRunner.manager.create(PackageDispatchHistory, {
            dispatch: { id: savedDispatch.id },
            chargeShipment: { id },
          })
        ),
      ];

      await queryRunner.manager.save(PackageDispatchHistory, dispatchHistoryRecords);

      await queryRunner.commitTransaction();
      return savedDispatch;

    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async validatePackage(
    packageToValidate: ValidatedPackageDispatchDto,
    subsidiaryId: string
  ): Promise<ValidatedPackageDispatchDto> {
    let isValid = true;
    let reason = '';

    const existePackageOnPackageDispatch = await this.packageDispatchRepository
    .createQueryBuilder('package')
    .leftJoinAndSelect('shipment', 'shipment', 'shipment.routeId = package.id')
    .select([
      'package.id AS package_id',
      'shipment.trackingNumber AS shipment_trackingNumber', // Fix: Use shipment.trackingNumber
      'package.status AS package_status',
      'package.startTime AS package_startTime',
      'package.estimatedArrival AS package_estimatedArrival',
      'package.createdAt AS package_createdAt',
      'package.updatedAt AS package_updatedAt',
      'package.vehicleId AS package_vehicleId',
      'package.subsidiaryId AS package_subsidiaryId',
    ])
    .where('shipment.trackingNumber = :trackingNumber', { trackingNumber: packageToValidate.trackingNumber })
    .getRawOne();

    const existPackageOnReturn = await this.devolutionRepository.findOne({
      where: { trackingNumber: packageToValidate.trackingNumber },
    })

    /*if (existePackageOnPackageDispatch) {
      isValid = false;
      reason = 'El paquete ya existe en otra salida a ruta';
    }

    if(existPackageOnReturn) {
      isValid = false;
      reason = 'El paquete existe en una devolución';
    }*/

    console.log("🚀 ~ PackageDispatchService ~ validatePackage ~ packageToValidate.subsidiary.id:", packageToValidate.subsidiary.id)
    console.log("🚀 ~ PackageDispatchService ~ validatePackage ~ subsidiaryId:", subsidiaryId)
    
    if (packageToValidate.subsidiary.id.trim() !== subsidiaryId.trim()) {
      isValid = false;
      reason = 'El paquete no pertenece a la sucursal actual';
    }

    // Permitir por ahora...
    /*if (packageToValidate.status === ShipmentStatusType.ENTREGADO) {
      isValid = false;
      reason = 'El paquete ya ha sido entregado';
    }*/

    return {
      ...packageToValidate,
      isValid,
      reason
    };
  }

  async validateTrackingNumber(
    trackingNumber: string,
    subsidiaryId?: string
  ): Promise<ValidatedPackageDispatchDto & { isCharge?: boolean; consolidated?: Consolidated }> {
    const shipment = await this.shipmentRepository.findOne({
      where: { 
        trackingNumber,
        //status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) 
      },
      relations: ['subsidiary', 'statusHistory', 'payment'],
      order: { createdAt: 'DESC' }
    });

    if (!shipment) {
      const chargeShipment = await this.chargeShipmentRepository.findOne({
        where: { 
          trackingNumber,
          //status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) 
        },
        relations: ['subsidiary', 'charge', 'payment'],
        order: { createdAt: 'DESC' }
      });

      if (!chargeShipment) {
        const result = await this.fedexService.completePackageInfo(trackingNumber);

        console.log("🚀 ~ PackageDispatchService ~ validateTrackingNumber ~ packageInfo:", result)

        // Retornar DTO mínimo con un mensaje indicando el motivo
        return {
          trackingNumber,
          isValid: false,
          reason: 'No se encontraron datos para el tracking number en la base de datos',
          subsidiary: null,
          status: null,
        };
      }

      const validatedCharge = await this.validatePackage(
        {
          ...chargeShipment,
          isValid: false,
        },
        subsidiaryId
      );

      return {
        ...validatedCharge,
        isCharge: true,
      };
    }

    const consolidated = await this.consolidatedRepository.findOne({
      where: { id: shipment.consolidatedId },
    });

    const validatedShipment = await this.validatePackage(
      {
        ...shipment,
        isValid: false,
      },
      subsidiaryId
    );

    return {
      ...validatedShipment,
      consolidated,
    };
  }

  findAll() {
    return `This action returns all packageDispatch`;
  }

  async findBySubsidiaryResp(subsidiaryId: string) {
    const qb = this.packageDispatchRepository
      .createQueryBuilder('dispatch')
      .leftJoinAndSelect('dispatch.subsidiary', 'subsidiary')
      .leftJoinAndSelect('dispatch.vehicle', 'vehicle')
      .leftJoinAndSelect('dispatch.drivers', 'drivers')
      .leftJoinAndSelect('dispatch.routes', 'routes')
      .leftJoinAndSelect('dispatch.shipments', 'shipments')
      .leftJoinAndSelect('dispatch.chargeShipments', 'chargeShipments')
      .where('subsidiary.id = :subsidiaryId', { subsidiaryId })
      .orderBy('dispatch.createdAt', 'DESC');

    const dispatches = await qb.getMany();

    // Transformamos los datos según lo que necesitas
    return dispatches.map((dispatch) => ({
      id: dispatch.id,
      trackingNumber: dispatch.trackingNumber,
      createdAt: dispatch.createdAt,
      status: dispatch.status,
      vehicle: dispatch.vehicle
        ? {
            name: dispatch.vehicle.name,
            plateNumber: dispatch.vehicle.plateNumber,
          }
        : null,
      subsidiary: dispatch.subsidiary
        ? {
            id: dispatch.subsidiary.id,
            name: dispatch.subsidiary.name,
          }
        : null,
      driver: dispatch.drivers?.length ? dispatch.drivers[0].name : null, // 👈 primer conductor
      route: dispatch.routes?.length ? dispatch.routes[0].name : null, // 👈 primera ruta
      normalPackages: dispatch.shipments?.length || 0, // 👈 Shipments
      f2Packages: dispatch.chargeShipments?.length || 0, // 👈 ChargeShipments
    }));
  }

  async findBySubsidiary(subsidiaryId: string) {
    // Calcular la fecha límite (15 días antes de hoy)
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 15);
    // Opcional: establecer a medianoche para incluir todo el día
    fiveDaysAgo.setHours(0, 0, 0, 0);

    const qb = this.packageDispatchRepository
      .createQueryBuilder('dispatch')
      .leftJoinAndSelect('dispatch.subsidiary', 'subsidiary')
      .leftJoinAndSelect('dispatch.vehicle', 'vehicle')
      .leftJoinAndSelect('dispatch.drivers', 'drivers')
      .leftJoinAndSelect('dispatch.routes', 'routes')
      .leftJoinAndSelect('dispatch.shipments', 'shipments')
      .leftJoinAndSelect('dispatch.chargeShipments', 'chargeShipments')
      .where('subsidiary.id = :subsidiaryId', { subsidiaryId })
      .andWhere('dispatch.createdAt >= :fiveDaysAgo', { fiveDaysAgo })
      .orderBy('dispatch.createdAt', 'DESC');

    const dispatches = await qb.getMany();

    // Transformamos los datos según lo que necesitas
    return dispatches.map((dispatch) => ({
      id: dispatch.id,
      trackingNumber: dispatch.trackingNumber,
      createdAt: dispatch.createdAt,
      status: dispatch.status,
      vehicle: dispatch.vehicle
        ? {
            name: dispatch.vehicle.name,
            plateNumber: dispatch.vehicle.plateNumber,
          }
        : null,
      subsidiary: dispatch.subsidiary
        ? {
            id: dispatch.subsidiary.id,
            name: dispatch.subsidiary.name,
          }
        : null,
      driver: dispatch.drivers?.length ? dispatch.drivers[0].name : null, // 👈 primer conductor
      route: dispatch.routes?.length ? dispatch.routes[0].name : null, // 👈 primera ruta
      normalPackages: dispatch.shipments?.length || 0, // 👈 Shipments
      f2Packages: dispatch.chargeShipments?.length || 0, // 👈 ChargeShipments
    }));
  }

  async findAllBySubsidiary(subsidiaryId: string) {
    const qb = this.packageDispatchRepository
      .createQueryBuilder('pd')
      .leftJoin('pd.subsidiary', 'subsidiary')
      .leftJoin('pd.routes', 'routes')
      .leftJoin('pd.vehicle', 'vehicle')
      .leftJoin('pd.shipments', 'shipments')
      .leftJoin('pd.chargeShipments', 'chargeShipments')
      .where('subsidiary.id = :subsidiaryId', { subsidiaryId })
      .select([
        'pd.id',
        'pd.trackingNumber',
        'pd.status',
        'pd.createdAt',
        'pd.closedAt',
        'subsidiary.id',
        'subsidiary.name',
        'routes.id',
        'vehicle.id',
      ])
      .addSelect(subQuery => {
        return subQuery
          .select('driver.name')
          .from('package_dispatch_drivers', 'pdd')
          .innerJoin('driver', 'driver', 'driver.id = pdd.driverId')
          .where('pdd.dispatchId = pd.id')
          .limit(1);
      }, 'driverName')
      .addSelect('COUNT(DISTINCT shipments.id)', 'shipmentsCount')
      .addSelect('COUNT(DISTINCT chargeShipments.id)', 'chargeShipmentsCount')
      .groupBy('pd.id')
      .addGroupBy('subsidiary.id')
      .addGroupBy('routes.id')
      .addGroupBy('vehicle.id')
      .orderBy('pd.createdAt', 'DESC');

    const { entities, raw } = await qb.getRawAndEntities();

    // --- CAMBIO AQUÍ ---
    return entities.map((pd) => {
      // Buscamos en el array 'raw' la fila que tenga el ID de este despacho
      // TypeORM suele nombrar el ID en raw como 'pd_id' (por el alias pd)
      const rawData = raw.find(r => r.pd_id === pd.id);

      return {
        ...pd,
        driverName: rawData?.driverName ?? null,
        totalPackages: rawData 
          ? Number(rawData.shipmentsCount) + Number(rawData.chargeShipmentsCount) 
          : 0,
      };
    });
  }

  /** Para monitoreo */
  async findShipmentsByDispatchId(dispatchId: string) {
    console.log(`\nBuscando envíos para dispatchId: ${dispatchId}`);

    // === 1. BUSCAR SHIPMENTS ===
    const shipments = await this.shipmentRepository.find({
      where: { packageDispatch: { id: dispatchId }},
      relations: [
        'packageDispatch',
        'packageDispatch.drivers',
        'packageDispatch.vehicle',
        'packageDispatch.subsidiary',
        'unloading',
        'unloading.subsidiary',
        'payment',
        'subsidiary'
      ],
      order: { commitDateTime: 'DESC' }
    });

    // === 2. BUSCAR CHARGE SHIPMENTS ===
    const chargeShipments = await this.chargeShipmentRepository
      .createQueryBuilder('chargeShipment')
      .leftJoinAndSelect('chargeShipment.payment', 'payment')
      .leftJoinAndSelect('chargeShipment.unloading', 'unloading')
      .leftJoinAndSelect('chargeShipment.packageDispatch', 'packageDispatch')
      .leftJoinAndSelect('packageDispatch.vehicle', 'vehicle')
      .leftJoinAndSelect('packageDispatch.subsidiary', 'subsidiary')
      .leftJoinAndSelect('packageDispatch.drivers', 'drivers')
      .where('packageDispatch.id = :dispatchId', { dispatchId })
      .getMany();

    // === CONSOLIDADOS ===
    const allConsolidatedIds = Array.from(
      new Set([
        ...shipments.map(s => s.consolidatedId).filter(Boolean),
        ...chargeShipments.map(s => s.consolidatedId).filter(Boolean),
      ])
    );

    const consolidatedMap = new Map<string, { consNumber: string; date: Date }>();
    if (allConsolidatedIds.length > 0) {
      const list = await this.consolidatedRepository.find({
        where: { id: In(allConsolidatedIds) },
        select: ['id', 'consNumber', 'createdAt'],
      });
      list.forEach(c =>
        consolidatedMap.set(c.id, { consNumber: c.consNumber, date: c.createdAt })
      );
    }

    // === UNIFICAR DISPATCH ===
    const packageDispatch =
      shipments[0]?.packageDispatch || chargeShipments[0]?.packageDispatch;

    if (!packageDispatch) return [];

    const driverName = packageDispatch.drivers?.[0]?.name ?? null;


    // ================================
    // FUNCIONES NUEVAS
    // ================================

    // 1. DaysInWarehouse (solo EN_RUTA)
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

    // ================================
    // MAPEO
    // ================================
    const mapShipment = async (shipment: any, isCharge: boolean) => {

      const consolidated = shipment.consolidatedId
        ? consolidatedMap.get(shipment.consolidatedId) || null
        : null;

      const daysInWarehouse = calcDaysInWarehouse(
        shipment.createdAt,
        shipment.status
      );

      const dexCode = await getDexCode(shipment.id, shipment.status);

      return {
        shipmentData: {
          id: shipment.id,
          trackingNumber: shipment.trackingNumber,
          shipmentStatus: shipment.status,

          commitDateTime: shipment.commitDateTime,
          ubication: 'EN RUTA',

          unloading: shipment.unloading
            ? {
                trackingNumber: shipment.unloading.trackingNumber,
                date: shipment.unloading.date,
              }
            : null,

          consolidated,

          destination: shipment.recipientCity || null,
          createdDate: shipment.createdAt,

          recipientName: shipment.recipientName,
          recipientAddress: shipment.recipientAddress,
          recipientPhone: shipment.recipientPhone,
          recipientZip: shipment.recipientZip,

          shipmentType: shipment.shipmentType,

          // NUEVO:
          daysInWareHouse: daysInWarehouse,
          dexCode, // <<< NUEVO

          payment: shipment.payment
            ? { amount: +shipment.payment.amount, type: shipment.payment.type }
            : null,

          isCharge,
        },

        packageDispatch: {
          id: packageDispatch.id,
          trackingNumber: packageDispatch.trackingNumber,
          createdAt: packageDispatch.createdAt,
          status: packageDispatch.status,
          driver: driverName,
          vehicle: packageDispatch.vehicle
            ? {
                name: packageDispatch.vehicle.name || null,
                plateNumber: packageDispatch.vehicle.plateNumber || null,
              }
            : null,
          subsidiary: packageDispatch.subsidiary
            ? {
                id: packageDispatch.subsidiary.id,
                name: packageDispatch.subsidiary.name,
              }
            : null,
        },
      };
    };

    const result = [
      ...(await Promise.all(shipments.map(s => mapShipment(s, false)))),
      ...(await Promise.all(chargeShipments.map(cs => mapShipment(cs, true)))),
    ];

    return result;
  }


  findOne(id: string) {
    return `This action returns a #${id} packageDispatch`;
  }

  update(id: string, updatePackageDispatchDto: UpdatePackageDispatchDto) {
    return `This action updates a #${id} packageDispatch`;
  }

  remove(id: string) {
    return `This action removes a #${id} packageDispatch`;
  }

  async sendByEmail(pdfFile: Express.Multer.File, excelfile: Express.Multer.File, subsidiaryName: string, packageDispatchId: string) {
    console.log("🚀 ~ PackageDispatchService ~ sendByEmail ~ packageDispatchId:", packageDispatchId)

    const packageDispatch = await this.packageDispatchRepository.findOne(
      { 
        where: {id: packageDispatchId},
        relations: ['drivers', 'routes', 'vehicle', 'subsidiary']
      });
    console.log("🚀 ~ PackageDispatchService ~ sendByEmail ~ packageDispatch:", packageDispatch)

    return await this.mailService.sendHighPriorityPackageDispatchEmail(pdfFile, excelfile, subsidiaryName, packageDispatch)
  }

  async updateFedexDataByPackageDispatchId(packageDispatchId: string) {
    if (!packageDispatchId) {
      throw new Error('El ID del package dispatch es requerido');
    }

    const packageDispatch = await this.packageDispatchRepository.findOne({
      where: { id: packageDispatchId },
      select: ['id', 'trackingNumber']
    });

    if (!packageDispatch) {
      console.warn(`No se encontró el package dispatch con ID: ${packageDispatchId}`);
      return [];
    }

    // Estatus que queremos seguir rastreando en FedEx hasta que sean ENTREGADO o RECHAZADO
    const statusToTrack = [
      ShipmentStatusType.EN_RUTA, 
      ShipmentStatusType.DESCONOCIDO, 
      ShipmentStatusType.PENDIENTE, 
      ShipmentStatusType.NO_ENTREGADO,
      ShipmentStatusType.CAMBIO_FECHA_SOLICITADO, // <--- INDISPENSABLE
      ShipmentStatusType.CLIENTE_NO_DISPONIBLE,    // <--- INDISPENSABLE para el 08
      ShipmentStatusType.ESTACION_FEDEX,
      ShipmentStatusType.EN_BODEGA
    ];

    // 1. Obtener Shipments Normales
    const shipments = await this.shipmentRepository.find({
      where: { 
        packageDispatch: { id: packageDispatch.id },
        status: In(statusToTrack)
      },
      select: ['id', 'trackingNumber']
    });

    // 2. Obtener ChargeShipments
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { 
        packageDispatch: { id: packageDispatch.id },
        status: In(statusToTrack)
      },
      select: ['id', 'trackingNumber']
    });

    if (shipments.length === 0 && chargeShipments.length === 0) {
      console.warn(`⚠️ No hay envíos pendientes de actualización en despacho ${packageDispatch.trackingNumber}`);
      return [];
    }

    const shipmentsTrackingNumbers = shipments.map(s => s.trackingNumber);
    const chargeShipmentsTrackingNumbers = chargeShipments.map(s => s.trackingNumber);

    try {
      // 3. Procesar actualizaciones (Ahora sí incluirán las guías con excepciones)
      await this.shipmentService.processMasterFedexUpdate(shipments);
      await this.shipmentService.processChargeFedexUpdate(chargeShipments);

      this.logger.log(`✅ Despacho ${packageDispatch.trackingNumber} procesado exitosamente.`);
    } catch (err) {
      this.logger.error(`❌ Error al actualizar FedEx para package dispatch ${packageDispatch.trackingNumber}: ${err.message}`);
    }

    // Devolvemos la lista combinada para información del front/caller
    return [
      ...shipments.map(s => ({ id: s.id, trackingNumber: s.trackingNumber, isCharge: false })),
      ...chargeShipments.map(s => ({ id: s.id, trackingNumber: s.trackingNumber, isCharge: true }))
    ];
  }

  async getShipmentsWithout67ByPackageDispatch(id: string){
    const shipmentsWithout67 = [];

    const shipments = await this.shipmentRepository.find({
      where: { packageDispatch: { id }, status: Not(ShipmentStatusType.ENTREGADO) },
      relations: [
        'statusHistory',

      ],
    });

    console.log("📦 Shipments encontrados:", shipments.length);

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { consolidatedId: id, status: Not(ShipmentStatusType.ENTREGADO) },
      relations: [
        'statusHistory',
      ],
    });

    console.log("⚡ ChargeShipments encontrados:", chargeShipments.length);

    const allShipments = [...shipments, ...chargeShipments]

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
              commitDateTime: shipment.commitDateTime,
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

  async getShipmentsWithout44ByPackageDispatch(id: string) {
    const shipmentsWithout44 = [];

    // 1. Buscar Shipments normales relacionados al despacho
    const shipments = await this.shipmentRepository.find({
      where: { packageDispatch: { id }, status: Not(ShipmentStatusType.ENTREGADO) },
      relations: ['statusHistory'],
    });

    console.log("📦 Shipments encontrados en despacho:", shipments.length);

    // 2. Buscar ChargeShipments relacionados al despacho
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { packageDispatch: { id }, status: Not(ShipmentStatusType.ENTREGADO) }, // Corregido para usar la relación de despacho
      relations: ['statusHistory'],
    });

    console.log("⚡ ChargeShipments encontrados en despacho:", chargeShipments.length);

    const allShipments = [...shipments, ...chargeShipments];

    for (const shipment of allShipments) {
      try {
        // Validar historial
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

        // Ordenar historial
        const sortedHistory = shipment.statusHistory.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        // --- VALIDACIÓN DEL CÓDIGO 44 (Salida a Ruta) ---
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
            commitDateTime: shipment.commitDateTime,
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

  async getShipmentsByPackageDispatchId(packageDispatchId: string) {
    // 1. Intentar actualizar (con un try/catch para que si FedEx falla, la app siga)
    try {
      await this.updateFedexDataByPackageDispatchId(packageDispatchId);
    } catch (error) {
      console.error("⚠️ Error actualizando FedEx, pero mostraré lo que hay en DB:", error);
    }

    // 2. Buscar en tu base de datos (lo que ya tenías)
    const packageDispatch = await this.packageDispatchRepository.findOne({
      where: { id: packageDispatchId },
      relations: [
        'shipments',
        'shipments.payment',
        'shipments.statusHistory',
        'chargeShipments',
        'drivers',
        'vehicle',
        'subsidiary',
        'routes',
      ],
    });

    if (!packageDispatch) {
      throw new NotFoundException('Package dispatch not found'); // Mejor usar la excepción de Nest
    }

    return packageDispatch;
  }

  async getShipmentsByPackageDispatchIdResp(packageDispatchId: string) {
    //await this.updateFedexDataByPackageDispatchId(packageDispatchId);

    const packageDispatch = await this.packageDispatchRepository.findOne({
      where: { id: packageDispatchId },
      relations: [
        'shipments',
        'shipments.payment',
        'shipments.statusHistory',
        'chargeShipments',
        'drivers',
        'vehicle',
        'subsidiary',
        'routes',
      ],
    });
    
    console.log("🚀 ~ PackageDispatchService ~ getShipmentsByPackageDispatchId ~ packageDispatch:", packageDispatch)

    if (!packageDispatch) {
      throw new Error('Package dispatch not found');
    }

    return packageDispatch;
  }

  async findByDriver(driverId: string): Promise<PackageDispatch[]> {
    const dispatchs = this.packageDispatchRepository
      .createQueryBuilder('dispatch')
      
      .leftJoin('dispatch.drivers', 'driver')
      
      .leftJoinAndSelect('dispatch.routes', 'routes')
      .leftJoinAndSelect('dispatch.vehicle', 'vehicle')
      .leftJoinAndSelect('dispatch.subsidiary', 'subsidiary')

      .leftJoinAndSelect('dispatch.history', 'history')
      .leftJoinAndSelect('history.shipment', 'shipment')
      .leftJoinAndSelect('history.chargeShipment', 'chargeShipment')

      .leftJoinAndSelect('shipment.unloading', 'shipmentUnloading')
      .leftJoinAndSelect('chargeShipment.unloading', 'chargeUnloading')
      .leftJoin(
        'consolidated',
        'shipmentConsolidated',
        'shipmentConsolidated.id = shipment.consolidatedId'
      )
      .leftJoin(
        'consolidated',
        'chargeConsolidated',
        'chargeConsolidated.id = chargeShipment.consolidatedId'
      )

      .where('driver.id = :driverId', { driverId })
      .orderBy('dispatch.createdAt', 'DESC')
      .getMany();

      return dispatchs;
  }

  async findByDriverAndDateRange(
    driverId: string,
    subsidiaryId: string,
    startDate: string,
    endDate: string
  ): Promise<PackageDispatch[]> {

    const startUtc = DateTime
      .fromISO(startDate, { zone: 'America/Hermosillo' })
      .startOf('day')
      .toUTC()
      .toJSDate();

    const endUtc = DateTime
      .fromISO(endDate, { zone: 'America/Hermosillo' })
      .endOf('day')
      .toUTC()
      .toJSDate();

    return this.packageDispatchRepository
      .createQueryBuilder('dispatch')

      .leftJoin('dispatch.drivers', 'driver')

      .leftJoinAndSelect('dispatch.routes', 'routes')
      .leftJoinAndSelect('dispatch.vehicle', 'vehicle')
      .leftJoinAndSelect('dispatch.subsidiary', 'subsidiary')
  
      .leftJoinAndSelect('dispatch.history', 'history')
      .leftJoinAndSelect('history.shipment', 'shipment')
      .leftJoinAndSelect('history.chargeShipment', 'chargeShipment')

      .leftJoinAndSelect('shipment.unloading', 'shipmentUnloading')
      .leftJoinAndSelect('chargeShipment.unloading', 'chargeUnloading')
      .leftJoin(
        'consolidated',
        'shipmentConsolidated',
        'shipmentConsolidated.id = shipment.consolidatedId'
      )
      .leftJoin(
        'consolidated',
        'chargeConsolidated',
        'chargeConsolidated.id = chargeShipment.consolidatedId'
      )

      .where('driver.id = :driverId', { driverId })
      .andWhere('dispatch.createdAt BETWEEN :start AND :end', {
        start: startUtc,
        end: endUtc
      })
      .andWhere('dispatch.subsidiaryId = :subsidiaryId', { subsidiaryId })

      .orderBy('dispatch.createdAt', 'DESC')

      .getMany();
  }

  async findByDateRange(
    subsidiaryId: string,
    startDate: string,
    endDate: string
  ): Promise<PackageDispatch[]> {

    const startUtc = DateTime
      .fromISO(startDate, { zone: 'America/Hermosillo' })
      .startOf('day')
      .toUTC()
      .toJSDate();

    const endUtc = DateTime
      .fromISO(endDate, { zone: 'America/Hermosillo' })
      .endOf('day')
      .toUTC()
      .toJSDate();

    console.log("🚀 ~ PackageDispatchService ~ findByDateRange ~ subsidiaryId:", subsidiaryId)
    
    return this.packageDispatchRepository
      .createQueryBuilder('dispatch')

      .leftJoinAndSelect('dispatch.drivers', 'driver')
      .leftJoinAndSelect('dispatch.routes', 'routes')
      .leftJoinAndSelect('dispatch.vehicle', 'vehicle')
      .leftJoinAndSelect('dispatch.subsidiary', 'subsidiary')
      .leftJoinAndSelect('dispatch.history', 'history')
      .leftJoinAndSelect('history.shipment', 'shipment')
      .leftJoinAndSelect('history.chargeShipment', 'chargeShipment')

      .where('dispatch.createdAt BETWEEN :start AND :end', {
        start: startUtc,
        end: endUtc
      })
      .andWhere('dispatch.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .orderBy('dispatch.createdAt', 'DESC')
      .getMany();
  }

  async findPakageDispatchByDriverAndDate(
    driverId: string,
    startDate: string,
    endDate: string,
    subsidiaryId: string
  ) {
    const dispatches = await this.findByDriverAndDateRange(
      driverId,
      subsidiaryId,
      startDate,
      endDate
    );

    if (!dispatches.length) return [];

    // ========= 🔥 Helpers (los reutilizas igual) =========

    const calcDaysInWarehouse = (createdAt: Date) => {
      const today = new Date();
      const created = new Date(createdAt);
      return Math.floor(
        (today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
      );
    };

    const getDexCode = async (shipmentId: string, status: string) => {
      const rejectedStatuses = [
        'rechazado',
        'no_entregado',
        'direccion_incorrecta',
        'cliente_no_encontrado',
        'cambio_fecha_solicitado'
      ];

      if (!rejectedStatuses.includes(status)) return null;

      const row = await this.shipmentStatusRepository
        .createQueryBuilder('ss')
        .select('ss.exceptionCode', 'exceptionCode')
        .where('ss.shipmentId = :shipmentId', { shipmentId })
        .orderBy('ss.createdAt', 'DESC')
        .limit(1)
        .getRawOne();

      return row?.exceptionCode ?? null;
    };

    // ========= 🔥 MAP =========

    const mapShipment = async (
      shipment: any,
      dispatch: any,
      isCharge: boolean
    ) => {

      const driverName = dispatch?.drivers?.length
        ? dispatch.drivers[0].name
        : null;

      const route = dispatch?.routes?.length
        ? dispatch.routes.map(r => r.name).join(' - ')
        : null;

      const ubication = dispatch ? 'EN RUTA' : 'EN BODEGA';

      const daysInWarehouse = calcDaysInWarehouse(shipment.createdAt);

      const dexCode = await getDexCode(shipment.id, shipment.status);

      // 🔥 detectar unloading correcto
      const unloading = isCharge
        ? shipment.chargeUnloading
        : shipment.shipmentUnloading;

      // 🔥 detectar consolidated correcto
      const consolidated = isCharge
        ? shipment.chargeConsolidated
        : shipment.shipmentConsolidated;

      return {
        shipmentData: {
          id: shipment.id,
          trackingNumber: shipment.trackingNumber,
          shipmentStatus: shipment.status,
          commitDateTime: shipment.commitDateTime,
          ubication,
          warehouse: shipment.subsidiary?.name ?? 'SIN SUCURSAL',

          unloading: unloading
            ? {
                trackingNumber: unloading.trackingNumber,
                date: unloading.date,
              }
            : null,

          // 🔥 YA FUNCIONA
          consolidated: consolidated
            ? {
                id: consolidated.id,
                // agrega lo que ocupes aquí
              }
            : null,

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
              route,

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

    // ========= 🔥 EXTRAER DESDE HISTORY =========

    const results = [];

    for (const dispatch of dispatches) {
      for (const h of dispatch.history || []) {

        if (h.shipment) {
          results.push(await mapShipment(h.shipment, dispatch, false));
        }

        if (h.chargeShipment) {
          results.push(await mapShipment(h.chargeShipment, dispatch, true));
        }
      }
    }

    return results;
  }

  async findPakageDispatchByDateRange(
    startDate: string,
    endDate: string,
    subsidiaryId: string
  ) {
    const dispatches = await this.findByDateRange(
      subsidiaryId,
      startDate,
      endDate
    );

    if (!dispatches.length) return [];

    // ========= 🔥 Helpers (los reutilizas igual) =========

    const calcDaysInWarehouse = (createdAt: Date) => {
      const today = new Date();
      const created = new Date(createdAt);
      return Math.floor(
        (today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
      );
    };

    const getDexCode = async (shipmentId: string, status: string) => {
      const rejectedStatuses = [
        'rechazado',
        'no_entregado',
        'direccion_incorrecta',
        'cliente_no_encontrado',
        'cambio_fecha_solicitado'
      ];

      if (!rejectedStatuses.includes(status)) return null;

      const row = await this.shipmentStatusRepository
        .createQueryBuilder('ss')
        .select('ss.exceptionCode', 'exceptionCode')
        .where('ss.shipmentId = :shipmentId', { shipmentId })
        .orderBy('ss.createdAt', 'DESC')
        .limit(1)
        .getRawOne();

      return row?.exceptionCode ?? null;
    };

    // ========= 🔥 MAP =========

    const mapShipment = async (
      shipment: any,
      dispatch: any,
      isCharge: boolean
    ) => {

      const driverName = dispatch?.drivers?.length
        ? dispatch.drivers[0].name
        : null;

      const route = dispatch?.routes?.length
        ? dispatch.routes.map(r => r.name).join(' - ')
        : null;

      const ubication = dispatch ? 'EN RUTA' : 'EN BODEGA';

      const daysInWarehouse = calcDaysInWarehouse(shipment.createdAt);

      const dexCode = await getDexCode(shipment.id, shipment.status);

      // 🔥 detectar unloading correcto
      const unloading = isCharge
        ? shipment.chargeUnloading
        : shipment.shipmentUnloading;

      // 🔥 detectar consolidated correcto
      const consolidated = isCharge
        ? shipment.chargeConsolidated
        : shipment.shipmentConsolidated;

      return {
        shipmentData: {
          id: shipment.id,
          trackingNumber: shipment.trackingNumber,
          shipmentStatus: shipment.status,
          commitDateTime: shipment.commitDateTime,
          ubication,
          warehouse: shipment.subsidiary?.name ?? 'SIN SUCURSAL',

          unloading: unloading
            ? {
                trackingNumber: unloading.trackingNumber,
                date: unloading.date,
              }
            : null,

          // 🔥 YA FUNCIONA
          consolidated: consolidated
            ? {
                id: consolidated.id,
                // agrega lo que ocupes aquí
              }
            : null,

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
              route,

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

    // ========= 🔥 EXTRAER DESDE HISTORY =========

    const results = [];

    for (const dispatch of dispatches) {
      for (const h of dispatch.history || []) {

        if (h.shipment) {
          results.push(await mapShipment(h.shipment, dispatch, false));
        }

        if (h.chargeShipment) {
          results.push(await mapShipment(h.chargeShipment, dispatch, true));
        }
      }
    }

    return results;
  }

  async generateDriverReportExcelResp1803(
    startDate: string,
    endDate: string,
    subsidiaryId: string
  ): Promise<Buffer> {

    const startUtc = DateTime
      .fromISO(startDate, { zone: 'America/Hermosillo' })
      .startOf('day')
      .toUTC()
      .toJSDate();

    const endUtc = DateTime
      .fromISO(endDate, { zone: 'America/Hermosillo' })
      .endOf('day')
      .toUTC()
      .toJSDate();

    // ========= 🔥 QUERY ÚNICA OPTIMIZADA =========
    const data = await this.packageDispatchRepository
      .createQueryBuilder('dispatch')
      .leftJoin('dispatch.drivers', 'driver') 
      .leftJoin('dispatch.history', 'history')
      .leftJoin('history.shipment', 'shipment')
      .leftJoin('history.chargeShipment', 'chargeShipment')

      .where('dispatch.createdAt BETWEEN :start AND :end', {
        start: startUtc,
        end: endUtc,
      })
      .andWhere('dispatch.subsidiaryId = :subsidiaryId', { subsidiaryId })

      .select('driver.id', 'driverId')
      .addSelect('driver.name', 'driverName')

      // 🔥 1. TOTAL 
      .addSelect(`
        COUNT(
          COALESCE(shipment.id, chargeShipment.id)
        )
      `, 'total')

      // 🔥 2. ENTREGADOS
      .addSelect(`
        SUM(
          CASE 
            WHEN COALESCE(shipment.status, chargeShipment.status) = 'entregado'
            THEN 1 ELSE 0 
          END
        )
      `, 'delivered')

      // 🔥 3. REGRESADOS (DEX)
      .addSelect(`
        SUM(
          CASE 
            WHEN COALESCE(shipment.status, chargeShipment.status) IN (
              'no_entregado',
              'rechazado',
              'direccion_incorrecta',
              'cliente_no_encontrado',
              'cambio_fecha_solicitado'
            )
            THEN 1 ELSE 0 
          END
        )
      `, 'returned')

      // 🔥 4. SIN MOVIMIENTO (Pendientes, En Ruta, En Bodega)
      .addSelect(`
        SUM(
          CASE 
            WHEN COALESCE(shipment.status, chargeShipment.status) IN (
              'en_ruta',
              'en_bodega',
              'pendiente'
            )
            THEN 1 ELSE 0 
          END
        )
      `, 'pending')

      .groupBy('driver.id')
      .addGroupBy('driver.name')
      .getRawMany();

    // ========= 🔥 FORMATEO (Usando decimales para los %) =========
    const formatted = data.map(r => {
      const rawTotal = Number(r.total || 0);
      const rawDelivered = Number(r.delivered || 0);
      const rawReturned = Number(r.returned || 0);
      const rawPending = Number(r.pending || 0);

      return {
        driverName: r.driverName || r.drivername || 'Sin Chofer Asignado', 
        total: rawTotal,
        delivered: rawDelivered,
        returned: rawReturned,
        pending: rawPending,
        // Convertimos a base 1 (0.0 a 1.0) para que Excel aplique su formato nativo %
        pctEff: rawTotal > 0 ? (rawDelivered / rawTotal) : 0,
        pctRet: rawTotal > 0 ? (rawReturned / rawTotal) : 0,
        pctPen: rawTotal > 0 ? (rawPending / rawTotal) : 0,
      };
    });

    // ========= 📄 EXCEL TIPO DASHBOARD =========
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Eficiencia Operativa', {
      views: [{ showGridLines: false }]
    });

    // 1. Configurar anchos de columna (Hasta la H)
    sheet.getColumn('A').width = 32; // Chofer
    sheet.getColumn('B').width = 14; // Total
    sheet.getColumn('C').width = 14; // Entregados
    sheet.getColumn('D').width = 14; // Regresados
    sheet.getColumn('E').width = 16; // Sin Movimiento
    sheet.getColumn('F').width = 16; // % Efectividad
    sheet.getColumn('G').width = 16; // % Devueltos
    sheet.getColumn('H').width = 18; // % Sin Movimiento

    // 2. Título Principal
    sheet.mergeCells('A1:H1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = '📊 REPORTE EJECUTIVO DE EFICIENCIA OPERATIVA';
    titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Slate 900
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 35;

    sheet.mergeCells('A2:H2');
    const subtitleCell = sheet.getCell('A2');
    subtitleCell.value = `Periodo Analizado: ${startDate.split('T')[0]} al ${endDate.split('T')[0]}`;
    subtitleCell.font = { size: 11, italic: true, color: { argb: 'FF475569' } }; // Slate 600
    subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(2).height = 20;

    // 3. Encabezados de Tabla (Fila 4)
    const headerRow = sheet.getRow(4);
    headerRow.values = [
      'Chofer / Repartidor', 
      'Total Asignados', 
      'Entregados', 
      'DEX (Devueltos)', 
      'Sin Movimiento', 
      '% Efectividad', 
      '% Retorno (DEX)', 
      '% Sin Movto.'
    ];
    headerRow.height = 25;
    
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }; // Blue 600
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF1E3A8A' } },
        bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } },
      };
    });

    // 4. Llenado de Datos con Estilos y Reglas
    let currentRow = 5;
    let sumTotal = 0, sumDelivered = 0, sumReturned = 0, sumPending = 0;

    if (formatted.length > 0) {
      formatted.forEach((row, index) => {
        sumTotal += row.total;
        sumDelivered += row.delivered;
        sumReturned += row.returned;
        sumPending += row.pending;

        const dataRow = sheet.getRow(currentRow);
        dataRow.values = [
          row.driverName, 
          row.total, 
          row.delivered, 
          row.returned, 
          row.pending, 
          row.pctEff, 
          row.pctRet, 
          row.pctPen
        ];
        dataRow.height = 20;

        // Zebra Striping
        const bgColor = (index % 2 === 0) ? 'FFFFFFFF' : 'FFF8FAFC'; 

        dataRow.eachCell((cell, colNum) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
          cell.alignment = { vertical: 'middle', horizontal: colNum === 1 ? 'left' : 'center' };
        });

        // Formatos de Números Enteros
        [2, 3, 4, 5].forEach(col => {
          dataRow.getCell(col).numFmt = '#,##0';
        });

        // ======= SEMÁFORO % EFECTIVIDAD (Columna F / 6) =======
        const effCell = dataRow.getCell(6);
        effCell.numFmt = '0.0%'; 
        effCell.font = { bold: true };
        if (row.pctEff >= 0.90) effCell.font = { ...effCell.font, color: { argb: 'FF059669' } }; // Verde
        else if (row.pctEff >= 0.75) effCell.font = { ...effCell.font, color: { argb: 'FFD97706' } }; // Naranja
        else effCell.font = { ...effCell.font, color: { argb: 'FFE11D48' } }; // Rojo

        // ======= SEMÁFORO % RETORNO / DEX (Columna G / 7) =======
        const retCell = dataRow.getCell(7);
        retCell.numFmt = '0.0%';
        retCell.font = { bold: true };
        if (row.pctRet <= 0.05) retCell.font = { ...retCell.font, color: { argb: 'FF059669' } }; // <=5% Verde
        else if (row.pctRet <= 0.15) retCell.font = { ...retCell.font, color: { argb: 'FFD97706' } }; // <=15% Naranja
        else retCell.font = { ...retCell.font, color: { argb: 'FFE11D48' } }; // >15% Rojo

        // ======= ESTILO % SIN MOVIMIENTO (Columna H / 8) =======
        const penCell = dataRow.getCell(8);
        penCell.numFmt = '0.0%';
        penCell.font = { color: { argb: 'FF64748B' } }; // Gris neutro

        currentRow++;
      });

      // 5. Fila de Totales Globales
      const totalsRow = sheet.getRow(currentRow);
      const totalEff = sumTotal > 0 ? (sumDelivered / sumTotal) : 0;
      const totalRet = sumTotal > 0 ? (sumReturned / sumTotal) : 0;
      const totalPen = sumTotal > 0 ? (sumPending / sumTotal) : 0;
      
      totalsRow.values = [
        'TOTALES GLOBALES', 
        sumTotal, 
        sumDelivered, 
        sumReturned, 
        sumPending, 
        totalEff, 
        totalRet, 
        totalPen
      ];
      totalsRow.height = 25;
      
      totalsRow.eachCell((cell, colNum) => {
        cell.font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.alignment = { vertical: 'middle', horizontal: colNum === 1 ? 'right' : 'center' };
        cell.border = {
          top: { style: 'double', color: { argb: 'FF94A3B8' } },
          bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
        };
      });

      [2, 3, 4, 5].forEach(col => { totalsRow.getCell(col).numFmt = '#,##0'; });
      [6, 7, 8].forEach(col => { totalsRow.getCell(col).numFmt = '0.0%'; });
      
      // Semáforos Globales
      const globalEff = totalsRow.getCell(6);
      if (totalEff >= 0.90) globalEff.font = { ...globalEff.font, color: { argb: 'FF059669' } };
      else if (totalEff >= 0.75) globalEff.font = { ...globalEff.font, color: { argb: 'FFD97706' } };
      else globalEff.font = { ...globalEff.font, color: { argb: 'FFE11D48' } };

      const globalRet = totalsRow.getCell(7);
      if (totalRet <= 0.05) globalRet.font = { ...globalRet.font, color: { argb: 'FF059669' } };
      else if (totalRet <= 0.15) globalRet.font = { ...globalRet.font, color: { argb: 'FFD97706' } };
      else globalRet.font = { ...globalRet.font, color: { argb: 'FFE11D48' } };

      // Activar autofiltro para la tabla
      sheet.autoFilter = { from: 'A4', to: 'H4' };

    } else {
      sheet.mergeCells('A5:H5');
      const emptyCell = sheet.getCell('A5');
      emptyCell.value = 'No hay datos operativos registrados en este rango de fechas.';
      emptyCell.font = { italic: true, color: { argb: 'FF94A3B8' } };
      emptyCell.alignment = { vertical: 'middle', horizontal: 'center' };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as unknown as Buffer;
  }

  async generateDriverReportExcelResp2303(
    startDate: string,
    endDate: string,
    subsidiaryId: string
  ): Promise<Buffer> {

    const startUtc = DateTime
      .fromISO(startDate, { zone: 'America/Hermosillo' })
      .startOf('day')
      .toUTC()
      .toJSDate();

    const endUtc = DateTime
      .fromISO(endDate, { zone: 'America/Hermosillo' })
      .endOf('day')
      .toUTC()
      .toJSDate();

    // =========================================================================
    // 🔥 QUERY 1: RESUMEN EJECUTIVO (DASHBOARD)
    // =========================================================================
    const summaryQuery = this.packageDispatchRepository
      .createQueryBuilder('dispatch')
      .leftJoin('dispatch.drivers', 'driver') 
      .leftJoin('dispatch.history', 'history')
      .leftJoin('history.shipment', 'shipment')
      .leftJoin('history.chargeShipment', 'chargeShipment')
      .where('dispatch.createdAt BETWEEN :start AND :end', { start: startUtc, end: endUtc })
      .andWhere('dispatch.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .select('driver.id', 'driverId')
      .addSelect('driver.name', 'driverName')
      
      // Totales
      .addSelect(`COUNT(COALESCE(shipment.id, chargeShipment.id))`, 'total')
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) = 'entregado' THEN 1 ELSE 0 END)`, 'delivered')
      
      // DEX Total (Cualquier motivo de no entrega)
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) IN ('no_entregado', 'rechazado', 'direccion_incorrecta', 'cliente_no_encontrado', 'cliente_no_disponible', 'cambio_fecha_solicitado') THEN 1 ELSE 0 END)`, 'returned')
      
      // 🔥 CONTEO DE DEX ESPECÍFICOS BASADO EN EL ESTATUS
      // DEX03 = Dirección Incorrecta
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) = 'direccion_incorrecta' THEN 1 ELSE 0 END)`, 'dex03')
      // DEX07 = Rechazado
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) = 'rechazado' THEN 1 ELSE 0 END)`, 'dex07')
      // DEX08 = Cliente no disponible / no encontrado
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) IN ('cliente_no_disponible', 'cliente_no_encontrado') THEN 1 ELSE 0 END)`, 'dex08')
      
      // Sin Movimiento (En Bodega, En Ruta, Pendiente)
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) IN ('en_ruta', 'en_bodega', 'pendiente') THEN 1 ELSE 0 END)`, 'pending')
      
      .groupBy('driver.id')
      .addGroupBy('driver.name');

    // =========================================================================
    // 🔥 QUERY 2: DETALLE DE PAQUETES (HOJA 2)
    // =========================================================================
    const detailsQuery = this.packageDispatchRepository
      .createQueryBuilder('dispatch')
      .leftJoin('dispatch.drivers', 'driver')
      .leftJoin('dispatch.routes', 'route') 
      .leftJoin('dispatch.subsidiary', 'subsidiary')
      .leftJoin('dispatch.history', 'history')
      .leftJoin('history.shipment', 'shipment')
      .leftJoin('history.chargeShipment', 'chargeShipment')
      .where('dispatch.createdAt BETWEEN :start AND :end', { start: startUtc, end: endUtc })
      .andWhere('dispatch.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('COALESCE(shipment.id, chargeShipment.id) IS NOT NULL')
      .select([
        'driver.name AS driverName',
        'route.name AS routeName',
        'subsidiary.name AS subsidiaryName',
        'COALESCE(shipment.trackingNumber, chargeShipment.trackingNumber) AS tracking',
        'COALESCE(shipment.status, chargeShipment.status) AS status',
        
        // 🔥 MAPEO AUTOMÁTICO DE CÓDIGO DEX EN LA HOJA DE DETALLES
        `CASE 
          WHEN COALESCE(shipment.status, chargeShipment.status) = 'direccion_incorrecta' THEN 'DEX03'
          WHEN COALESCE(shipment.status, chargeShipment.status) = 'rechazado' THEN 'DEX07'
          WHEN COALESCE(shipment.status, chargeShipment.status) IN ('cliente_no_disponible', 'cliente_no_encontrado') THEN 'DEX08'
          WHEN COALESCE(shipment.status, chargeShipment.status) IN ('no_entregado', 'cambio_fecha_solicitado') THEN 'OTRO DEX'
          ELSE '-' 
        END AS exceptionCode`,
        
        'COALESCE(shipment.commitDateTime, chargeShipment.commitDateTime) AS commitDate',
        'COALESCE(shipment.recipientZip, chargeShipment.recipientZip) AS cp',
        'COALESCE(shipment.recipientName, chargeShipment.recipientName) AS recipient'
      ])
      .orderBy('driver.name', 'ASC')
      .addOrderBy('route.name', 'ASC')
      .addOrderBy('subsidiary.name', 'ASC');

    // Ejecutamos ambas consultas simultáneamente
    const [summaryData, detailsData] = await Promise.all([
      summaryQuery.getRawMany(),
      detailsQuery.getRawMany()
    ]);

    // =========================================================================
    // 📄 CREACIÓN DEL WORKBOOK EXCEL
    // =========================================================================
    const workbook = new ExcelJS.Workbook();

    // -------------------------------------------------------------------------
    // HOJA 1: DASHBOARD EJECUTIVO
    // -------------------------------------------------------------------------
    const sheet1 = workbook.addWorksheet('Eficiencia Operativa', { views: [{ showGridLines: false }] });

    sheet1.columns = [
      { header: 'Chofer / Repartidor', key: 'driverName', width: 32 },
      { header: 'Total Asignados', key: 'total', width: 15 },
      { header: 'Entregados', key: 'delivered', width: 14 },
      { header: 'DEX Total', key: 'returned', width: 12 },
      { header: 'DEX 03 (Dir. Mal)', key: 'dex03', width: 15 },
      { header: 'DEX 07 (Rechazo)', key: 'dex07', width: 16 },
      { header: 'DEX 08 (No Disp.)', key: 'dex08', width: 16 },
      { header: 'Sin Movimiento', key: 'pending', width: 15 },
      { header: '% Efectividad', key: 'pctEff', width: 14 },
      { header: '% Retorno', key: 'pctRet', width: 12 },
    ];

    sheet1.mergeCells('A1:J1');
    const titleCell = sheet1.getCell('A1');
    titleCell.value = '📊 REPORTE EJECUTIVO DE EFICIENCIA OPERATIVA';
    titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet1.getRow(1).height = 35;

    sheet1.mergeCells('A2:J2');
    sheet1.getCell('A2').value = `Periodo Analizado: ${startDate.split('T')[0]} al ${endDate.split('T')[0]}`;
    sheet1.getCell('A2').font = { size: 11, italic: true, color: { argb: 'FF475569' } };
    sheet1.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };
    sheet1.getRow(2).height = 20;

    const headerRow1 = sheet1.getRow(4);
    headerRow1.height = 25;
    headerRow1.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { top: { style: 'medium', color: { argb: 'FF1E3A8A' } }, bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } } };
    });

    let row1Idx = 5;
    let sTotal = 0, sDel = 0, sRet = 0, sD03 = 0, sD07 = 0, sD08 = 0, sPen = 0;

    summaryData.forEach((r, index) => {
      const rawTotal = Number(r.total || 0);
      const rawDel = Number(r.delivered || 0);
      const rawRet = Number(r.returned || 0);
      const rawD03 = Number(r.dex03 || 0);
      const rawD07 = Number(r.dex07 || 0);
      const rawD08 = Number(r.dex08 || 0);
      const rawPen = Number(r.pending || 0);

      sTotal += rawTotal; sDel += rawDel; sRet += rawRet; sD03 += rawD03; sD07 += rawD07; sD08 += rawD08; sPen += rawPen;

      const pctEff = rawTotal > 0 ? (rawDel / rawTotal) : 0;
      const pctRet = rawTotal > 0 ? (rawRet / rawTotal) : 0;

      const row = sheet1.getRow(row1Idx);
      row.values = [
        r.driverName || r.drivername || 'Sin Chofer', rawTotal, rawDel, rawRet, 
        rawD03, rawD07, rawD08, rawPen,
        pctEff, 
        pctRet
      ];
      row.height = 20;

      const bgColor = (index % 2 === 0) ? 'FFFFFFFF' : 'FFF8FAFC';
      row.eachCell((cell, colNum) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
        cell.alignment = { vertical: 'middle', horizontal: colNum === 1 ? 'left' : 'center' };
      });

      [2,3,4,5,6,7,8].forEach(col => row.getCell(col).numFmt = '#,##0');
      
      const effCell = row.getCell(9);
      effCell.numFmt = '0.0%'; effCell.font = { bold: true };
      if (pctEff >= 0.90) effCell.font.color = { argb: 'FF059669' };
      else if (pctEff >= 0.75) effCell.font.color = { argb: 'FFD97706' };
      else effCell.font.color = { argb: 'FFE11D48' };

      const retCell = row.getCell(10);
      retCell.numFmt = '0.0%'; retCell.font = { bold: true };
      if (pctRet <= 0.05) retCell.font.color = { argb: 'FF059669' };
      else if (pctRet <= 0.15) retCell.font.color = { argb: 'FFD97706' };
      else retCell.font.color = { argb: 'FFE11D48' };

      row1Idx++;
    });

    if (summaryData.length > 0) {
      const totalsRow = sheet1.getRow(row1Idx);
      const globalEff = sTotal > 0 ? (sDel/sTotal) : 0;
      const globalRet = sTotal > 0 ? (sRet/sTotal) : 0;

      totalsRow.values = [ 'TOTALES GLOBALES', sTotal, sDel, sRet, sD03, sD07, sD08, sPen, globalEff, globalRet ];
      totalsRow.height = 25;
      totalsRow.eachCell((cell, colNum) => {
        cell.font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.alignment = { vertical: 'middle', horizontal: colNum === 1 ? 'right' : 'center' };
        cell.border = { top: { style: 'double', color: { argb: 'FF94A3B8' } }, bottom: { style: 'medium', color: { argb: 'FF94A3B8' } } };
      });
      [2,3,4,5,6,7,8].forEach(col => totalsRow.getCell(col).numFmt = '#,##0');
      
      const totalEffCell = totalsRow.getCell(9);
      totalEffCell.numFmt = '0.0%';
      if (globalEff >= 0.90) totalEffCell.font.color = { argb: 'FF059669' };
      else if (globalEff >= 0.75) totalEffCell.font.color = { argb: 'FFD97706' };
      else totalEffCell.font.color = { argb: 'FFE11D48' };

      const totalRetCell = totalsRow.getCell(10);
      totalRetCell.numFmt = '0.0%';
      if (globalRet <= 0.05) totalRetCell.font.color = { argb: 'FF059669' };
      else if (globalRet <= 0.15) totalRetCell.font.color = { argb: 'FFD97706' };
      else totalRetCell.font.color = { argb: 'FFE11D48' };

      sheet1.autoFilter = { from: 'A4', to: 'J4' };
    }

    // -------------------------------------------------------------------------
    // HOJA 2: DETALLE DE PAQUETES
    // -------------------------------------------------------------------------
    const sheet2 = workbook.addWorksheet('Detalle de Paquetes', { views: [{ showGridLines: false }] });

    sheet2.columns = [
      { header: 'Chofer', key: 'driver', width: 25 },
      { header: 'Ruta', key: 'route', width: 20 },
      { header: 'Sucursal', key: 'subsidiary', width: 20 },
      { header: 'Tracking', key: 'tracking', width: 22 },
      { header: 'Estatus', key: 'status', width: 24 },
      { header: 'Cód. DEX', key: 'dex', width: 12 },
      { header: 'Fecha Commit', key: 'commit', width: 18 },
      { header: 'C.P.', key: 'cp', width: 10 },
      { header: 'Destinatario', key: 'recipient', width: 35 },
    ];

    const headerRow2 = sheet2.getRow(1);
    headerRow2.height = 25;
    headerRow2.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } }; 
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF0F172A' } } };
    });

    detailsData.forEach((row, index) => {
      const dataRow = sheet2.addRow({
        driver: row.driverName || row.drivername || 'Sin Asignar',
        route: row.routeName || row.routename || 'N/A',
        subsidiary: row.subsidiaryName || row.subsidiaryname || 'N/A',
        tracking: row.tracking,
        status: (row.status || 'Desconocido').toUpperCase().replace(/_/g, ' '),
        // Aquí leemos el exceptionCode que se generó en la consulta de Detalle con el CASE WHEN
        dex: row.exceptionCode || row.exceptioncode || '-',
        commit: row.commitDate ? new Date(row.commitDate).toLocaleDateString('es-MX') : 'Sin Fecha',
        cp: row.cp || 'S/C',
        recipient: row.recipient || 'Sin Nombre'
      });

      const bgColor = (index % 2 === 0) ? 'FFFFFFFF' : 'FFF8FAFC';
      dataRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
        cell.alignment = { vertical: 'middle' };
      });

      // Centrar columnas clave
      [4, 5, 6, 7, 8].forEach(col => { dataRow.getCell(col).alignment = { vertical: 'middle', horizontal: 'center' }; });
      
      // Pintar la etiqueta del código DEX en la Hoja 2 para que llame la atención
      const dexCell = dataRow.getCell(6);
      if (dexCell.value !== '-') {
        dexCell.font = { bold: true, color: { argb: 'FFE11D48' } }; // Rojo si es DEX
      }
    });

    if(detailsData.length > 0) {
        sheet2.autoFilter = { from: 'A1', to: 'I1' }; 
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as unknown as Buffer;
  }

  async generateDriverReportExcelResp2303v02(
    startDate: string,
    endDate: string,
    subsidiaryId: string
  ): Promise<Buffer> {

    const startUtc = DateTime
      .fromISO(startDate, { zone: 'America/Hermosillo' })
      .startOf('day')
      .toUTC()
      .toJSDate();

    const endUtc = DateTime
      .fromISO(endDate, { zone: 'America/Hermosillo' })
      .endOf('day')
      .toUTC()
      .toJSDate();

    // =========================================================================
    // 🔥 QUERY 1: RESUMEN EJECUTIVO (DASHBOARD)
    // =========================================================================
    const summaryQuery = this.packageDispatchRepository
      .createQueryBuilder('dispatch')
      .leftJoin('dispatch.drivers', 'driver') 
      .leftJoin('dispatch.history', 'history')
      .leftJoin('history.shipment', 'shipment')
      .leftJoin('history.chargeShipment', 'chargeShipment')
      .where('dispatch.createdAt BETWEEN :start AND :end', { start: startUtc, end: endUtc })
      .andWhere('dispatch.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .select('driver.id', 'driverId')
      .addSelect('driver.name', 'driverName')
      
      // Totales
      .addSelect(`COUNT(COALESCE(shipment.id, chargeShipment.id))`, 'total')
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) = 'entregado' THEN 1 ELSE 0 END)`, 'delivered')
      
      // DEX Total (Cualquier motivo de no entrega, incluyendo cambios de fecha y devoluciones a fedex)
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) IN (
        'no_entregado', 
        'rechazado', 
        'direccion_incorrecta', 
        'cliente_no_encontrado', 
        'cliente_no_disponible', 
        'cambio_fecha_solicitado') THEN 1 ELSE 0 END)`, 'returned')
      
      // Conteo de DEX Específicos
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) = 'direccion_incorrecta' THEN 1 ELSE 0 END)`, 'dex03')
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) = 'rechazado' THEN 1 ELSE 0 END)`, 'dex07')
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) IN ('cliente_no_disponible', 'cliente_no_encontrado') THEN 1 ELSE 0 END)`, 'dex08')
      
      // Casos Especiales para el Cuadre
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) = 'cambio_fecha_solicitado' THEN 1 ELSE 0 END)`, 'fechaRequested')
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) = 'devuelto_a_fedex' THEN 1 ELSE 0 END)`, 'returnedFedex')
      
      // Sin Movimiento (En Bodega, En Ruta, Pendiente)
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) IN ('en_ruta', 'en_bodega', 'pendiente') THEN 1 ELSE 0 END)`, 'pending')
      
      // 🔥 EL ATRAPA FUGAS: Estatus no mapeados arriba
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) NOT IN (
        'entregado', 'no_entregado', 'rechazado', 'direccion_incorrecta', 'cliente_no_encontrado', 
        'cliente_no_disponible', 'cambio_fecha_solicitado', 'devuelto_a_fedex', 
        'en_ruta', 'en_bodega', 'pendiente'
      ) THEN 1 ELSE 0 END)`, 'unmapped')

      .groupBy('driver.id')
      .addGroupBy('driver.name');

    // =========================================================================
    // 🔥 QUERY 2: DETALLE DE PAQUETES (HOJA 2)
    // =========================================================================
    const detailsQuery = this.packageDispatchRepository
      .createQueryBuilder('dispatch')
      .leftJoin('dispatch.drivers', 'driver')
      .leftJoin('dispatch.routes', 'route') 
      .leftJoin('dispatch.subsidiary', 'subsidiary')
      .leftJoin('dispatch.history', 'history')
      .leftJoin('history.shipment', 'shipment')
      .leftJoin('history.chargeShipment', 'chargeShipment')
      .where('dispatch.createdAt BETWEEN :start AND :end', { start: startUtc, end: endUtc })
      .andWhere('dispatch.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('COALESCE(shipment.id, chargeShipment.id) IS NOT NULL')
      .select([
        'driver.name AS driverName',
        'route.name AS routeName',
        'subsidiary.name AS subsidiaryName',
        'COALESCE(shipment.trackingNumber, chargeShipment.trackingNumber) AS tracking',
        'COALESCE(shipment.status, chargeShipment.status) AS status',
        
        // Mapeo Automático de Código DEX
        `CASE 
          WHEN COALESCE(shipment.status, chargeShipment.status) = 'direccion_incorrecta' THEN 'DEX03'
          WHEN COALESCE(shipment.status, chargeShipment.status) = 'rechazado' THEN 'DEX07'
          WHEN COALESCE(shipment.status, chargeShipment.status) IN ('cliente_no_disponible', 'cliente_no_encontrado') THEN 'DEX08'
          WHEN COALESCE(shipment.status, chargeShipment.status) = 'cambio_fecha_solicitado' THEN 'FECHA REQ'
          WHEN COALESCE(shipment.status, chargeShipment.status) = 'devuelto_a_fedex' THEN 'DEV FDX'
          WHEN COALESCE(shipment.status, chargeShipment.status) = 'no_entregado' THEN 'OTRO DEX'
          ELSE '-' 
        END AS exceptionCode`,
        
        'COALESCE(shipment.commitDateTime, chargeShipment.commitDateTime) AS commitDate',
        'COALESCE(shipment.recipientZip, chargeShipment.recipientZip) AS cp',
        'COALESCE(shipment.recipientName, chargeShipment.recipientName) AS recipient'
      ])
      .orderBy('driver.name', 'ASC')
      .addOrderBy('route.name', 'ASC')
      .addOrderBy('subsidiary.name', 'ASC');

    // Ejecutamos ambas consultas simultáneamente
    const [summaryData, detailsData] = await Promise.all([
      summaryQuery.getRawMany(),
      detailsQuery.getRawMany()
    ]);

    // =========================================================================
    // 📄 CREACIÓN DEL WORKBOOK EXCEL
    // =========================================================================
    const workbook = new ExcelJS.Workbook();

    // -------------------------------------------------------------------------
    // HOJA 1: DASHBOARD EJECUTIVO
    // -------------------------------------------------------------------------
    const sheet1 = workbook.addWorksheet('Eficiencia Operativa', { views: [{ showGridLines: false }] });

    // 1. Definimos solo los 'keys' y 'widths' (sin la propiedad 'header')
    sheet1.columns = [
      { key: 'driverName', width: 32 },
      { key: 'total', width: 15 },
      { key: 'delivered', width: 14 },
      { key: 'returned', width: 12 },
      { key: 'dex03', width: 15 },
      { key: 'dex07', width: 16 },
      { key: 'dex08', width: 16 },
      { key: 'pending', width: 15 },
      { key: 'fechaReq', width: 15 },
      { key: 'retFdx', width: 15 },
      { key: 'unmapped', width: 15 },
      { key: 'pctEff', width: 14 },
      { key: 'pctRet', width: 12 },
    ];

    // 2. Título (Fila 1)
    sheet1.mergeCells('A1:M1');
    const titleCell = sheet1.getCell('A1');
    titleCell.value = '📊 REPORTE EJECUTIVO DE EFICIENCIA OPERATIVA';
    titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet1.getRow(1).height = 35;

    // 3. Subtítulo (Fila 2)
    sheet1.mergeCells('A2:M2');
    sheet1.getCell('A2').value = `Periodo Analizado: ${startDate.split('T')[0]} al ${endDate.split('T')[0]}`;
    sheet1.getCell('A2').font = { size: 11, italic: true, color: { argb: 'FF475569' } };
    sheet1.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };
    sheet1.getRow(2).height = 20;

    // 4. 🔥 AHORA SÍ: Escribimos los encabezados explícitamente en la Fila 4
    const headerRow1 = sheet1.getRow(4);
    headerRow1.values = [
      'Chofer / Repartidor', 'Total Asignados', 'Entregados', 'DEX Total', 
      'DEX 03 (Dir. Mal)', 'DEX 07 (Rechazo)', 'DEX 08 (No Disp.)', 
      'Sin Movimiento', 'Cambio Fecha', 'Dev. FedEx', 'Otros (Fugas)', 
      '% Efectividad', '% Retorno'
    ];
    
    headerRow1.height = 25;
    headerRow1.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { top: { style: 'medium', color: { argb: 'FF1E3A8A' } }, bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } } };
    });

    let row1Idx = 5;
    let sTotal = 0, sDel = 0, sRet = 0, sD03 = 0, sD07 = 0, sD08 = 0, sPen = 0;
    let sFechaReq = 0, sRetFdx = 0, sUnmapped = 0;

    summaryData.forEach((r, index) => {
      const rawTotal = Number(r.total || 0);
      const rawDel = Number(r.delivered || 0);
      const rawRet = Number(r.returned || 0);
      const rawD03 = Number(r.dex03 || 0);
      const rawD07 = Number(r.dex07 || 0);
      const rawD08 = Number(r.dex08 || 0);
      const rawPen = Number(r.pending || 0);
      const rawFechaReq = Number(r.fecharequested || r.fechaRequested || 0);
      const rawRetFdx = Number(r.returnedfedex || r.returnedFedex || 0);
      const rawUnmapped = Number(r.unmapped || 0);

      sTotal += rawTotal; sDel += rawDel; sRet += rawRet; sD03 += rawD03; sD07 += rawD07; sD08 += rawD08; sPen += rawPen;
      sFechaReq += rawFechaReq; sRetFdx += rawRetFdx; sUnmapped += rawUnmapped;

      const pctEff = rawTotal > 0 ? (rawDel / rawTotal) : 0;
      const pctRet = rawTotal > 0 ? (rawRet / rawTotal) : 0;

      const row = sheet1.getRow(row1Idx);
      row.values = [
        r.driverName || r.drivername || 'Sin Chofer', rawTotal, rawDel, rawRet, 
        rawD03, rawD07, rawD08, rawPen, rawFechaReq, rawRetFdx, rawUnmapped,
        pctEff, pctRet
      ];
      row.height = 20;

      const bgColor = (index % 2 === 0) ? 'FFFFFFFF' : 'FFF8FAFC';
      row.eachCell((cell, colNum) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
        cell.alignment = { vertical: 'middle', horizontal: colNum === 1 ? 'left' : 'center' };
      });

      // Formato de números para las columnas B hasta K
      [2,3,4,5,6,7,8,9,10,11].forEach(col => row.getCell(col).numFmt = '#,##0');
      
      // Columna 12: % Efectividad
      const effCell = row.getCell(12);
      effCell.numFmt = '0.0%'; effCell.font = { bold: true };
      if (pctEff >= 0.90) effCell.font.color = { argb: 'FF059669' };
      else if (pctEff >= 0.75) effCell.font.color = { argb: 'FFD97706' };
      else effCell.font.color = { argb: 'FFE11D48' };

      // Columna 13: % Retorno
      const retCell = row.getCell(13);
      retCell.numFmt = '0.0%'; retCell.font = { bold: true };
      if (pctRet <= 0.05) retCell.font.color = { argb: 'FF059669' };
      else if (pctRet <= 0.15) retCell.font.color = { argb: 'FFD97706' };
      else retCell.font.color = { argb: 'FFE11D48' };

      row1Idx++;
    });

    if (summaryData.length > 0) {
      const totalsRow = sheet1.getRow(row1Idx);
      const globalEff = sTotal > 0 ? (sDel/sTotal) : 0;
      const globalRet = sTotal > 0 ? (sRet/sTotal) : 0;

      totalsRow.values = [ 'TOTALES GLOBALES', sTotal, sDel, sRet, sD03, sD07, sD08, sPen, sFechaReq, sRetFdx, sUnmapped, globalEff, globalRet ];
      totalsRow.height = 25;
      totalsRow.eachCell((cell, colNum) => {
        cell.font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.alignment = { vertical: 'middle', horizontal: colNum === 1 ? 'right' : 'center' };
        cell.border = { top: { style: 'double', color: { argb: 'FF94A3B8' } }, bottom: { style: 'medium', color: { argb: 'FF94A3B8' } } };
      });
      
      [2,3,4,5,6,7,8,9,10,11].forEach(col => totalsRow.getCell(col).numFmt = '#,##0');
      
      const totalEffCell = totalsRow.getCell(12);
      totalEffCell.numFmt = '0.0%';
      if (globalEff >= 0.90) totalEffCell.font.color = { argb: 'FF059669' };
      else if (globalEff >= 0.75) totalEffCell.font.color = { argb: 'FFD97706' };
      else totalEffCell.font.color = { argb: 'FFE11D48' };

      const totalRetCell = totalsRow.getCell(13);
      totalRetCell.numFmt = '0.0%';
      if (globalRet <= 0.05) totalRetCell.font.color = { argb: 'FF059669' };
      else if (globalRet <= 0.15) totalRetCell.font.color = { argb: 'FFD97706' };
      else totalRetCell.font.color = { argb: 'FFE11D48' };

      sheet1.autoFilter = { from: 'A4', to: 'M4' };
    }

    // -------------------------------------------------------------------------
    // HOJA 2: DETALLE DE PAQUETES
    // -------------------------------------------------------------------------
    const sheet2 = workbook.addWorksheet('Detalle de Paquetes', { views: [{ showGridLines: false }] });

    sheet2.columns = [
      { header: 'Chofer', key: 'driver', width: 25 },
      { header: 'Ruta', key: 'route', width: 20 },
      { header: 'Sucursal', key: 'subsidiary', width: 20 },
      { header: 'Tracking', key: 'tracking', width: 22 },
      { header: 'Estatus', key: 'status', width: 24 },
      { header: 'Cód. DEX', key: 'dex', width: 14 },
      { header: 'Fecha Commit', key: 'commit', width: 18 },
      { header: 'C.P.', key: 'cp', width: 10 },
      { header: 'Destinatario', key: 'recipient', width: 35 },
    ];

    const headerRow2 = sheet2.getRow(1);
    headerRow2.height = 25;
    headerRow2.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } }; 
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF0F172A' } } };
    });

    detailsData.forEach((row, index) => {
      const dataRow = sheet2.addRow({
        driver: row.driverName || row.drivername || 'Sin Asignar',
        route: row.routeName || row.routename || 'N/A',
        subsidiary: row.subsidiaryName || row.subsidiaryname || 'N/A',
        tracking: row.tracking,
        status: (row.status || 'Desconocido').toUpperCase().replace(/_/g, ' '),
        dex: row.exceptionCode || row.exceptioncode || '-',
        commit: row.commitDate ? new Date(row.commitDate).toLocaleDateString('es-MX') : 'Sin Fecha',
        cp: row.cp || 'S/C',
        recipient: row.recipient || 'Sin Nombre'
      });

      const bgColor = (index % 2 === 0) ? 'FFFFFFFF' : 'FFF8FAFC';
      dataRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
        cell.alignment = { vertical: 'middle' };
      });

      [4, 5, 6, 7, 8].forEach(col => { dataRow.getCell(col).alignment = { vertical: 'middle', horizontal: 'center' }; });
      
      const dexCell = dataRow.getCell(6);
      if (dexCell.value !== '-') {
        dexCell.font = { bold: true, color: { argb: 'FFE11D48' } }; 
      }
    });

    if(detailsData.length > 0) {
        sheet2.autoFilter = { from: 'A1', to: 'I1' }; 
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as unknown as Buffer;
  }

  async generateDriverReportExcel(
    startDate: string,
    endDate: string,
    subsidiaryId: string
  ): Promise<Buffer> {

    const startUtc = DateTime
      .fromISO(startDate, { zone: 'America/Hermosillo' })
      .startOf('day')
      .toUTC()
      .toJSDate();

    const endUtc = DateTime
      .fromISO(endDate, { zone: 'America/Hermosillo' })
      .endOf('day')
      .toUTC()
      .toJSDate();

    // =========================================================================
    // 🚨 CONFIGURACIÓN DEL SUBQUERY (VIAJE EN EL TIEMPO PARA DEX REAL)
    // Nota: Ajusta los nombres de las columnas en comillas si tu BD usa 
    // snake_case (ej. 'shipment_id' en vez de '"shipmentId"').
    // =========================================================================
    const TBL_SHIPMENT_STATUS = 'shipment_status';
    
    // 🔥 CORRECCIÓN PARA MYSQL: Usar backticks (`) en lugar de comillas dobles (")
    const COL_SHIPMENT_ID = '`shipmentId`'; 
    const COL_CREATED_AT = '`createdAt`';   

    const effectiveStatusSql = `
      CASE 
        WHEN COALESCE(shipment.status, chargeShipment.status) IN ('devuelto_a_fedex', 'retorno_abandono_fedex') THEN 
          COALESCE(
            (
              SELECT ss.status 
              FROM ${TBL_SHIPMENT_STATUS} ss 
              WHERE ss.${COL_SHIPMENT_ID} = COALESCE(shipment.id, chargeShipment.id) 
                AND ss.status IN ('direccion_incorrecta', 'rechazado', 'cliente_no_disponible', 'cliente_no_encontrado')
              ORDER BY ss.${COL_CREATED_AT} DESC 
              LIMIT 1
            ), 
            COALESCE(shipment.status, chargeShipment.status)
          )
        ELSE COALESCE(shipment.status, chargeShipment.status)
      END
    `;

    // =========================================================================
    // 🔥 QUERY 1: RESUMEN EJECUTIVO (DASHBOARD)
    // =========================================================================
    const summaryQuery = this.packageDispatchRepository
      .createQueryBuilder('dispatch')
      .leftJoin('dispatch.drivers', 'driver') 
      .leftJoin('dispatch.history', 'history')
      .leftJoin('history.shipment', 'shipment')
      .leftJoin('history.chargeShipment', 'chargeShipment')
      .where('dispatch.createdAt BETWEEN :start AND :end', { start: startUtc, end: endUtc })
      .andWhere('dispatch.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .select('driver.id', 'driverId')
      .addSelect('driver.name', 'driverName')
      
      // Totales
      .addSelect(`COUNT(COALESCE(shipment.id, chargeShipment.id))`, 'total')
      .addSelect(`SUM(CASE WHEN ${effectiveStatusSql} = 'entregado' THEN 1 ELSE 0 END)`, 'delivered')
      
      // DEX Total
      .addSelect(`SUM(CASE WHEN ${effectiveStatusSql} IN ('no_entregado', 'rechazado', 'direccion_incorrecta', 'cliente_no_encontrado', 'cliente_no_disponible', 'cambio_fecha_solicitado', 'devuelto_a_fedex', 'retorno_abandono_fedex') THEN 1 ELSE 0 END)`, 'returned')
      
      // 🔥 Conteo Específico de DEX (Ahora tomará el DEX real gracias al effectiveStatusSql)
      .addSelect(`SUM(CASE WHEN ${effectiveStatusSql} = 'direccion_incorrecta' THEN 1 ELSE 0 END)`, 'dex03')
      .addSelect(`SUM(CASE WHEN ${effectiveStatusSql} = 'rechazado' THEN 1 ELSE 0 END)`, 'dex07')
      .addSelect(`SUM(CASE WHEN ${effectiveStatusSql} IN ('cliente_no_disponible', 'cliente_no_encontrado') THEN 1 ELSE 0 END)`, 'dex08')
      
      // Casos Especiales para el Cuadre
      .addSelect(`SUM(CASE WHEN ${effectiveStatusSql} = 'cambio_fecha_solicitado' THEN 1 ELSE 0 END)`, 'fechaRequested')
      
      // FÍSICAMENTE Devueltos (Mantenemos esta métrica original para que sepas cuántos terminaron en FedEx)
      .addSelect(`SUM(CASE WHEN COALESCE(shipment.status, chargeShipment.status) IN ('devuelto_a_fedex', 'retorno_abandono_fedex') THEN 1 ELSE 0 END)`, 'returnedFedex')
      
      // Sin Movimiento
      .addSelect(`SUM(CASE WHEN ${effectiveStatusSql} IN ('en_ruta', 'en_bodega', 'pendiente') THEN 1 ELSE 0 END)`, 'pending')
      
      // El atrapa fugas
      .addSelect(`SUM(CASE WHEN ${effectiveStatusSql} NOT IN (
        'entregado', 'no_entregado', 'rechazado', 'direccion_incorrecta', 'cliente_no_encontrado', 
        'cliente_no_disponible', 'cambio_fecha_solicitado', 'devuelto_a_fedex', 'retorno_abandono_fedex',
        'en_ruta', 'en_bodega', 'pendiente'
      ) THEN 1 ELSE 0 END)`, 'unmapped')

      .groupBy('driver.id')
      .addGroupBy('driver.name');

    // =========================================================================
    // 🔥 QUERY 2: DETALLE DE PAQUETES (HOJA 2)
    // =========================================================================
    const detailsQuery = this.packageDispatchRepository
      .createQueryBuilder('dispatch')
      .leftJoin('dispatch.drivers', 'driver')
      .leftJoin('dispatch.routes', 'route') 
      .leftJoin('dispatch.subsidiary', 'subsidiary')
      .leftJoin('dispatch.history', 'history')
      .leftJoin('history.shipment', 'shipment')
      .leftJoin('history.chargeShipment', 'chargeShipment')
      .where('dispatch.createdAt BETWEEN :start AND :end', { start: startUtc, end: endUtc })
      .andWhere('dispatch.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('COALESCE(shipment.id, chargeShipment.id) IS NOT NULL')
      .select([
        'driver.name AS driverName',
        'route.name AS routeName',
        'subsidiary.name AS subsidiaryName',
        'COALESCE(shipment.trackingNumber, chargeShipment.trackingNumber) AS tracking',
        
        // Estatus normal y Estatus "Real"
        'COALESCE(shipment.status, chargeShipment.status) AS status',
        `(${effectiveStatusSql}) AS realstatus`, 
        
        // Mapeo Automático de Código DEX usando el REAL STATUS
        `CASE 
          WHEN (${effectiveStatusSql}) = 'direccion_incorrecta' THEN 'DEX03'
          WHEN (${effectiveStatusSql}) = 'rechazado' THEN 'DEX07'
          WHEN (${effectiveStatusSql}) IN ('cliente_no_disponible', 'cliente_no_encontrado') THEN 'DEX08'
          WHEN (${effectiveStatusSql}) = 'cambio_fecha_solicitado' THEN 'FECHA REQ'
          WHEN (${effectiveStatusSql}) IN ('devuelto_a_fedex', 'retorno_abandono_fedex') THEN 'DEV/ABANDONO'
          WHEN (${effectiveStatusSql}) = 'no_entregado' THEN 'OTRO DEX'
          ELSE '-' 
        END AS exceptionCode`,
        
        'COALESCE(shipment.commitDateTime, chargeShipment.commitDateTime) AS commitDate',
        'COALESCE(shipment.recipientZip, chargeShipment.recipientZip) AS cp',
        'COALESCE(shipment.recipientName, chargeShipment.recipientName) AS recipient'
      ])
      .orderBy('driver.name', 'ASC')
      .addOrderBy('route.name', 'ASC')
      .addOrderBy('subsidiary.name', 'ASC');

    const [summaryData, detailsData] = await Promise.all([
      summaryQuery.getRawMany(),
      detailsQuery.getRawMany()
    ]);

    // =========================================================================
    // 📄 CREACIÓN DEL WORKBOOK EXCEL
    // =========================================================================
    const workbook = new ExcelJS.Workbook();

    // -------------------------------------------------------------------------
    // HOJA 1: DASHBOARD EJECUTIVO
    // -------------------------------------------------------------------------
    const sheet1 = workbook.addWorksheet('Eficiencia Operativa', { views: [{ showGridLines: false }] });

    // Definimos solo las llaves y anchos, quitamos 'header' para no sobreescribir la fila 1
    sheet1.columns = [
      { key: 'driverName', width: 32 },
      { key: 'total', width: 15 },
      { key: 'delivered', width: 14 },
      { key: 'returned', width: 12 },
      { key: 'dex03', width: 15 },
      { key: 'dex07', width: 16 },
      { key: 'dex08', width: 16 },
      { key: 'pending', width: 15 },
      { key: 'fechaReq', width: 15 },
      { key: 'retFdx', width: 15 },
      { key: 'unmapped', width: 15 },
      { key: 'pctEff', width: 14 },
      { key: 'pctRet', width: 12 },
    ];

    sheet1.mergeCells('A1:M1');
    const titleCell = sheet1.getCell('A1');
    titleCell.value = '📊 REPORTE EJECUTIVO DE EFICIENCIA OPERATIVA';
    titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet1.getRow(1).height = 35;

    sheet1.mergeCells('A2:M2');
    sheet1.getCell('A2').value = `Periodo Analizado: ${startDate.split('T')[0]} al ${endDate.split('T')[0]}`;
    sheet1.getCell('A2').font = { size: 11, italic: true, color: { argb: 'FF475569' } };
    sheet1.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };
    sheet1.getRow(2).height = 20;

    // AHORA SÍ, escribimos los encabezados en la Fila 4
    const headerRow1 = sheet1.getRow(4);
    headerRow1.values = [
      'Chofer / Repartidor', 'Total Asignados', 'Entregados', 'DEX Total', 
      'DEX 03 (Dir. Mal)', 'DEX 07 (Rechazo)', 'DEX 08 (No Disp.)', 
      'Sin Movimiento', 'Cambio Fecha', 'Dev. FedEx', 'Otros (Fugas)', 
      '% Efectividad', '% Retorno'
    ];
    headerRow1.height = 25;
    headerRow1.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { top: { style: 'medium', color: { argb: 'FF1E3A8A' } }, bottom: { style: 'medium', color: { argb: 'FF1E3A8A' } } };
    });

    let row1Idx = 5;
    let sTotal = 0, sDel = 0, sRet = 0, sD03 = 0, sD07 = 0, sD08 = 0, sPen = 0;
    let sFechaReq = 0, sRetFdx = 0, sUnmapped = 0;

    summaryData.forEach((r, index) => {
      const rawTotal = Number(r.total || 0);
      const rawDel = Number(r.delivered || 0);
      const rawRet = Number(r.returned || 0);
      const rawD03 = Number(r.dex03 || 0);
      const rawD07 = Number(r.dex07 || 0);
      const rawD08 = Number(r.dex08 || 0);
      const rawPen = Number(r.pending || 0);
      const rawFechaReq = Number(r.fecharequested || r.fechaRequested || 0);
      const rawRetFdx = Number(r.returnedfedex || r.returnedFedex || 0);
      const rawUnmapped = Number(r.unmapped || 0);

      sTotal += rawTotal; sDel += rawDel; sRet += rawRet; sD03 += rawD03; sD07 += rawD07; sD08 += rawD08; sPen += rawPen;
      sFechaReq += rawFechaReq; sRetFdx += rawRetFdx; sUnmapped += rawUnmapped;

      const pctEff = rawTotal > 0 ? (rawDel / rawTotal) : 0;
      const pctRet = rawTotal > 0 ? (rawRet / rawTotal) : 0;

      const row = sheet1.getRow(row1Idx);
      row.values = [
        r.driverName || r.drivername || 'Sin Chofer', rawTotal, rawDel, rawRet, 
        rawD03, rawD07, rawD08, rawPen, rawFechaReq, rawRetFdx, rawUnmapped,
        pctEff, pctRet
      ];
      row.height = 20;

      const bgColor = (index % 2 === 0) ? 'FFFFFFFF' : 'FFF8FAFC';
      row.eachCell((cell, colNum) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
        cell.alignment = { vertical: 'middle', horizontal: colNum === 1 ? 'left' : 'center' };
      });

      [2,3,4,5,6,7,8,9,10,11].forEach(col => row.getCell(col).numFmt = '#,##0');
      
      const effCell = row.getCell(12);
      effCell.numFmt = '0.0%'; effCell.font = { bold: true };
      if (pctEff >= 0.90) effCell.font.color = { argb: 'FF059669' };
      else if (pctEff >= 0.75) effCell.font.color = { argb: 'FFD97706' };
      else effCell.font.color = { argb: 'FFE11D48' };

      const retCell = row.getCell(13);
      retCell.numFmt = '0.0%'; retCell.font = { bold: true };
      if (pctRet <= 0.05) retCell.font.color = { argb: 'FF059669' };
      else if (pctRet <= 0.15) retCell.font.color = { argb: 'FFD97706' };
      else retCell.font.color = { argb: 'FFE11D48' };

      row1Idx++;
    });

    if (summaryData.length > 0) {
      const totalsRow = sheet1.getRow(row1Idx);
      const globalEff = sTotal > 0 ? (sDel/sTotal) : 0;
      const globalRet = sTotal > 0 ? (sRet/sTotal) : 0;

      totalsRow.values = [ 'TOTALES GLOBALES', sTotal, sDel, sRet, sD03, sD07, sD08, sPen, sFechaReq, sRetFdx, sUnmapped, globalEff, globalRet ];
      totalsRow.height = 25;
      totalsRow.eachCell((cell, colNum) => {
        cell.font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.alignment = { vertical: 'middle', horizontal: colNum === 1 ? 'right' : 'center' };
        cell.border = { top: { style: 'double', color: { argb: 'FF94A3B8' } }, bottom: { style: 'medium', color: { argb: 'FF94A3B8' } } };
      });
      
      [2,3,4,5,6,7,8,9,10,11].forEach(col => totalsRow.getCell(col).numFmt = '#,##0');
      
      const totalEffCell = totalsRow.getCell(12);
      totalEffCell.numFmt = '0.0%';
      if (globalEff >= 0.90) totalEffCell.font.color = { argb: 'FF059669' };
      else if (globalEff >= 0.75) totalEffCell.font.color = { argb: 'FFD97706' };
      else totalEffCell.font.color = { argb: 'FFE11D48' };

      const totalRetCell = totalsRow.getCell(13);
      totalRetCell.numFmt = '0.0%';
      if (globalRet <= 0.05) totalRetCell.font.color = { argb: 'FF059669' };
      else if (globalRet <= 0.15) totalRetCell.font.color = { argb: 'FFD97706' };
      else totalRetCell.font.color = { argb: 'FFE11D48' };

      sheet1.autoFilter = { from: 'A4', to: 'M4' };
    }

    // -------------------------------------------------------------------------
    // HOJA 2: DETALLE DE PAQUETES
    // -------------------------------------------------------------------------
    const sheet2 = workbook.addWorksheet('Detalle de Paquetes', { views: [{ showGridLines: false }] });

    sheet2.columns = [
      { header: 'Chofer', key: 'driver', width: 25 },
      { header: 'Ruta', key: 'route', width: 20 },
      { header: 'Sucursal', key: 'subsidiary', width: 20 },
      { header: 'Tracking', key: 'tracking', width: 22 },
      { header: 'Estatus', key: 'status', width: 35 }, // Lo amplié un poco para el nuevo texto
      { header: 'Cód. DEX', key: 'dex', width: 14 },
      { header: 'Fecha Commit', key: 'commit', width: 18 },
      { header: 'C.P.', key: 'cp', width: 10 },
      { header: 'Destinatario', key: 'recipient', width: 35 },
    ];

    const headerRow2 = sheet2.getRow(1);
    headerRow2.height = 25;
    headerRow2.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } }; 
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF0F172A' } } };
    });

    detailsData.forEach((row, index) => {
      // 🔥 MAGIA VISUAL: Si el estatus es devuelto, le mostramos al usuario cuál era su DEX oculto
      const statusRaw = row.status || 'desconocido';
      const realStatusRaw = row.realstatus || row.realStatus || statusRaw;
      
      let displayStatus = statusRaw.toUpperCase().replace(/_/g, ' ');
      if ((statusRaw === 'devuelto_a_fedex' || statusRaw === 'retorno_abandono_fedex') && realStatusRaw !== statusRaw) {
        displayStatus = `${displayStatus} (Era: ${realStatusRaw.toUpperCase().replace(/_/g, ' ')})`;
      }

      const dataRow = sheet2.addRow({
        driver: row.driverName || row.drivername || 'Sin Asignar',
        route: row.routeName || row.routename || 'N/A',
        subsidiary: row.subsidiaryName || row.subsidiaryname || 'N/A',
        tracking: row.tracking,
        status: displayStatus,
        dex: row.exceptionCode || row.exceptioncode || '-',
        commit: row.commitDate ? new Date(row.commitDate).toLocaleDateString('es-MX') : 'Sin Fecha',
        cp: row.cp || 'S/C',
        recipient: row.recipient || 'Sin Nombre'
      });

      const bgColor = (index % 2 === 0) ? 'FFFFFFFF' : 'FFF8FAFC';
      dataRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
        cell.alignment = { vertical: 'middle' };
      });

      [4, 5, 6, 7, 8].forEach(col => { dataRow.getCell(col).alignment = { vertical: 'middle', horizontal: 'center' }; });
      
      const dexCell = dataRow.getCell(6);
      if (dexCell.value !== '-') {
        dexCell.font = { bold: true, color: { argb: 'FFE11D48' } }; 
      }
    });

    if(detailsData.length > 0) {
        sheet2.autoFilter = { from: 'A1', to: 'I1' }; 
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as unknown as Buffer;
  }
}
