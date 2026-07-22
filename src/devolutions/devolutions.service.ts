import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { CreateDevolutionDto } from './dto/create-devolution.dto';
import { Between, DataSource, Repository } from 'typeorm';
import { Devolution } from 'src/entities/devolution.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { ChargeShipment, Collection, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ValidateShipmentDto } from './dto/valiation-devolution.dto';
import { MailService } from 'src/mail/mail.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { TemplateService } from 'src/documents/template.service';
import { buildReturningData, ReturningInput } from 'src/documents/data/returning.mapper';

const RETURNING_TZ = 'America/Hermosillo';

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
    @InjectRepository(Collection)
    private readonly collectionRepository: Repository<Collection>,
    private readonly mailService: MailService,
    @Inject(forwardRef(() => ShipmentsService))
    private readonly shipmentService: ShipmentsService,
    private dataSource: DataSource,
    private readonly templateService: TemplateService,
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

  async create(devolutions: CreateDevolutionDto[], userId?: string): Promise<{
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

      // 3. Buscar el paquete en Shipment o ChargeShipment.
      // Con guías duplicadas, SIEMPRE el más reciente (order createdAt DESC).
      let shipment = await queryRunner.manager.findOne(Shipment, { where: { trackingNumber }, order: { createdAt: 'DESC' } });
      let chargeShipment = null;
      let relationKey: 'shipment' | 'chargeShipment' = 'shipment';

      if (!shipment) {
        chargeShipment = await queryRunner.manager.findOne(ChargeShipment, { where: { trackingNumber }, order: { createdAt: 'DESC' } });
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
        createdById: userId ?? null,
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

  async sendByEmail(
    pdfFile: Express.Multer.File,
    excelfile: Express.Multer.File,
    subsidiaryName: string,
    subsidiaryId?: string,
  ) {
    // Resolución de sucursal para el correo. El `id` es la fuente de verdad (estable
    // y único). El `name` NO es único en la tabla, así que caer del id a un nombre
    // podría mandar el correo a la sucursal equivocada. Por eso:
    //  - Si llega `subsidiaryId`: se usa SOLO el id; si no existe, error (no fallback).
    //  - Si NO llega `subsidiaryId`: se intenta por nombre como último recurso.
    let subsidiary: Subsidiary | null = null;
    if (subsidiaryId) {
      subsidiary = await this.subsidiaryRepository.findOneBy({ id: subsidiaryId });
      if (!subsidiary) {
        throw new BadRequestException(
          `No se encontró la sucursal con id ${subsidiaryId} para enviar el correo de devoluciones.`,
        );
      }
    } else if (subsidiaryName) {
      subsidiary = await this.subsidiaryRepository.findOneBy({ name: subsidiaryName });
      this.logger.warn(
        `Correo de devoluciones resuelto por NOMBRE ("${subsidiaryName}") por falta de subsidiaryId. El nombre no es único; conviene enviar siempre el id.`,
      );
    }
    if (!subsidiary) {
      throw new BadRequestException(
        `No se encontró la sucursal (id: ${subsidiaryId ?? '-'}, nombre: ${subsidiaryName ?? '-'}) para enviar el correo de devoluciones.`,
      );
    }

    // Unificación "Devoluciones y Recolecciones": detrás de flag, el backend genera PDF/Excel
    // por el Motor de Plantillas (plantilla canónica única, fiel a C9/C10). Si algo falla, se
    // conservan los archivos subidos por el frontend (respaldo). Flag OFF => comportamiento
    // actual intacto.
    if (process.env.DOC_ENGINE_RETURNING === 'true') {
      try {
        const input = await this.loadReturningInput(subsidiary.id);
        const gen = await this.renderReturningDocuments(input);
        if (gen.pdf) pdfFile = { ...pdfFile, buffer: gen.pdf };
        if (gen.excel) excelfile = { ...excelfile, buffer: gen.excel };
      } catch (e: any) {
        this.logger.warn(`Motor returning falló; uso archivos subidos: ${e?.message}`);
      }
    }

    return await this.mailService.sendHighPriorityDevolutionsEmail(pdfFile, excelfile, subsidiary);
  }

  /** Genera PDF+Excel de "Devoluciones y Recolecciones" por el motor. Si un formato no entrega
   * buffer, queda undefined (respaldo frontend). */
  async renderReturningDocuments(input: ReturningInput): Promise<{ pdf?: Buffer; excel?: Buffer }> {
    const data = buildReturningData(input);
    const [pdf, excel] = await Promise.all([
      this.templateService.render('returning_pdf', data).then((r) => r.buffer).catch(() => undefined),
      this.templateService.render('returning_excel', data).then((r) => r.buffer).catch(() => undefined),
    ]);
    return { pdf, excel };
  }

  /**
   * Arma el `ReturningInput` (espejo backend de `EnhancedFedExPDF`/`generateFedExExcel`) para
   * una sucursal.
   *
   * GAP CONOCIDO (no rompe: flag OFF por defecto): a diferencia de "Cierre de Ruta"
   * (`RouteClosure`, con un id que agrupa exactamente los paquetes de ESE cierre), aquí no existe
   * un identificador de lote/sesión persistido — `ReturningHistory` (que enlazaría
   * `Devolution`/`Collection` a una "sesión" de guardado) existe como entidad pero NUNCA se
   * asigna en ningún flujo (`returningHistoryId` siempre queda null). El endpoint
   * `POST /devolutions/upload` tampoco recibe ningún id de lote, solo `subsidiaryName`/`subsidiaryId`.
   *
   * Aproximación adoptada: se toman todas las `Devolution`/`Collection` de la sucursal creadas
   * en el DÍA EN CURSO (America/Hermosillo), que es la unidad natural de operación de este
   * formulario (un chofer guarda sus devoluciones/recolecciones del día). Riesgo documentado: si
   * la misma sucursal genera más de un envío en el mismo día, el motor incluiría ambos lotes
   * mezclados (a diferencia del PDF/Excel que arma el frontend en el momento, que solo ve el
   * lote recién capturado en memoria). No se resuelve en este lote por no existir el dato
   * persistido para acotarlo correctamente; requeriría enlazar `returningHistoryId` en
   * `create()`/`saveCollections` (fuera de alcance aquí).
   */
  private async loadReturningInput(subsidiaryId: string): Promise<ReturningInput> {
    const subsidiary = await this.subsidiaryRepository.findOneBy({ id: subsidiaryId });

    const now = new Date();
    const zoned = toZonedTime(now, RETURNING_TZ);
    const startOfDay = fromZonedTime(new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate(), 0, 0, 0, 0), RETURNING_TZ);
    const endOfDay = fromZonedTime(new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate(), 23, 59, 59, 999), RETURNING_TZ);

    const [devolutions, collections] = await Promise.all([
      this.devolutionRepository.find({ where: { subsidiary: { id: subsidiaryId }, date: Between(startOfDay, endOfDay) } }),
      this.collectionRepository.find({ where: { subsidiary: { id: subsidiaryId }, createdAt: Between(startOfDay, endOfDay) } }),
    ]);

    return {
      subsidiaryName: subsidiary?.name ?? 'N/A',
      devolutions: devolutions.map((d) => ({ trackingNumber: d.trackingNumber, reason: d.reason })),
      collections: collections.map((c) => ({ trackingNumber: c.trackingNumber })),
    };
  }
}
