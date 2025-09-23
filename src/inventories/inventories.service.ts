import { Injectable } from '@nestjs/common';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import { In, Not, Repository } from 'typeorm';
import { ChargeShipment, Consolidated, Shipment, Subsidiary } from 'src/entities';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { MailService } from 'src/mail/mail.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

@Injectable()
export class InventoriesService {
  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(Consolidated)
    private readonly consolidatedRepository: Repository<Consolidated>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
    private readonly mailService: MailService
  ){}

  async create(createInventoryDto: CreateInventoryDto) {
    const { inventoryDate, shipments, chargeShipments, subsidiary } = createInventoryDto;

    // Buscar entidades .findBy({ id: In([1, 2, 3]) })
    const shipmentsToSave = await this.shipmentRepository.findBy({id: In(shipments)});
    const chargeShipmentsToSave = await this.chargeShipmentRepository.findBy({id: In(chargeShipments)});
    const subsidiaryObj = await this.subsidiaryRepository.findOneBy({ id: subsidiary.id });

    const newInventory = this.inventoryRepository.create({
      inventoryDate,
      shipments: shipmentsToSave,
      chargeShipments: chargeShipmentsToSave,
      subsidiary: subsidiaryObj,
    });

    return await this.inventoryRepository.save(newInventory);
  }

  async validatePackage(
      packageToValidate: ValidatedPackageDispatchDto,
      subsidiaryId: string
    ): Promise<ValidatedPackageDispatchDto> {
      let isValid = true;
      let reason = '';
  
      /*const existePackageOnPackageDispatch = await this.inventoryRepository
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
      .getRawOne();*/
  
      /*const existPackageOnReturn = await this.devolutionRepository.findOne({
        where: { trackingNumber: packageToValidate.trackingNumber },
      })*/
  
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
        status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) 
      },
      relations: ['subsidiary', 'statusHistory', 'payment'],
      order: { createdAt: 'DESC' }
    });


    if (!shipment) {
      const chargeShipment = await this.chargeShipmentRepository.findOne({
        where: { 
          trackingNumber,
          status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) 
        },
        relations: ['subsidiary', 'charge'],
        order: { createdAt: 'DESC' }
      });

      if (!chargeShipment) {
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

  async validateTrackingNumbers(
      trackingNumbers: string[],
      subsidiaryId?: string
    ): Promise<{
      validatedShipments: (ValidatedPackageDispatchDto & { isCharge?: boolean })[];
    }> {
      // 1️⃣ Traer shipments y chargeShipments en batch
      const shipments = await this.shipmentRepository.find({
        where: { trackingNumber: In(trackingNumbers),  status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
        relations: ['subsidiary', 'statusHistory', 'payment', 'packageDispatch'],
        order: { createdAt: 'DESC' },
      });
  
      const chargeShipments = await this.chargeShipmentRepository.find({
        where: { trackingNumber: In(trackingNumbers),  status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
        relations: ['subsidiary', 'charge', 'packageDispatch'],
      });
  
      // Mapas para acceso rápido por trackingNumber
      const shipmentsMap = new Map(shipments.map(s => [s.trackingNumber, s]));
      const chargeMap = new Map(chargeShipments.map(c => [c.trackingNumber, c]));
  
      const validatedShipments: (ValidatedPackageDispatchDto & { isCharge?: boolean })[] = [];
  
      // 2️⃣ Validar todos los trackingNumbers recibidos
      for (const tn of trackingNumbers) {
        const shipment = shipmentsMap.get(tn);
        if (shipment) {
          const validated = await this.validatePackage({ ...shipment, isValid: false }, subsidiaryId);
          validatedShipments.push(validated);
          continue;
        }
  
        const chargeShipment = chargeMap.get(tn);
        if (chargeShipment) {
          const validatedCharge = await this.validatePackage({ ...chargeShipment, isValid: false }, subsidiaryId);
          validatedShipments.push({ ...validatedCharge, isCharge: true });
          continue;
        }
  
        validatedShipments.push({
          trackingNumber: tn,
          isValid: false,
          reason: 'No se encontraron datos para el tracking number en la base de datos',
          subsidiary: null,
          status: null,
        });
      }
  
      return { validatedShipments };
    }

  async findAll(subsidiaryId: string) {
    return await this.inventoryRepository.find({
      where: {
        subsidiary: {
          id: subsidiaryId
        }
      },
      order: {
        inventoryDate: 'DESC'
      },
      relations: ['subsidiary', 'shipments', 'chargeShipments']
    });
  }

  async findOne(id: string) {
    return await this.inventoryRepository.findOneBy({id});
  }

  async sendByEmail(file: Express.Multer.File, excelFile: Express.Multer.File, subsidiaryName: string, inventoryId: string) {
    const inventory = await this.inventoryRepository.findOne(
      { 
        where: {id: inventoryId},
        relations: ['subsidiary']
      });
    console.log("🚀 ~ PackageDispatchService ~ sendByEmail ~ inventory:", inventory)

    return await this.mailService.sendHighPriorityInventoryEmail(file, excelFile, subsidiaryName, inventory)
  }
}
