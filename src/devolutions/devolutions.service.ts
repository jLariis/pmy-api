import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { CreateDevolutionDto } from './dto/create-devolution.dto';
import { DataSource, Repository } from 'typeorm';
import { Devolution } from 'src/entities/devolution.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { ChargeShipment, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ValidateShipmentDto } from './dto/valiation-devolution.dto';
import { MailService } from 'src/mail/mail.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { fromZonedTime } from 'date-fns-tz';

@Injectable()
export class DevolutionsService {
  private readonly logger = new Logger(DevolutionsService.name);

  constructor(
    @InjectRepository(Devolution)
    private readonly devolutionRepository: Repository<Devolution>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(Income)
    private readonly incomeRepository: Repository<Income>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
    private readonly mailService: MailService,
    @Inject(forwardRef(() => ShipmentsService))
    private readonly shipmentService: ShipmentsService,
    private dataSource: DataSource
  ) {}

  async createResp1002(devolutions: CreateDevolutionDto[]): Promise<{
    success: Devolution[];
    duplicates: string[];
    notFound: string[];
    errors: Array<{ trackingNumber: string; error: string }>;
  }> {
    const success: Devolution[] = [];
    const duplicates: string[] = [];
    const notFound: string[] = [];
    const errors: Array<{ trackingNumber: string; error: string }> = [];

    for (const dto of devolutions) {
      const { trackingNumber } = dto;
      
      try {
        this.logger.log(`Procesando devolución para tracking: ${trackingNumber}`);

        // 1. Validar si la devolución ya existe
        const existingDevolution = await this.devolutionRepository.findOneBy({ trackingNumber });

        if (existingDevolution) {
          duplicates.push(trackingNumber);
          this.logger.warn(`Devolución duplicada: ${trackingNumber}`);
          continue;
        }

        // 2. Crear nueva devolución
        const newDevolution = this.devolutionRepository.create({
          ...dto,
          date: new Date()
        });

        const savedDevolution = await this.devolutionRepository.save(newDevolution);
        success.push(savedDevolution);
        this.logger.log(`Devolución creada ID: ${savedDevolution.id}`);

        // 3. Actualizar estado (shipment o charge_shipment)
        try {
          // Intentar actualizar shipment primero
          let updateResult = await this.shipmentRepository.update(
            { trackingNumber },
            { 
              status: ShipmentStatusType.DEVUELTO_A_FEDEX,
            }
          );

          // Si no se encontró en shipment, buscar en charge_shipment
          if (updateResult.affected === 0) {
            updateResult = await this.chargeShipmentRepository.update(
              { trackingNumber },
              { 
                status: ShipmentStatusType.DEVUELTO_A_FEDEX,
              }
            );

            if (updateResult.affected === 0) {
              notFound.push(trackingNumber);
              this.logger.warn(`No encontrado en shipment ni charge_shipment: ${trackingNumber}`);
            } else {
              this.logger.log(`ChargeShipment actualizado: ${trackingNumber}`);
            }
          } else {
            this.logger.log(`Shipment actualizado: ${trackingNumber}`);
          }
        } catch (updateError) {
          this.logger.error(`Error al actualizar estado: ${trackingNumber}`, updateError.stack);
          errors.push({ 
            trackingNumber, 
            error: `Error actualizando estado: ${updateError.message}` 
          });
        }

        /* 
        // 4. Validación y eliminación de income (pendiente)
        try {
          // Lógica especial para income vendrá aquí
        } catch (incomeError) {
          this.logger.error(`Error procesando income: ${trackingNumber}`, incomeError.stack);
          errors.push({
            trackingNumber,
            error: `Error procesando income: ${incomeError.message}`
          });
        }
        */

      } catch (error) {
        const errorMessage = `Error procesando devolución ${trackingNumber}: ${error.message}`;
        this.logger.error(errorMessage, error.stack);
        errors.push({ trackingNumber, error: errorMessage });
      }
    }

    // Reporte final
    this.logger.log(`
      Resultado final:
      - Creadas: ${success.length}
      - Duplicadas: ${duplicates.length}
      - No encontradas: ${notFound.length}
      - Errores: ${errors.length}
    `);

    return { 
      success, 
      duplicates, 
      notFound,
      errors 
    };
  }

