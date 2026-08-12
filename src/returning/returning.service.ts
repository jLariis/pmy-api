import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ReturningHistory } from 'src/entities/returning-history.entity';
import { Devolution } from 'src/entities/devolution.entity';
import { Collection } from 'src/entities';
import { DevolutionsService } from 'src/devolutions/devolutions.service';
import { CollectionsService } from 'src/collections/collections.service';
import { CreateReturningDto } from './dto/create-returning.dto';
import { PaginatedResult, parsePagination, resolveDateRange } from 'src/common/pagination.util';

@Injectable()
export class ReturningService {
  private readonly logger = new Logger(ReturningService.name);

  constructor(
    @InjectRepository(ReturningHistory)
    private readonly returningRepository: Repository<ReturningHistory>,
    private readonly dataSource: DataSource,
    private readonly devolutionsService: DevolutionsService,
    private readonly collectionsService: CollectionsService,
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
        date: dto.date ? new Date(dto.date) : new Date(),
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
        `Salida ${savedHistory.folio ?? savedHistory.id}: ` +
          `${devResult.success.length} devs, ${colResult.savedCollections.length} recos guardadas`,
      );

      return {
        id: savedHistory.id,
        folio: savedHistory.folio,
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
      // Búsqueda por folio (número de salida).
      qb.andWhere('CAST(rh.folio AS CHAR) LIKE :search', { search: `%${search}%` });
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
}
