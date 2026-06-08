import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { ChargeShipment, PackageDispatch, PackageDispatchHistory, Shipment, ShipmentRemittance, ShipmentStatus, Subsidiary, WarehouseOutbound, WarehouseReceiving } from 'src/entities';
import { DataSource, In, QueryRunner, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ScannedShipment } from './dto/scanned-shipment.dto';
import { PaymentTypeEnum } from 'src/common/enums/payment-type.enum';
import { ShipmentStatusType } from 'src/common/enums';
import { CreateOutboundDto } from './dto/create-outbound.dto';
import { MailService } from 'src/mail/mail.service';
import { format } from 'node_modules/date-fns-tz/dist/cjs/format';
import { toZonedTime } from 'node_modules/date-fns-tz/dist/cjs/toZonedTime';
import axios from 'axios';
import { PostalCodeResponse } from './dto/postal-code-response';

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
    @InjectRepository(WarehouseOutbound)
    private readonly warehouseOutboundRepository: Repository<WarehouseOutbound>,
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
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
    trackingNumber: string, // Recibe el código escaneado (Tracking o UniqueID)
    subsidiaryId?: string
  ): Promise<ScannedShipment | { isValid: false; trackingNumber: string; reason: string }> {
    
    // 1. Buscamos en ambas tablas simultáneamente e incluimos la relación 'payment'
    const [shipment, chargeShipment] = await Promise.all([
      this.shipmentRepository.findOne({
        where: [
          { trackingNumber: trackingNumber },
          { dhlUniqueId: trackingNumber }
        ],
        select: {
          id: true,
          trackingNumber: true,
          shipmentType: true,
          recipientName: true,
          recipientAddress: true,
          recipientZip: true,
          commitDateTime: true,
          isHighValue: true,
          priority: true,
          status: true,
          dhlUniqueId: true,
          subsidiary: { id: true, name: true},
          payment: { id: true, amount: true, type: true } 
        },
        relations: ['subsidiary', 'payment']
      }),
      
      this.chargeShipmentRepository.findOne({
        where: { trackingNumber: trackingNumber },
        select: {
          id: true,
          trackingNumber: true,
          shipmentType: true,
          recipientName: true,
          recipientAddress: true,
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

    /** Para cuando tengamos ya todo guardado en Bodega Obregon, los paquetes se puedan separar 
     * por ciudad usando el código postal.
     * 
    */
    if(foundPackage.recipientZip) {
      const city = await this.getCityFromZipCode(foundPackage.recipientZip);
      console.log("🚀 ~ WarehouseService ~ validateTrackingNumber ~ city:", city)
    }


    // 3. Evaluamos las reglas de negocio
    const isCharge = !!chargeShipment; 
    const hasPayment = !!foundPackage.payment;
    
    // Asignamos valores por defecto seguros en caso de que no haya pago
    const paymentAmount = foundPackage.payment?.amount || 0;
    const paymentType = foundPackage.payment?.type as PaymentTypeEnum;

    // 4. Retorno del objeto asegurando los tipos
    return {
      id: foundPackage.id,
      trackingNumber: foundPackage.trackingNumber,
      shipmentType: foundPackage.shipmentType,
      recipientName: foundPackage.recipientName,
      recipientAddress: foundPackage.recipientAddress,
      recipientZip: foundPackage.recipientZip,
      subsidiary: foundPackage.subsidiary || null,
      commitDateTime: foundPackage.commitDateTime,
      isHighValue: foundPackage.isHighValue,
      priority: foundPackage.priority,
      status: String(foundPackage.status),
      isCharge,
      hasPayment,
      paymentAmount,
      paymentType,
      dhlUniqueId: shipment?.dhlUniqueId || undefined, 
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

  async sendEmailNotification(
    file: Express.Multer.File, 
    excelFile: Express.Multer.File, 
    subsidiaryName: string, 
    type: 'inbound' | 'outbound',
    id: string,
  ) {
    const timeZone = 'America/Hermosillo'; 

    let info: WarehouseReceiving | WarehouseOutbound = null;
    let destinationSubsidiary: Subsidiary = null;
    
    if (!file || !excelFile) {
      this.logger.warn(`No se proporcionaron ambos archivos para la notificación de ${type} a bodega. ID: ${id}`);
      return;
    }

    if(type === 'inbound') {
      info = await this.warehouseReceivingRepository.findOneBy({ id });
    } else {
      info = await this.warehouseOutboundRepository.findOneBy({ id });
    }

    if(!info) {
      this.logger.warn(`No se encontró la información de ${type} a bodega para el ID proporcionado: ${id}`);
      return;
    }

    this.logger.debug(`Información de ${type} a bodega para email: ${JSON.stringify(info)}`);

    const warehouse = await this.dataSource.getRepository(Subsidiary).findOneBy({ id: info.warehouseId });

    if (!warehouse) {
      this.logger.warn(`No se encontró la sucursal para el ID proporcionado en ${type} a bodega: ${info.warehouseId}`);
      return;
    }

    if (type === 'outbound') {
      const outboundInfo = info as WarehouseOutbound;
      
      if (outboundInfo.destinationId) {
        destinationSubsidiary = await this.dataSource.getRepository(Subsidiary).findOneBy({ 
          id: outboundInfo.destinationId 
        });
      }
    }

    const attachments = [
      {
        filename: file.originalname,
        content: file.buffer
      },
      {
        filename: excelFile.originalname,
        content: excelFile.buffer
      }
    ]

    const now = new Date();
    const zonedDate = toZonedTime(now, timeZone);
    const formattedDate = format(zonedDate, "dd-MM-yyyy");   
 
    const subject = `Notificación de ${type === 'inbound' ? 'Entrada' : 'Salida'} a Bodega - ${subsidiaryName}`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
        <h2 style="border-bottom: 3px solid #3498db; padding-bottom: 8px;">
          📦 Notificación de ${type === 'inbound' ? 'Entrada' : 'Salida'} a Bodega
        </h2>

        <p>
          Se ha generado un nuevo reporte de <strong>${type === 'inbound' ? 'Entrada' : 'Salida'}</strong> para la sucursal <strong>${subsidiaryName}</strong>.
        </p>

        <p><strong>Fecha y hora:</strong> ${format(toZonedTime(info.createdAt, timeZone), 'dd/MM/yyyy hh:mm aa')}</p>
      
        <p style="margin-top: 20px;">
          Puede consultar más detalles en el sistema en la sección de ${type === 'inbound' ? 'Entradas' : 'Salidas'} a Bodega o descargar los archivos adjuntos.
          <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none;">
            https://app-pmy.vercel.app/
          </a>
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <p style="font-size: 0.9em; color: #7f8c8d;">
          Este correo fue enviado automáticamente por el sistema.<br />
          Por favor, no responda a este mensaje.
        </p>
      </div>
    `;

    try { 
      await this.mailService.sendEmailNotification({
        to: [
          warehouse.officeEmail, 
          warehouse.officeEmailToCopy]
        .filter(email => email), 
        subject,
        htmlContent,
        attachments
      });
    } catch (error) {
      this.logger.error(`Error al enviar correo de notificación para ${type} a bodega. ID: ${id}`, error.stack);
    }
  }


  private async getCityFromZipCode(zip: string): Promise<string | null> {
    const { data } = await axios.get<PostalCodeResponse>(
      `https://mexico-api.devaleff.com/api/codigo-postal/${zip}`
    );

    const location = data.data.at(0);

    if (!location) {
      return null;
    }

    return location.d_ciudad.trim() || location.D_mnpio.trim();
  }
}