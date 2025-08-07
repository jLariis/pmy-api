import { Injectable } from '@nestjs/common';
import { CreateUnloadingDto } from './dto/create-unloading.dto';
import { UpdateUnloadingDto } from './dto/update-unloading.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Unloading } from 'src/entities/unloading.entity';
import { In, Repository } from 'typeorm';
import { ChargeShipment, Shipment } from 'src/entities';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

@Injectable()
export class UnloadingService {

  constructor(
    @InjectRepository(Unloading)
    private readonly unloadingRepository: Repository<Unloading>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
  ) {}

  async create(createUnloadingDto: CreateUnloadingDto) {
    const allShipmentIds = createUnloadingDto.shipments;

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

    // Guardar el Desembarque
    const newUnloading = this.unloadingRepository.create({
      vehicle: createUnloadingDto.vehicle,
      subsidiary: createUnloadingDto.subsidiary,
      missingTrackings: createUnloadingDto.missingTrackings,
      unScannedTrackings: createUnloadingDto.unScannedTrackings,
      date: new Date(),
    });

    const savedUnloading = await this.unloadingRepository.save(newUnloading);

    // ✅ En lugar de .relation().add(), asignar directamente unloading
    for (const shipment of shipments) {
      shipment.unloading = savedUnloading;
    }
    await this.shipmentRepository.save(shipments);

    for (const chargeShipment of chargeShipments) {
      chargeShipment.unloading = savedUnloading;
    }
    await this.chargeShipmentRepository.save(chargeShipments);

    return savedUnloading;
  }

  async validatePackage(
      packageToValidate: ValidatedPackageDispatchDto,
      subsidiaryId: string
    ): Promise<ValidatedPackageDispatchDto> {
      let isValid = true;
      let reason = '';
  
    
      if (packageToValidate.subsidiary.id !== subsidiaryId) {
        isValid = false;
        reason = 'El paquete no pertenece a la sucursal actual';
      }
  
      if (packageToValidate.status === ShipmentStatusType.ENTREGADO) {
        isValid = false;
        reason = 'El paquete ya ha sido entregado';
      }
  
      return {
        ...packageToValidate,
        isValid,
        reason
      };
    }
  
    async validateTrackingNumber(
      trackingNumber: string,
      subsidiaryId?: string
    ): Promise<ValidatedPackageDispatchDto & { isCharge?: boolean; /*consolidated?: Consolidated*/ }> {
      const shipment = await this.shipmentRepository.findOne({
        where: { trackingNumber },
        relations: ['subsidiary', 'statusHistory', 'payment', 'packageDispatch'],
        order: { createdAt: 'DESC' }
      });
  
  
      if (!shipment) {
        const chargeShipment = await this.chargeShipmentRepository.findOne({
          where: { trackingNumber },
          relations: ['subsidiary', 'charge', 'packageDispatch'],
        });
  
        if (!chargeShipment) {
          throw new Error('Shipment not found with the provided tracking number');
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
  
      /*const consolidated = await this.consolidatedRepository.findOne({
        where: { id: shipment.consolidatedId },
      });*/
  
      const validatedShipment = await this.validatePackage(
        {
          ...shipment,
          isValid: false,
        },
        subsidiaryId
      );
  
      return {
        ...validatedShipment,
        /*consolidated,*/
      };
    }


  async findAll() {
    return `This action returns all unloading`;
  }

  async findAllBySubsidiary(subsidiaryId: string) {
    const response = await this.unloadingRepository.find({
      where: { subsidiary: { id: subsidiaryId } },
      relations: ['shipments', 'vehicle'],
    });

    return response
  }

  findOne(id: number) {
    return `This action returns a #${id} unloading`;
  }

  update(id: number, updateUnloadingDto: UpdateUnloadingDto) {
    return `This action updates a #${id} unloading`;
  }

  remove(id: number) {
    return `This action removes a #${id} unloading`;
  }
}
