import { Injectable } from '@nestjs/common';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { ChargeShipment, Shipment } from 'src/entities';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ScannedShipment } from './dto/scanned-shipment.dto';
import { PaymentTypeEnum } from 'src/common/enums/payment-type.enum';

@Injectable()
export class WarehouseService {
  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,

  ) {}

  create(createWarehouseDto: CreateWarehouseDto) {
    return 'This action adds a new warehouse';
  }

  findAll() {
    return `This action returns all warehouse`;
  }

  findOne(id: number) {
    return `This action returns a #${id} warehouse`;
  }

  update(id: number, updateWarehouseDto: UpdateWarehouseDto) {
    return `This action updates a #${id} warehouse`;
  }

  remove(id: number) {
    return `This action removes a #${id} warehouse`;
  }

  async validateTrackingNumber(
    trackingNumber: string,
    subsidiaryId?: string
  ): Promise<ScannedShipment | { isValid: false; trackingNumber: string; reason: string }> {
    
    // 1. Buscamos en ambas tablas simultáneamente e incluimos la relación 'payment'
    const [shipment, chargeShipment] = await Promise.all([
      this.shipmentRepository.findOne({
        where: { trackingNumber },
        select: {
          id: true,
          trackingNumber: true,
          shipmentType: true,
          recipientZip: true,
          commitDateTime: true,
          isHighValue: true,
          priority: true,
          status: true,
          subsidiary: { id: true, name: true},
          payment: { id: true, amount: true, type: true } // Ajusta si tus columnas se llaman diferente
        },
        relations: ['subsidiary', 'payment']
      }),
      this.chargeShipmentRepository.findOne({
        where: { trackingNumber },
        select: {
          id: true,
          trackingNumber: true,
          shipmentType: true,
          recipientZip: true,
          commitDateTime: true,
          isHighValue: true,
          priority: true,
          status: true,
          subsidiary: { id: true, name: true },
          payment: { id: true, amount: true, type: true } // Ajusta si tus columnas se llaman diferente
        },
        relations: ['subsidiary', 'payment']
      })
    ]);

    const foundPackage = shipment || chargeShipment;

    // 2. Si no existe en la base de datos, retornamos el error de inmediato
    if (!foundPackage) {
      return {
        trackingNumber,
        isValid: false,
        reason: 'El paquete no existe en el sistema local',
      };
    }

    // 3. Evaluamos las reglas de negocio con la nueva nomenclatura
    const isCharge = !!chargeShipment; 
    const hasPayment = !!foundPackage.payment;
    
    // Asignamos valores por defecto seguros en caso de que no haya pago
    const paymentAmount = foundPackage.payment?.amount || 0;
    const paymentType = foundPackage.payment?.type as PaymentTypeEnum;

    // 4. Retorno del objeto que cumple exactamente con tu clase ScannedShipment
    return {
      id: foundPackage.id,
      trackingNumber: foundPackage.trackingNumber,
      shipmentType: foundPackage.shipmentType,
      recipientZip: foundPackage.recipientZip,
      subsidiary: foundPackage.subsidiary|| null,
      commitDateTime: foundPackage.commitDateTime,
      isHighValue: foundPackage.isHighValue,
      priority: foundPackage.priority,
      status: String(foundPackage.status),
      isCharge,
      hasPayment,
      paymentAmount,
      paymentType,
    };
  }
}
