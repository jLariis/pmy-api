import { Injectable } from '@nestjs/common';
import { CreatePackageDispatchDto } from './dto/create-package-dispatch.dto';
import { UpdatePackageDispatchDto } from './dto/update-package-dispatch.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { In, Not, Repository } from 'typeorm';
import { Shipment, ChargeShipment, Consolidated } from 'src/entities';
import { ValidatedPackageDispatchDto } from './dto/validated-package-dispatch.dto';
import { Devolution } from 'src/entities/devolution.entity';
import { MailService } from 'src/mail/mail.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { FedexService } from 'src/shipments/fedex.service';
import { FedexTrackingResponse } from 'src/shipments/dto/FedexTrackingCompleteInfo.dto';
import { Priority } from 'src/common/enums/priority.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';

@Injectable()
export class PackageDispatchService {

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
    private readonly fedexService: FedexService
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

    if (packageToValidate.subsidiary.id !== subsidiaryId) {
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
        relations: ['subsidiary', 'charge'],
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
    const dispatch = await this.packageDispatchRepository
      .createQueryBuilder('dispatch')
      .leftJoinAndSelect('dispatch.vehicle', 'vehicle')
      .leftJoinAndSelect('dispatch.subsidiary', 'subsidiary')
      .leftJoinAndSelect('dispatch.drivers', 'drivers')
      .leftJoinAndSelect('dispatch.shipments', 'shipments')
      .leftJoinAndSelect('shipments.unloading', 'unloading')
      .leftJoinAndSelect('shipments.payment', 'payment')
      .leftJoinAndSelect('dispatch.chargeShipments', 'chargeShipments')
      .leftJoinAndSelect('chargeShipments.unloading', 'chargeUnloading')
      .where('dispatch.id = :dispatchId', { dispatchId })
      .getOne();

    if (!dispatch) return [];

    const driverName = dispatch.drivers?.length ? dispatch.drivers[0].name : null;

    const allConsNumbers = [
      ...(dispatch.shipments || []).map(s => s.consNumber).filter(Boolean),
      ...(dispatch.chargeShipments || []).map(s => s.consNumber).filter(Boolean),
    ];

    const consolidatedMap = new Map<string, { consNumber: string; date: Date }>();
    if (allConsNumbers.length) {
      const consolidatedList = await this.consolidatedRepository.find({
        where: allConsNumbers.map(consNumber => ({ consNumber })),
        select: ['consNumber', 'createdAt'],
      });
      consolidatedList.forEach(c => {
        consolidatedMap.set(c.consNumber, { consNumber: c.consNumber, date: c.createdAt });
      });
    }

    const mapShipment = (shipment: any, isCharge: boolean) => {
      const consolidated = shipment.consNumber
        ? consolidatedMap.get(shipment.consNumber) || null
        : null;

      const ubication = dispatch.id ? 'EN RUTA' : 'EN BODEGA';

      return {
        shipmentData: {
          trackingNumber: shipment.trackingNumber,
          shipmentStatus: shipment.status, // ✅ Aquí está el shipmentStatus
          ubication,
          unloading: shipment.unloading
            ? {
                trackingNumber: shipment.unloading.trackingNumber,
                date: shipment.unloading.date,
              }
            : null,
          consolidated,
          destination: shipment.recipientCity || null,
          commiteDateTime: shipment.commitDateTime,
          payment: shipment.payment,
          isCharge,
        },
        packageDispatch: {
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
        },
      };
    };

    const normalShipments = (dispatch.shipments || []).map(s => mapShipment(s, false));
    const chargeShipments = (dispatch.chargeShipments || []).map(s => mapShipment(s, true));

    return [...normalShipments, ...chargeShipments];
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
        relations: ['drivers', 'routes', 'vehicle']
      });
    console.log("🚀 ~ PackageDispatchService ~ sendByEmail ~ packageDispatch:", packageDispatch)

    return await this.mailService.sendHighPriorityPackageDispatchEmail(pdfFile, excelfile, subsidiaryName, packageDispatch)
  }
}
