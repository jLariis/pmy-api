import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { ChargeShipment, Shipment, ShipmentRemittance, WarehouseReceiving } from 'src/entities';
import { In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ScannedShipment } from './dto/scanned-shipment.dto';
import { PaymentTypeEnum } from 'src/common/enums/payment-type.enum';
import { ShipmentStatusType } from 'src/common/enums';

@Injectable()
export class WarehouseService {
  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(WarehouseReceiving)
    private readonly warehouseReceivingRepository: Repository<WarehouseReceiving>,
    // 1. Inyectamos el nuevo repositorio de Remesas
    @InjectRepository(ShipmentRemittance)
    private readonly shipmentRemittanceRepository: Repository<ShipmentRemittance>,
  ) {}

  async create(createWarehouseDto: CreateWarehouseDto, userId?: string) {
    console.log("🚀 ~ WarehouseService ~ create ~ createWarehouseDto:", createWarehouseDto);

    try {
      // 1. Guardar la información de la entrada a bodega en bd
      const newReceiving = this.warehouseReceivingRepository.create({
        warehouseId: createWarehouseDto.warehouse,
        shipments: createWarehouseDto.shipments,
        vehicle: createWarehouseDto.vehicle ? { id: createWarehouseDto.vehicle } as any : null,
        drivers: createWarehouseDto.drivers && createWarehouseDto.drivers.length > 0 
          ? createWarehouseDto.drivers.map(driverId => ({ id: driverId } as any))
          : [],
        createdBy: userId ? { id: userId } as any : null,
      });

      const savedReceiving = await this.warehouseReceivingRepository.save(newReceiving);

      // 2. Extraer los IDs de todos los paquetes recibidos en el DTO
      const shipmentIds = createWarehouseDto.shipments.map(shipment => shipment.id);

      // 3. Ponemos todos los paquetes en estado "en bodega" y los asociamos a la entrada
      if (shipmentIds.length > 0) {
        await this.shipmentRepository.update(
          { id: In(shipmentIds) }, 
          {
            status: ShipmentStatusType.EN_BODEGA, 
          }
        );
      }

      // 4. Extraer y guardar las remesas (piezas de DHL u otros)
      // Mapeamos el arreglo anidado de envíos para extraer todas las piezas en un arreglo plano
      const remittancesData = createWarehouseDto.shipments.flatMap(shipment => 
        // Verificamos si vienen remesas desde el DTO del frontend
        (shipment.remittances || []).map(remittance => ({
          pieceTrackingNumber: remittance.pieceTrackingNumber,
          shipmentId: remittance.shipmentId,
          status: ShipmentStatusType.EN_BODEGA, // Asumimos que al llegar a bodega, la remesa también está en ese estado
          warehouseReceivingId: savedReceiving.id, // Asociamos la remesa con la entrada a bodega recién creada
        }))
      );

      // Si hay piezas para guardar, hacemos un insert masivo
      if (remittancesData.length > 0) {
        const newRemittances = this.shipmentRemittanceRepository.create(remittancesData);
        await this.shipmentRemittanceRepository.save(newRemittances);
      }

      return savedReceiving;

    } catch (error) {
      console.error("Error al procesar la entrada a bodega:", error);
      throw new InternalServerErrorException("No se pudo procesar la entrada a bodega, verifique los datos.");
    }
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
          payment: { id: true, amount: true, type: true } 
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
          payment: { id: true, amount: true, type: true } 
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

    // 3. Evaluamos las reglas de negocio
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