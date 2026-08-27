import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { CreateDevolutionDto } from './dto/create-devolution.dto';
import { Between, DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { Devolution } from 'src/entities/devolution.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { ChargeShipment, Collection, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { PackageDispatchHistory } from 'src/entities/package-dispatch-history.entity';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ValidateShipmentDto } from './dto/valiation-devolution.dto';
import { MailService } from 'src/mail/mail.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { TemplateService } from 'src/documents/template.service';
import { buildReturningData, ReturningInput } from 'src/documents/data/returning.mapper';
import { FedexStatusResolver } from 'src/fedex-status/fedex-status.resolver';

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
    @InjectRepository(PackageDispatchHistory)
    private readonly packageDispatchHistoryRepository: Repository<PackageDispatchHistory>,
    private readonly mailService: MailService,
    @Inject(forwardRef(() => ShipmentsService))
    private readonly shipmentService: ShipmentsService,
    private dataSource: DataSource,
    private readonly templateService: TemplateService,
    private readonly fedexStatusResolver: FedexStatusResolver,
  ) {}

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
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const outcome = await this.processOneDevolution(queryRunner.manager, dto, { userId });
      await queryRunner.commitTransaction();
      if (outcome === 'success') success.push(dto.trackingNumber);
      else if (outcome === 'duplicate') duplicates.push(dto.trackingNumber);
      else if (outcome === 'notFound') notFound.push(dto.trackingNumber);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error en devolución ${dto.trackingNumber}: ${error.message}`);
      errors.push({ trackingNumber: dto.trackingNumber, error: error.message });
    } finally {
      await queryRunner.release();
    }
  }

  return { success, duplicates, notFound, errors };
}

  /**
   * Procesa UNA devolución sobre el `manager` recibido (sin abrir transacción propia), para poder
   * reusarla tanto en `create()` (una transacción por dto) como en el guardado unificado de una
   * "Salida" (todo en una sola transacción). Devuelve el desenlace sin lanzar por duplicado/no
   * encontrado; solo lanza ante errores inesperados (para que el caller decida el rollback).
   *
   * Regla (Bug #1): una guía reciclada/máster vive en varias filas de distintos consolidados; se
   * marca DEVUELTO_A_FEDEX en TODAS, y el registro de Devolution es único por (guía + consolidado).
   */
  async processOneDevolution(
    manager: EntityManager,
    dto: CreateDevolutionDto,
    opts: { userId?: string; returningHistoryId?: string } = {},
  ): Promise<'success' | 'duplicate' | 'notFound'> {
    const { trackingNumber, subsidiary, status } = dto;
    if (!subsidiary) {
      throw new Error('La sucursal es obligatoria para procesar la devolución.');
    }

    const shipments = await manager.find(Shipment, { where: { trackingNumber } });
    const charges = await manager.find(ChargeShipment, { where: { trackingNumber } });

    if (shipments.length === 0 && charges.length === 0) {
      return 'notFound';
    }

    // Consolidado del match más reciente (puede ser null si el envío no trae consolidado).
    const consolidatedId =
      [...shipments, ...charges]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
        ?.consolidatedId ?? null;

    // Duplicado por (guía + consolidado): no re-crea el registro, pero SÍ garantiza el estatus.
    const existingDevolution = await manager.findOne(Devolution, {
      where: {
        trackingNumber,
        consolidatedId: consolidatedId === null ? IsNull() : consolidatedId,
      },
    });

    if (!existingDevolution) {
      const newDevolution = manager.create(Devolution, {
        ...dto,
        consolidatedId,
        date: new Date(),
        createdById: opts.userId ?? null,
        returningHistory: opts.returningHistoryId ? ({ id: opts.returningHistoryId } as any) : null,
      });
      await manager.save(newDevolution);
    }

    // Marcar DEVUELTO_A_FEDEX en TODAS las filas de la guía + historial por fila (idempotente).
    const utcDate = fromZonedTime(new Date(), RETURNING_TZ);
    const note = `Devolución registrada en sucursal: ${subsidiary}. Motivo: ${status || 'No especificado'}`;

    for (const s of shipments) {
      if (s.status === ShipmentStatusType.DEVUELTO_A_FEDEX) continue;
      await manager.update(Shipment, s.id, { status: ShipmentStatusType.DEVUELTO_A_FEDEX });
      await manager.save(
        manager.create(ShipmentStatus, {
          status: ShipmentStatusType.DEVUELTO_A_FEDEX,
          exceptionCode: '',
          notes: note,
          timestamp: utcDate,
          shipment: { id: s.id },
        }),
      );
    }

    for (const c of charges) {
      if (c.status === ShipmentStatusType.DEVUELTO_A_FEDEX) continue;
      await manager.update(ChargeShipment, c.id, { status: ShipmentStatusType.DEVUELTO_A_FEDEX });
      await manager.save(
        manager.create(ShipmentStatus, {
          status: ShipmentStatusType.DEVUELTO_A_FEDEX,
          exceptionCode: '',
          notes: note,
          timestamp: utcDate,
          chargeShipment: { id: c.id },
        }),
      );
    }

    return existingDevolution ? 'duplicate' : 'success';
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

    // Servicio NUEVO (read-only): trae SIEMPRE el último estatus fresco desde FedEx, sin
    // depender del pipeline legado ni escribir en BD. Sirve para shipment y charge por igual.
    const latest = await this.fedexStatusResolver.getLatestStatus(trackingNumber);
    if (!latest.validation.ok) {
      this.logger.warn(
        `Estatus FedEx de ${trackingNumber} con observaciones: ${latest.validation.issues.join('; ')}`,
      );
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

      // ¿Esta carga salió alguna vez a ruta? (para simetría con el shipment; el ingreso de la
      // carga va agrupado en la Charge —sin trackingNumber— así que la UI lo marca aparte).
      const wasDispatched = await this.packageDispatchHistoryRepository.exists({
        where: { chargeShipment: { id: chargeShipment.id } },
      });

      // Estatus/código EFECTIVOS: preferimos lo fresco de FedEx (resolver); si no lo trajo,
      // caemos a lo persistido en el charge.
      const effStatus = (latest.found && latest.status) || chargeShipment.status;
      const effException = latest.found ? latest.exceptionCode : chargeShipment.exceptionCode || null;

      const isProblematic =
        effStatus === ShipmentStatusType.NO_ENTREGADO &&
        ['03', '07', '08', '17'].includes(effException || '');

      if (isProblematic) {
        console.warn(
          `⚠️ ChargeShipment ${chargeShipment.trackingNumber} NO_ENTREGADO con excepción ${effException}`,
        );
      }

      return {
        id: chargeShipment.id,
        trackingNumber: chargeShipment.trackingNumber,
        status: effStatus,
        subsidiaryId: chargeShipment.subsidiary.id,
        subsidiaryName: chargeShipment.subsidiary.name,
        hasIncome: incomeExists,
        isCharge: true,
        wasDispatched,
        hasError: isProblematic ? true : false,
        errorMessage: isProblematic ? 'No tiene un dex registrado se debe revisar' : '',
        lastStatus: {
          type: effStatus || null,
          exceptionCode: effException || null,
          notes: latest.found ? latest.description : null,
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
    // 6. Estatus EFECTIVO: lo fresco de FedEx (resolver) manda; si no lo trajo, el último
    //    historial persistido. Así la validación SIEMPRE refleja el último estatus de FedEx.
    // ---------------------------------------------------------------

    const effStatus = (latest.found && latest.status) || latestShipment.status;
    const effException = latest.found
      ? latest.exceptionCode
      : lastStatus?.exceptionCode || null;
    const effNotes = latest.found ? latest.description : lastStatus?.notes ?? null;

    const isProblematic =
      effStatus === ShipmentStatusType.NO_ENTREGADO &&
      ['03', '07', '08', '17'].includes(effException || '');

    if (isProblematic) {
      console.warn(
        `⚠️ Shipment ${latestShipment.trackingNumber} NO_ENTREGADO con excepción ${effException}`,
      );
    }

    const incomeExists = await this.incomeRepository.exists({
      where: { trackingNumber },
    });

    // ¿La guía perteneció alguna vez a un package_dispatch (salida a ruta)? El ingreso de
    // shipment SOLO nace en el cierre de ruta; una guía devuelta que nunca salió a ruta nunca
    // generó ingreso, y eso es lo esperado (no una falla). Se revisa contra TODAS las filas de
    // la guía (una guía reciclada puede tener varios shipment). Caso frecuente en Bodega
    // Hermosillo, donde a veces el repartidor sale antes de que se registre el despacho.
    const shipmentIds = shipments.map((s) => s.id);
    const wasDispatched = await this.packageDispatchHistoryRepository.exists({
      where: { shipment: { id: In(shipmentIds) } },
    });

    // ---------------------------------------------------------------
    // 7. Resolver respuesta final
    // ---------------------------------------------------------------

    return {
      id: latestShipment.id,
      trackingNumber: latestShipment.trackingNumber,
      status: effStatus,
      subsidiaryId: latestShipment.subsidiary.id,
      subsidiaryName: latestShipment.subsidiary.name,
      hasIncome: incomeExists,
      isCharge: false,
      wasDispatched,
      hasError: isProblematic ? true : false,
      errorMessage: isProblematic ? 'No tiene un dex registrado se debe revisar' : '',
      lastStatus: {
        type: effStatus || null,
        exceptionCode: effException || null,
        notes: effNotes,
      },
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