  async create(devolutions: CreateDevolutionDto[]): Promise<{
  success: string[];
  duplicates: string[];
  notFound: string[];
  errors: Array<{ trackingNumber: string; error: string }>;
}> {
  const success: string[] = [];
  const duplicates: string[] = [];
  const notFound: string[] = [];
  const errors: Array<{ trackingNumber: string; error: string }> = [];

  for (const dto of devolutions) {
    const { trackingNumber, subsidiary, status } = dto;
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Validaciones previas de integridad del DTO
      if (!subsidiary) {
        throw new Error('La sucursal es obligatoria para procesar la devolución.');
      }

      // 2. Verificar duplicados en devoluciones
      const existingDevolution = await queryRunner.manager.findOne(Devolution, { 
        where: { trackingNumber } 
      });
      if (existingDevolution) {
        duplicates.push(trackingNumber);
        await queryRunner.rollbackTransaction();
        continue;
      }

      // 3. Buscar el paquete en Shipment o ChargeShipment
      let shipment = await queryRunner.manager.findOne(Shipment, { where: { trackingNumber } });
      let chargeShipment = null;
      let relationKey: 'shipment' | 'chargeShipment' = 'shipment';

      if (!shipment) {
        chargeShipment = await queryRunner.manager.findOne(ChargeShipment, { where: { trackingNumber } });
        relationKey = 'chargeShipment';
      }

      if (!shipment && !chargeShipment) {
        notFound.push(trackingNumber);
        await queryRunner.rollbackTransaction();
        continue;
      }

      // 4. Crear registro de Devolución
      const newDevolution = queryRunner.manager.create(Devolution, {
        ...dto,
        date: new Date(),
      });
      await queryRunner.manager.save(newDevolution);

      // 5. Actualizar Estatus del Paquete
      const targetEntity = shipment ? Shipment : ChargeShipment;
      const packageId = shipment ? shipment.id : chargeShipment.id;

      await queryRunner.manager.update(targetEntity, packageId, {
        status: ShipmentStatusType.DEVUELTO_A_FEDEX,
      });

      // 6. Generar Historial (Timestamp Hermosillo)
      const now = new Date();
      const utcDate = fromZonedTime(now, 'America/Hermosillo');

      const history = queryRunner.manager.create(ShipmentStatus, {
        status: ShipmentStatusType.DEVUELTO_A_FEDEX,
        exceptionCode: '', // Código interno para devoluciones
        notes: `Devolución registrada en sucursal: ${subsidiary}. Motivo: ${status || 'No especificado'}`,
        timestamp: utcDate,
        [relationKey]: { id: packageId }
      });
      await queryRunner.manager.save(history);

      // 7. Commit de la transacción
      await queryRunner.commitTransaction();
      success.push(trackingNumber);
      this.logger.log(`Devolución exitosa: ${trackingNumber}`);

    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error en devolución ${trackingNumber}: ${error.message}`);
      errors.push({ 
        trackingNumber, 
        error: error.message 
      });
    } finally {
      await queryRunner.release();
    }
  }

  return { success, duplicates, notFound, errors };
}

  async findAll(subsidiaryId: string) {
    return await this.devolutionRepository.find({
      where: {
        subsidiary: {
          id: subsidiaryId
        }
      },
      order: {
        date: 'DESC'
      }
    });
  }

  async validateOnShipment(
    trackingNumber: string,
  ): Promise<ValidateShipmentDto | null> {

    // ---------------------------------------------------------------
    // 🚀 1. VALIDACIÓN EN FEDEX ANTES DE TODO LO DEMÁS
    // ---------------------------------------------------------------

    try {
      await this.shipmentService.checkStatusOnFedexBySubsidiaryRulesTesting(
        [trackingNumber],
        true,
      );
    } catch (error) {
      console.error(`❌ Error al validar tracking ${trackingNumber} en FedEx`, error);
    }

    // ---------------------------------------------------------------
    // 2. Buscar todos los Shipments con el trackingNumber
    // ---------------------------------------------------------------

    const shipments = await this.shipmentRepository.find({
      where: { trackingNumber },
      relations: ['subsidiary', 'statusHistory'],
      select: {
        id: true,
        trackingNumber: true,
        status: true,
        createdAt: true,
        subsidiary: {
          id: true,
          name: true,
        },
        statusHistory: {
          id: true,
          status: true,
          exceptionCode: true,
          notes: true,
          createdAt: true,
          timestamp: true,
        },
      },
    });

    // ---------------------------------------------------------------
    // 3. Si no hay Shipments, buscar en ChargeShipment
    // ---------------------------------------------------------------

    if (!shipments || shipments.length === 0) {
      const chargeShipment = await this.chargeShipmentRepository.findOne({
        where: { trackingNumber },
        relations: ['subsidiary'],
        select: {
          id: true,
          trackingNumber: true,
          status: true,
          exceptionCode: true,
          subsidiary: {
            id: true,
            name: true,
          },
        },
      });

      if (!chargeShipment) {
        return null;
      }

      const incomeExists = await this.incomeRepository.exists({
        where: { trackingNumber },
      });

      const isProblematic =
        chargeShipment.status === ShipmentStatusType.NO_ENTREGADO &&
        ['03', '07', '08', '17'].includes(chargeShipment.exceptionCode || '');

      if (isProblematic) {
        console.warn(
          `⚠️ ChargeShipment ${chargeShipment.trackingNumber} tiene un estado NO_ENTREGADO con excepción ${chargeShipment.exceptionCode}`,
        );
      }

      return {
        id: chargeShipment.id,
        trackingNumber: chargeShipment.trackingNumber,
        status: chargeShipment.status,
        subsidiaryId: chargeShipment.subsidiary.id,
        subsidiaryName: chargeShipment.subsidiary.name,
        hasIncome: incomeExists,
        isCharge: true,
        hasError: isProblematic ? true : false,
        errorMessage: isProblematic
          ? 'No tiene un dex registrado se debe revisar'
          : '',
        lastStatus: {
          type: chargeShipment.status || null,
          exceptionCode: chargeShipment.exceptionCode || null,
          notes: null,
        },
      };
    }

    // ---------------------------------------------------------------
    // 4. Tomar el shipment más reciente según createdAt
    // ---------------------------------------------------------------

    const latestShipment = shipments.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];

    // ---------------------------------------------------------------
    // 5. Ordenar su statusHistory por timestamp
    // ---------------------------------------------------------------

    const orderedHistory = (latestShipment.statusHistory || []).sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const lastStatus = orderedHistory[orderedHistory.length - 1];

    // ---------------------------------------------------------------
    // 6. Validar estatus problemático
    // ---------------------------------------------------------------

    const isProblematic =
      lastStatus &&
      lastStatus.status === ShipmentStatusType.NO_ENTREGADO &&
      ['03', '07', '08', '17'].includes(lastStatus.exceptionCode || '');

    if (isProblematic) {
      console.warn(
        `⚠️ Shipment ${latestShipment.trackingNumber} tiene un último estado NO_ENTREGADO con excepción ${lastStatus.exceptionCode}`,
      );
    }

    const incomeExists = await this.incomeRepository.exists({
      where: { trackingNumber },
    });

    // ---------------------------------------------------------------
    // 7. Resolver respuesta final
    // ---------------------------------------------------------------

    return {
      id: latestShipment.id,
      trackingNumber: latestShipment.trackingNumber,
      status: latestShipment.status,
      subsidiaryId: latestShipment.subsidiary.id,
      subsidiaryName: latestShipment.subsidiary.name,
      hasIncome: incomeExists,
      isCharge: false,
      hasError: isProblematic ? true : false,
      errorMessage: isProblematic
        ? 'No tiene un dex registrado se debe revisar'
        : '',
      lastStatus: lastStatus
        ? {
            type: lastStatus.status,
            exceptionCode: lastStatus.exceptionCode || null,
            notes: lastStatus.notes,
          }
        : null,
    };
  }

  async sendByEmail(pdfFile: Express.Multer.File, excelfile: Express.Multer.File, subsidiaryName: string) {
    const subsidiary = await this.subsidiaryRepository.findOneBy({name: subsidiaryName});

    return await this.mailService.sendHighPriorityDevolutionsEmail(pdfFile, excelfile, subsidiary)
  }
}
