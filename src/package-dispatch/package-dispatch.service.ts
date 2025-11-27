import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { CreatePackageDispatchDto } from './dto/create-package-dispatch.dto';
import { UpdatePackageDispatchDto } from './dto/update-package-dispatch.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { In, Not, Repository } from 'typeorm';
import { Shipment, ChargeShipment, Consolidated, ShipmentStatus } from 'src/entities';
import { ValidatedPackageDispatchDto } from './dto/validated-package-dispatch.dto';
import { Devolution } from 'src/entities/devolution.entity';
import { MailService } from 'src/mail/mail.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { FedexService } from 'src/shipments/fedex.service';
import { FedexTrackingResponse } from 'src/shipments/dto/FedexTrackingCompleteInfo.dto';
import { Priority } from 'src/common/enums/priority.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { ShipmentsService } from 'src/shipments/shipments.service';

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
    private readonly shipmentStatusRepository: Repository<ShipmentStatus>

  ){

  }

  async create(dto: CreatePackageDispatchDto): Promise<PackageDispatch> {
    const allShipmentIds = dto.shipments;

    // Buscar en shipmentRepository
    const shipments = await this.shipmentRepository.find({
      where: { id: In(allShipmentIds) },
    });

    const foundShipmentIds = shipments.map(s => s.id);
    const missingIds = allShipmentIds.filter(id => !foundShipmentIds.includes(id));

    // Buscar los faltantes en chargeShipmentRepository
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { id: In(missingIds) },
    });

    const foundChargeShipmentIds = chargeShipments.map(s => s.id);
    const stillMissing = missingIds.filter(id => !foundChargeShipmentIds.includes(id));

    if (stillMissing.length > 0) {
      throw new Error(`Some shipment IDs were not found: ${stillMissing.join(', ')}`);
    }

    const newPackageDispatch = this.packageDispatchRepository.create({
      routes: dto.routes || [],
      drivers: dto.drivers || [],
      vehicle: dto.vehicle,
      subsidiary: dto.subsidiary,
      kms: dto.kms
    });

    const savedDispatch = await this.packageDispatchRepository.save(newPackageDispatch);

    // Relacionar los encontrados de shipment y chargeShipment
    if (shipments.length > 0) {
      await this.shipmentRepository
        .createQueryBuilder()
        .relation(PackageDispatch, 'shipments')
        .of(savedDispatch)
        .add(shipments);
    }

    if (chargeShipments.length > 0) {
      await this.chargeShipmentRepository
        .createQueryBuilder()
        .relation(PackageDispatch, 'chargeShipments')
        .of(savedDispatch)
        .add(chargeShipments);
    }

    return savedDispatch;
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

  async findBySubsidiary(subsidiaryId: string) {
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

  async findAllBySubsidiary(subsidiaryId: string) {
   /* const response = await this.packageDispatchRepository.find({
      where: { subsidiary: { id: subsidiaryId } },
      relations: ['shipments', 'chargeShipments', 'routes', 'drivers', 'vehicle', 'subsidiary'],
      order: {
        createdAt: 'DESC'
      }
    });*/

    const qb = this.packageDispatchRepository
    .createQueryBuilder('pd')
    .leftJoinAndSelect('pd.subsidiary', 'subsidiary')
    .leftJoinAndSelect('pd.routes', 'routes')
    .leftJoinAndSelect('pd.drivers', 'drivers')
    .leftJoinAndSelect('pd.vehicle', 'vehicle')
    .leftJoinAndSelect('pd.shipments', 'shipments')
    .leftJoinAndSelect('pd.chargeShipments', 'chargeShipments')
    .where('subsidiary.id = :subsidiaryId', { subsidiaryId })
    .orderBy('pd.createdAt', 'DESC');

    return qb.getMany();
  }

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
      if (status !== 'no_entregado') return null;

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
    // Validar que se proporcione el ID del package dispatch
    if (!packageDispatchId) {
      throw new Error('El ID del package dispatch es requerido');
    }

    // 1. Buscar el package dispatch específico por ID
    const packageDispatch = await this.packageDispatchRepository.findOne({
      where: { id: packageDispatchId },
      select: ['id', 'trackingNumber'] // Ajusta según el nombre del campo en tu entidad
    });

    if (!packageDispatch) {
      console.warn(`No se encontró el package dispatch con ID: ${packageDispatchId}`);
      return [];
    }

    console.log(`🔍 Procesando package dispatch: ${packageDispatch.trackingNumber}`);

    // 2. Obtener solo IDs y tracking numbers de shipments
    const shipmentsForFedex = [];
    const shipmentsTrackingNumbers = [];
    const chargeShipmentsTrackingNumbers = [];

    // Obtener solo ID y trackingNumber de shipments normales
    const shipments = await this.shipmentRepository.find({
      where: { 
        packageDispatch: {
          id: packageDispatch.id 
        },
        status: In([ShipmentStatusType.EN_RUTA, ShipmentStatusType.DESCONOCIDO, ShipmentStatusType.PENDIENTE, ShipmentStatusType.NO_ENTREGADO])
      },
      select: ['id', 'trackingNumber']
    });

    // Obtener solo ID y trackingNumber de chargeShipments
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { 
        packageDispatch: {id: packageDispatch.id },
        status: In([ShipmentStatusType.EN_RUTA, ShipmentStatusType.DESCONOCIDO, ShipmentStatusType.PENDIENTE, ShipmentStatusType.NO_ENTREGADO])
      },
      select: ['id', 'trackingNumber']
    });

    console.log(`📦 Shipments: ${shipments.length}, ChargeShipments: ${chargeShipments.length}`);

    if (shipments.length === 0 && chargeShipments.length === 0) {
      console.warn(`⚠️ No se encontraron shipments para package dispatch ${packageDispatch.trackingNumber}`);
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

    console.log(`✅ Package Dispatch ${packageDispatch.trackingNumber}: ${allShipments.length} shipments listos para FedEx`);

    // 3. Procesar con FedEx
    try {
      const result = await this.shipmentService.checkStatusOnFedexBySubsidiaryRulesTesting(shipmentsTrackingNumbers, true);
      const resultChargShipments = await this.shipmentService.checkStatusOnFedexChargeShipment(chargeShipmentsTrackingNumbers);

      // Registrar resultados para auditoría
      this.logger.log(
        `✅ Resultado para package dispatch ${packageDispatch.trackingNumber}: ` +
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
      this.logger.error(`❌ Error al actualizar FedEx para package dispatch ${packageDispatch.trackingNumber}: ${err.message}`);
    }

    return shipmentsForFedex;
  }
}
