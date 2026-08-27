import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ReturningHistory } from 'src/entities/returning-history.entity';
import { Devolution } from 'src/entities/devolution.entity';
import { Collection, Subsidiary } from 'src/entities';
import { EmailLog } from 'src/entities/email-log.entity';
import { DevolutionsService } from 'src/devolutions/devolutions.service';
import { CollectionsService } from 'src/collections/collections.service';
import { CreateReturningDto } from './dto/create-returning.dto';
import { PaginatedResult, parsePagination, resolveDateRange } from 'src/common/pagination.util';
import { EmailFile, EmailLogService } from 'src/email-log/email-log.service';
import { MailService } from 'src/mail/mail.service';
import { EmailStatus } from 'src/common/enums/email-status.enum';
import { hermosilloDayStartUtc } from 'src/common/utils';

const EMAIL_MODULE = 'returning';
const EMAIL_TYPE_RETURNING = 'returning';

export interface EmailActor {
  id?: string;
  name?: string;
}

@Injectable()
export class ReturningService {
  private readonly logger = new Logger(ReturningService.name);

  constructor(
    @InjectRepository(ReturningHistory)
    private readonly returningRepository: Repository<ReturningHistory>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
    private readonly dataSource: DataSource,
    private readonly devolutionsService: DevolutionsService,
    private readonly collectionsService: CollectionsService,
    private readonly emailLogService: EmailLogService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Crea una "Salida" (lote) con sus devoluciones y recolecciones en UNA sola transacción.
   * Los duplicados / no encontrados se saltan y se reportan (no abortan la salida); solo un
   * error inesperado hace rollback de todo el lote.
   */
  async create(dto: CreateReturningDto, userId?: string) {
    if (!dto.subsidiaryId) {
      throw new BadRequestException('La sucursal (subsidiaryId) es obligatoria.');
    }

    const devolutionItems = dto.devolutions ?? [];
    const collectionItems = dto.collections ?? [];
    if (devolutionItems.length === 0 && collectionItems.length === 0) {
      throw new BadRequestException('La salida no contiene devoluciones ni recolecciones.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const manager = queryRunner.manager;

      // 1. Crear el lote (cabecera).
      const history = manager.create(ReturningHistory, {
        // `dto.date` es un día-calendario flotante de un <input type="date"> ("2026-08-20").
        // `new Date(str)` lo tomaría como MEDIANOCHE UTC (00:00Z), que pintado en Hermosillo
        // (UTC-7) retrocede al día anterior — el bug de "salen con fecha de un día antes".
        // Lo anclamos a la medianoche de Hermosillo (= 07:00Z), igual que ingresos/KPIs. Sin
        // fecha (el usuario no eligió día), se usa el instante actual.
        date: dto.date ? hermosilloDayStartUtc(dto.date) : new Date(),
        subsidiaryId: dto.subsidiaryId,
        vehicleId: dto.vehicleId ?? null,
        createdById: userId ?? null,
        drivers: (dto.driverIds ?? []).map((id) => ({ id } as any)),
        devolutionsCount: 0,
        collectionsCount: 0,
      });
      const savedHistory = await manager.save(history);

      // 2. Devoluciones (reusa la lógica de consolidados; enlazadas al lote).
      const devResult = { success: [] as string[], duplicates: [] as string[], notFound: [] as string[] };
      for (const item of devolutionItems) {
        const outcome = await this.devolutionsService.processOneDevolution(
          manager,
          {
            trackingNumber: item.trackingNumber,
            subsidiary: { id: dto.subsidiaryId } as any,
            status: item.status,
            reason: item.reason,
          },
          { userId, returningHistoryId: savedHistory.id },
        );
        if (outcome === 'success') devResult.success.push(item.trackingNumber);
        else if (outcome === 'duplicate') devResult.duplicates.push(item.trackingNumber);
        else devResult.notFound.push(item.trackingNumber);
      }

      // 3. Recolecciones (reusa el guardado + ingresos; enlazadas al lote).
      const colResult = collectionItems.length
        ? await this.collectionsService.saveCollectionsWithManager(
            manager,
            collectionItems.map((c) => ({
              trackingNumber: c.trackingNumber,
              subsidiary: { id: dto.subsidiaryId } as any,
              status: c.status,
              isPickUp: c.isPickUp,
              date: c.date,
            })),
            { userId, returningHistoryId: savedHistory.id },
          )
        : { savedCollections: [], duplicates: [] };

      // 4. Contadores reales de lo guardado.
      savedHistory.devolutionsCount = devResult.success.length;
      savedHistory.collectionsCount = colResult.savedCollections.length;
      await manager.save(savedHistory);

      await queryRunner.commitTransaction();
      this.logger.log(
        `Salida ${savedHistory.trackingNumber ?? savedHistory.id}: ` +
          `${devResult.success.length} devs, ${colResult.savedCollections.length} recos guardadas`,
      );

      return {
        id: savedHistory.id,
        trackingNumber: savedHistory.trackingNumber,
        devolutions: devResult,
        collections: {
          saved: colResult.savedCollections.map((c) => c.trackingNumber),
          duplicates: colResult.duplicates,
        },
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error creando salida: ${error.message}`, error.stack);
      throw new BadRequestException(`No se pudo guardar la salida: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Listado de salidas de una sucursal, PAGINADO y filtrado por semana en backend (evita cargar
   * todo el histórico). Mismo contrato que los demás listados de operaciones: from/to/page/limit/search.
   * Usa paginación a nivel de ENTIDAD (take/skip) para que el join M2M de choferes no rompa el conteo.
   */
  async findBySubsidiary(
    subsidiaryId: string,
    opts: { page?: string | number; limit?: string | number; from?: string; to?: string; search?: string } = {},
  ): Promise<PaginatedResult<ReturningHistory>> {
    const { start, end } = resolveDateRange(opts.from, opts.to);
    const { page, limit, skip } = parsePagination(opts.page, opts.limit);
    const search = (opts.search || '').trim();

    const qb = this.returningRepository
      .createQueryBuilder('rh')
      .leftJoinAndSelect('rh.drivers', 'drivers')
      .leftJoinAndSelect('rh.vehicle', 'vehicle')
      .leftJoinAndSelect('rh.subsidiary', 'subsidiary')
      .where('rh.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('rh.date BETWEEN :start AND :end', { start, end });

    if (search) {
      // Búsqueda por número de rastreo de la salida.
      qb.andWhere('rh.trackingNumber LIKE :search', { search: `%${search}%` });
    }

    const [data, total] = await qb
      .orderBy('rh.date', 'DESC')
      .take(limit)
      .skip(skip)
      .getManyAndCount();

    return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** Detalle de una salida: cabecera + devoluciones y recolecciones que agrupa. */
  async findOneDetail(id: string) {
    const history = await this.returningRepository.findOne({
      where: { id },
      relations: { drivers: true, vehicle: true, subsidiary: true },
    });
    if (!history) {
      throw new BadRequestException(`No se encontró la salida ${id}.`);
    }

    const [devolutions, collections] = await Promise.all([
      this.dataSource.getRepository(Devolution).find({
        where: { returningHistory: { id } },
        order: { date: 'DESC' },
      }),
      this.dataSource.getRepository(Collection).find({
        where: { returningHistory: { id } },
        order: { createdAt: 'DESC' },
      }),
    ]);

    return { ...history, devolutions, collections };
  }

  // ============================ CORREO ============================

  /**
   * Envía (o reenvía) el correo de una salida: guarda los adjuntos en disco, envía, registra el
   * intento en la bitácora genérica (module='returning') y actualiza el estado denormalizado.
   * Espejo de package-dispatch.
   */
  async sendByEmail(
    pdfFile: Express.Multer.File,
    excelFile: Express.Multer.File,
    subsidiaryName: string,
    returningHistoryId: string,
    actor?: EmailActor,
    isResend = false,
  ) {
    const salida = await this.returningRepository.findOne({
      where: { id: returningHistoryId },
      relations: { subsidiary: true },
    });
    if (!salida) {
      throw new BadRequestException(`No se encontró la salida ${returningHistoryId}.`);
    }

    const subsidiary =
      salida.subsidiary ??
      (salida.subsidiaryId ? await this.subsidiaryRepository.findOneBy({ id: salida.subsidiaryId }) : null);
    if (!subsidiary) {
      throw new BadRequestException(`La salida ${returningHistoryId} no tiene sucursal para el correo.`);
    }

    const attachments: EmailFile[] = [
      { filename: pdfFile.originalname, content: pdfFile.buffer, mimeType: pdfFile.mimetype },
      { filename: excelFile.originalname, content: excelFile.buffer, mimeType: excelFile.mimetype },
    ];

    // Guardar SIEMPRE los adjuntos en disco (aunque el correo falle) para poder reenviar.
    try {
      await this.emailLogService.persistAttachments(EMAIL_MODULE, returningHistoryId, attachments);
    } catch (e: any) {
      this.logger.warn(`No se pudieron guardar los adjuntos de la salida ${returningHistoryId}: ${e?.message}`);
    }

    return this.sendAndTrack(salida, subsidiary, subsidiaryName, attachments, { isResend, actor });
  }

  /** Historial de envíos de correo de una salida. */
  async getEmailHistory(returningHistoryId: string): Promise<EmailLog[]> {
    return this.emailLogService.getHistory(EMAIL_MODULE, returningHistoryId);
  }

  /** Envía, registra en bitácora y actualiza el estado denormalizado. No relanza. */
  private async sendAndTrack(
    salida: ReturningHistory,
    subsidiary: Subsidiary,
    subsidiaryName: string,
    attachments: EmailFile[],
    opts: { isResend: boolean; actor?: EmailActor },
  ): Promise<{ status: EmailStatus; error?: string; to?: string }> {
    const attachmentsMeta = attachments.map((a) => ({ filename: a.filename, size: a.content.length }));
    const meta = {
      module: EMAIL_MODULE,
      emailType: EMAIL_TYPE_RETURNING,
      entityId: salida.id,
      referenceTracking: salida.trackingNumber ?? null,
      subsidiaryId: subsidiary.id,
      subsidiaryName: subsidiary.name ?? subsidiaryName ?? null,
      isResend: opts.isResend,
      triggeredById: opts.actor?.id ?? null,
      triggeredByName: opts.actor?.name ?? null,
      attachmentsMeta,
    };

    try {
      const result = await this.mailService.sendHighPriorityDevolutionsEmailTracked(
        attachments.map((a) => ({ filename: a.filename, content: a.content })),
        subsidiary,
      );

      const hasRejections = result.rejected.length > 0;
      const status = hasRejections ? EmailStatus.ERROR : EmailStatus.SENT;
      const error = hasRejections ? `Direcciones rechazadas: ${result.rejected.join(', ')}` : null;

      await this.emailLogService.record({
        ...meta,
        to: result.to,
        cc: result.cc,
        subject: result.subject,
        status,
        error,
        messageId: result.messageId,
        rejected: result.rejected,
      });
      await this.updateEmailStatus(salida.id, status, error);
      return { status, error: error ?? undefined, to: result.to };
    } catch (e: any) {
      const message = e?.message ?? String(e);
      this.logger.error(`Fallo al enviar correo de salida ${salida.id}: ${message}`);
      await this.emailLogService.record({
        ...meta,
        to: '',
        subject: `Salida de Devoluciones y Recolecciones ${salida.trackingNumber ?? ''}`.trim(),
        status: EmailStatus.ERROR,
        error: message,
      });
      await this.updateEmailStatus(salida.id, EmailStatus.ERROR, message);
      return { status: EmailStatus.ERROR, error: message };
    }
  }

  private async updateEmailStatus(id: string, status: EmailStatus, error: string | null): Promise<void> {
    await this.returningRepository.update(id, {
      emailStatus: status,
      emailLastSentAt: new Date(),
      emailLastError: error ? error.slice(0, 500) : null,
    });
  }

  // ============================ KPIs ============================

  /** KPIs agregados por semana (nº salidas, devs, recos, correos enviados/pendientes). */
  async getKpis(subsidiaryId: string, opts: { from?: string; to?: string } = {}) {
    const { start, end } = resolveDateRange(opts.from, opts.to);
    const raw = await this.returningRepository
      .createQueryBuilder('rh')
      .select('COUNT(*)', 'salidas')
      .addSelect('COALESCE(SUM(rh.devolutionsCount), 0)', 'devoluciones')
      .addSelect('COALESCE(SUM(rh.collectionsCount), 0)', 'recolecciones')
      .addSelect("SUM(CASE WHEN rh.emailStatus = 'sent' THEN 1 ELSE 0 END)", 'correosEnviados')
      .addSelect("SUM(CASE WHEN rh.emailStatus <> 'sent' THEN 1 ELSE 0 END)", 'correosPendientes')
      .where('rh.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('rh.date BETWEEN :start AND :end', { start, end })
      .getRawOne();

    return {
      salidas: Number(raw?.salidas ?? 0),
      devoluciones: Number(raw?.devoluciones ?? 0),
      recolecciones: Number(raw?.recolecciones ?? 0),
      correosEnviados: Number(raw?.correosEnviados ?? 0),
      correosPendientes: Number(raw?.correosPendientes ?? 0),
    };
  }
}
