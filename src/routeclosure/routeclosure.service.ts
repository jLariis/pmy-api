import { Injectable } from '@nestjs/common';
import { CreateRouteclosureDto } from './dto/create-routeclosure.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { Repository } from 'typeorm';
import { ValidateTrackingsForClosureDto } from './dto/validate-trackings-for-closure';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ShipmentStatus } from 'src/entities';
import { DispatchStatus } from 'src/common/enums/dispatch-enum';
import { MailService } from 'src/mail/mail.service';

@Injectable()
export class RouteclosureService {
  constructor(
    @InjectRepository(RouteClosure)
    private readonly routeClouseRepository: Repository<RouteClosure>,
    @InjectRepository(PackageDispatch)
    private readonly packageDispatchRepository: Repository<PackageDispatch>,
    private readonly mailService: MailService
  ) {}

  async create(createRouteclosureDto: CreateRouteclosureDto) {
    const packageDispatch = await this.packageDispatchRepository.findOne(
      { 
        where: {
          id: createRouteclosureDto.packageDispatch.id
        },
        relations: ['subsidiary']
    });

    packageDispatch.status = DispatchStatus.COMPLETADA;
    packageDispatch.closedAt = new Date();

    /* Actualizar la salida a ruta como completada */
    await this.packageDispatchRepository.save(packageDispatch);

    const newRouteClosure = this.routeClouseRepository.create({
      ...createRouteclosureDto,
      subsidiary: packageDispatch.subsidiary
    });
    
    return await this.routeClouseRepository.save(newRouteClosure);
  }

  async findAll(subsidiaryId: string) {
    return await this.routeClouseRepository.find({
      where: {
        subsidiary: {
          id: subsidiaryId
        }
      }
    });
  }

  async findOne(id: string) {
    return await this.routeClouseRepository.findOne({
      where: {
        id
      }
    });
  }

  async validateTrackingNumbersForClosure(
    validateTrackingForClosure: ValidateTrackingsForClosureDto
  ) {
    const validatedPackages: ValidatedPackageDispatchDto[] = [];
    const podPackages: ValidatedPackageDispatchDto[] = [];

    const packageDispatch = await this.packageDispatchRepository.findOne({
      where: { id: validateTrackingForClosure.packageDispatchId },
      relations: [
        'shipments', 
        'shipments.statusHistory', 
        'shipments.payment',
        'chargeShipments', 
        'chargeShipments.statusHistory',
        'chargeShipments.payment'
      ],
    });

    // Primero validamos los trackings enviados
    for (const tracking of validateTrackingForClosure.trackingNumbers) {
      let isValid = true;
      let reason = '';
      let lastHistory: ShipmentStatus;

      const foundTracking = packageDispatch.shipments.find(
        (s) => s.trackingNumber === tracking
      );

      if (!foundTracking) {
        isValid = false;
        reason = 'no encontró el número de guía en la salida a ruta';
      } else if (foundTracking.status === ShipmentStatusType.ENTREGADO) {
        isValid = false;
        reason = 'el número de guía ya fue entregado';
      } else if (foundTracking.status === ShipmentStatusType.NO_ENTREGADO) {
        const orderedHistory = foundTracking.statusHistory.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        lastHistory = orderedHistory[0];

        const hasValidDex =
          lastHistory &&
          lastHistory.status === ShipmentStatusType.NO_ENTREGADO &&
          ['03', '07', '08'].includes(lastHistory.exceptionCode);

        if (!hasValidDex) {
          isValid = false;
          reason = 'el paquete no tiene un DEX válido en su última historia (03, 07 o 08)';
        }
      }

      validatedPackages.push({
        id: foundTracking?.id,
        trackingNumber: foundTracking?.trackingNumber ?? tracking,
        commitDateTime: foundTracking?.commitDateTime,
        consNumber: foundTracking?.consNumber,
        isHighValue: foundTracking?.isHighValue,
        priority: foundTracking?.priority,
        recipientAddress: foundTracking?.recipientAddress,
        recipientCity: foundTracking?.recipientCity,
        recipientName: foundTracking?.recipientName,
        recipientPhone: foundTracking?.recipientPhone,
        recipientZip: foundTracking?.recipientZip,
        shipmentType: foundTracking?.shipmentType,
        subsidiary: foundTracking?.subsidiary,
        status: foundTracking?.status,
        isValid,
        reason,
        payment: foundTracking?.payment,
        lastHistory,
      });
    }

    // Ahora agregamos a podPackages los que NO fueron enviados pero ya están entregados
    const userTrackingsSet = new Set(validateTrackingForClosure.trackingNumbers);

    for (const s of packageDispatch.shipments) {
      if (!userTrackingsSet.has(s.trackingNumber) && s.status === ShipmentStatusType.ENTREGADO) {
        podPackages.push({
          id: s.id,
          trackingNumber: s.trackingNumber,
          commitDateTime: s.commitDateTime,
          consNumber: s.consNumber,
          isHighValue: s.isHighValue,
          priority: s.priority,
          recipientAddress: s.recipientAddress,
          recipientCity: s.recipientCity,
          recipientName: s.recipientName,
          recipientPhone: s.recipientPhone,
          recipientZip: s.recipientZip,
          shipmentType: s.shipmentType,
          subsidiary: s.subsidiary,
          status: s.status,
          isValid: true,
          reason: 'Paquete ya entregado',
          payment: s.payment,
        });
      }
    }

    return { validatedPackages, podPackages };
  }

  async sendByEmail(pdfFile: Express.Multer.File, excelFile: Express.Multer.File, routeClosureId: string){
    const routeClosure = await this.routeClouseRepository.findOne(
      { 
        where: {
          id: routeClosureId
        },
        relations: ['subsidiary', 'packageDispatch', 'packageDispatch.drivers']
      });

    return await this.mailService.sendHighPriorityRouteClosureEmail(pdfFile, excelFile, routeClosure);
  }

  async remove(id: string) {
    return await this.routeClouseRepository.delete(id);
  }
}
