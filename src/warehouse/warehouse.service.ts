import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { ChargeShipment, PackageDispatch, PackageDispatchHistory, Shipment, ShipmentRemittance, ShipmentStatus, WarehouseOutbound, WarehouseReceiving } from 'src/entities';
import { DataSource, In, QueryRunner, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ScannedShipment } from './dto/scanned-shipment.dto';
import { PaymentTypeEnum } from 'src/common/enums/payment-type.enum';
import { ShipmentStatusType } from 'src/common/enums';
import { CreateOutboundDto } from './dto/create-outbound.dto';

@Injectable()
export class WarehouseService {
  private readonly logger = new Logger(WarehouseService.name);

  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(WarehouseReceiving)
    private readonly warehouseReceivingRepository: Repository<WarehouseReceiving>,
    @InjectRepository(ShipmentRemittance)
    private readonly shipmentRemittanceRepository: Repository<ShipmentRemittance>,
    @InjectRepository(PackageDispatch)
    private readonly packageDispatchRepository: Repository<PackageDispatch>,
    private readonly dataSource: DataSource, // <-- Agregado para manejar las transacciones
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
      const remittancesData = createWarehouseDto.shipments.flatMap(shipment => 
        (shipment.remittances || []).map(remittance => ({
          pieceTrackingNumber: remittance.pieceTrackingNumber,
          shipmentId: remittance.shipmentId,
          status: ShipmentStatusType.EN_BODEGA, 
          warehouseReceivingId: savedReceiving.id, 
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

  async outbound(dto: CreateOutboundDto, userId?: string) {
    console.log("🚀 ~ WarehouseService ~ outbound ~ userId:", userId);
    console.log("🚀 ~ WarehouseService ~ outbound ~ dto:", dto);
    
    // 1. Iniciamos el QueryRunner en el método principal
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 2. Guardar el registro general de salida a bodega (WarehouseOutbound)
      const newOutbound = queryRunner.manager.create(WarehouseOutbound, {
        warehouseId: dto.warehouse,
        type: dto.type,
        shipments: dto.shipments,
        destinationId: dto.destinationId,
        kms: dto.kms,
        // Usamos la misma lógica relacional que en WarehouseReceiving
        vehicle: dto.vehicle ? { id: dto.vehicle } as any : null,
        drivers: dto.drivers && dto.drivers.length > 0 
          ? dto.drivers.map((driverId: string) => ({ id: driverId } as any))
          : [],
        createdBy: userId ? { id: userId } as any : null,
      });

      const savedOutbound = await queryRunner.manager.save(WarehouseOutbound, newOutbound);

      let outboundResult;

      // 3. Decidimos qué método privado ejecutar según el tipo
      if (dto.type === 'dispatch') {
        outboundResult = await this.createDispatch(dto, queryRunner, userId);
      } else if (dto.type === 'transfer') {
        outboundResult = await this.createTransfer(dto, queryRunner);
      } else {
        throw new BadRequestException(`Tipo de salida '${dto.type}' no soportado.`);
      }

      // 4. Procesar las remesas (Pieces/Remittances) de todos los paquetes
      await this.processRemittances(dto.shipments, queryRunner);

      // 5. Confirmar toda la transacción si llegamos hasta aquí sin errores
      await queryRunner.commitTransaction();
      
      return {
        message: `Salida tipo ${dto.type} procesada exitosamente.`,
        outboundId: savedOutbound.id,
        data: outboundResult
      };

    } catch (error) {
      // Si cualquier cosa falla, revertimos TODO
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error en outbound: ${error.message}`, error.stack);
      throw error;
    } finally {
      // Siempre liberamos el QueryRunner
      await queryRunner.release();
    }
  }
  
  private async createTransfer(dto: any, queryRunner: QueryRunner) {
    // 1. Separar envíos normales y de carga
    const normalShipmentIds = dto.shipments.filter((pkg: any) => !pkg.isCharge).map((pkg: any) => pkg.id);
    const chargeShipmentIds = dto.shipments.filter((pkg: any) => pkg.isCharge).map((pkg: any) => pkg.id);

    // 2. Función de Actualización Forzada para Transferencias
    const processUpdates = async (ids: string[], entity: any, relationKey: 'shipment' | 'chargeShipment') => {
      if (ids.length === 0) return;

      // Actualizar el estado y cambiar la sucursal a la de destino
      await queryRunner.manager
        .createQueryBuilder()
        .update(entity)
        .set({ 
          status: ShipmentStatusType.EN_RUTA,
          subsidiary: { id: dto.destinationId } // <-- Aquí asignamos la nueva sucursal al paquete
        } as any)
        .whereInIds(ids)
        .execute();

      // Creación de Historial
      const now = new Date();
      const historyRecords = ids.map(id => {
        return queryRunner.manager.create(ShipmentStatus, {
          status: ShipmentStatusType.EN_RUTA,
          notes: `Transferencia en ruta hacia sucursal destino`,
          timestamp: now,
          [relationKey]: { id }
        });
      });

      await queryRunner.manager.save(ShipmentStatus, historyRecords);
    };

    await processUpdates(normalShipmentIds, Shipment, 'shipment');
    await processUpdates(chargeShipmentIds, ChargeShipment, 'chargeShipment');

    return { 
      transferredPackages: normalShipmentIds.length + chargeShipmentIds.length,
      destination: dto.destinationId 
    };
  }

  private async createDispatch(dto: any, queryRunner: QueryRunner, createdBy: string): Promise<PackageDispatch> {
    // 1. Separar envíos normales y envíos de carga
    const normalShipmentIds = dto.shipments
      .filter((pkg: any) => !pkg.isCharge)
      .map((pkg: any) => pkg.id);
      
    const chargeShipmentIds = dto.shipments
      .filter((pkg: any) => pkg.isCharge)
      .map((pkg: any) => pkg.id);

    // Generar trackingNumber de 10 dígitos (asegurando que sean exactamente 10 caracteres numéricos)
    let generatedTracking = '';
    const characters = '0123456789';
    for (let i = 0; i < 10; i++) {
      generatedTracking += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    // 2. Crear y Guardar el Despacho
    const newDispatch = queryRunner.manager.create(PackageDispatch, {
      trackingNumber: generatedTracking, // <-- Se asigna el trackingNumber de 10 dígitos
      routes: dto.routes?.map((id: string) => ({ id })) || [],
      drivers: dto.drivers?.map((id: string) => ({ id })) || [],
      vehicle: dto.vehicle ? { id: dto.vehicle } : null,
      subsidiary: { id: dto.warehouse }, 
      kms: dto.kms,
      createdBy: createdBy ? { id: createdBy } : null,
    });

    const savedDispatch = await queryRunner.manager.save(newDispatch);

    // 3. Función de Actualización Forzada (Write)
    const processUpdates = async (ids: string[], entity: any, relationKey: 'shipment' | 'chargeShipment') => {
      if (ids.length === 0) return;

      await queryRunner.manager
        .createQueryBuilder()
        .update(entity)
        .set({ status: ShipmentStatusType.EN_RUTA })
        .whereInIds(ids)
        .execute();

      // Creación de Historial
      const now = new Date();
      const historyRecords = ids.map(id => {
        return queryRunner.manager.create(ShipmentStatus, {
          status: ShipmentStatusType.EN_RUTA,
          exceptionCode: '', 
          notes: `Salida a ruta (Folio Despacho: ${savedDispatch.trackingNumber})`, // Mejor usar el tracking number generado para la nota
          timestamp: now,
          [relationKey]: { id } // Relación directa
        });
      });

      await queryRunner.manager.save(ShipmentStatus, historyRecords);
    };

    // Ejecutar actualizaciones
    await processUpdates(normalShipmentIds, Shipment, 'shipment');
    await processUpdates(chargeShipmentIds, ChargeShipment, 'chargeShipment');

    // 4. Vincular tablas Pivot (Many-to-Many)
    if (normalShipmentIds.length > 0) {
      await queryRunner.manager
        .createQueryBuilder()
        .relation(PackageDispatch, 'shipments')
        .of(savedDispatch)
        .add(normalShipmentIds);
    }

    if (chargeShipmentIds.length > 0) {
      await queryRunner.manager
        .createQueryBuilder()
        .relation(PackageDispatch, 'chargeShipments')
        .of(savedDispatch)
        .add(chargeShipmentIds);
    }

    // 5. Historial global del despacho
    const dispatchHistoryRecords = [
      ...normalShipmentIds.map(id =>
        queryRunner.manager.create(PackageDispatchHistory, {
          dispatch: { id: savedDispatch.id },
          shipment: { id },
        })
      ),
      ...chargeShipmentIds.map(id =>
        queryRunner.manager.create(PackageDispatchHistory, {
          dispatch: { id: savedDispatch.id },
          chargeShipment: { id },
        })
      ),
    ];

    await queryRunner.manager.save(PackageDispatchHistory, dispatchHistoryRecords);

    return savedDispatch;
  }

  private async processRemittances(shipments: any[], queryRunner: QueryRunner) {
    // Extraemos los tracking numbers de las piezas/remesas del DTO
    const pieceTrackingNumbers = shipments.flatMap(shipment => 
      (shipment.remittances || []).map((rem: any) => rem.pieceTrackingNumber)
    );

    if (pieceTrackingNumbers.length > 0) {
      // Actualizamos masivamente el estado de esas remesas a EN_RUTA
      await queryRunner.manager
        .createQueryBuilder()
        .update(ShipmentRemittance)
        .set({ status: ShipmentStatusType.EN_RUTA })
        .where('pieceTrackingNumber IN (:...pieceTrackingNumbers)', { pieceTrackingNumbers })
        .execute();
    }
  }
}