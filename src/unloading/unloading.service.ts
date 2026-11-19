import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { daysWithoutLocalScan, latestLocalScan, LocalScan, localScanCategory, LOCAL_SCAN_CODES_SQL } from 'src/utils/local-scan-visibility.util';
import { CreateUnloadingDto } from './dto/create-unloading.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Unloading } from 'src/entities/unloading.entity';
import { Between, DataSource, In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { pickScanCandidate } from 'src/common/scan-candidate.util';
import { PaginatedResult, parsePagination, resolveDateRange } from 'src/common/pagination.util';
import { Charge, ChargeShipment, Consolidated, Shipment, ShipmentStatus } from 'src/entities';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { ValidatedUnloadingDto } from './dto/validate-package-unloading.dto';
import { MailService } from 'src/mail/mail.service';
import { ConsolidatedType } from 'src/common/enums/consolidated-type.enum';
import { ConsolidatedItemDto, ConsolidatedsDto, ShortShipmentInfo } from './dto/consolidated.dto';
import { ShipmentStatusType, TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';
import { UnloadingReportDto } from './dto/unloading-report.dto';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { fromZonedTime } from 'date-fns-tz';
import { ValidationPayloadDto } from './dto/validate-payload.dto';
import { TemplateService } from 'src/documents/template.service';
import { buildUnloadingData, UnloadingInput, UnloadingPackage } from 'src/documents/data/unloading.mapper';
import { ConsolidatedInitItemDto, UnloadingSessionInitDto } from './dto/unloading-session-init.dto';
import { ValidatedOneDto } from './dto/validate-one.dto';
import { assertSubsidiaryAccess, finalStatusReason, looksLikePdf, looksLikeXlsx, normalizeClientRequestId, safeAttachmentName, UnloadingUser } from './unloading-access.util';


@Injectable()
export class UnloadingService {
  private readonly logger = new Logger(UnloadingService.name);

  constructor(
    @InjectRepository(Unloading)
    private readonly unloadingRepository: Repository<Unloading>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(Consolidated)
    private readonly consolidatedReporsitory: Repository<Consolidated>,
    @InjectRepository(Charge)
    private readonly chargeRepository: Repository<Charge>,
    private readonly mailService: MailService,
    @Inject(forwardRef(() => ShipmentsService))
    private readonly shipmentService: ShipmentsService,
    @InjectRepository(ShipmentStatus)
    private readonly shipmentStatusRepository: Repository<ShipmentStatus>,
    private readonly dataSource: DataSource,
    private readonly templateService: TemplateService,
  ) {}

  /**
   * Reporte de VISIBILIDAD 67 sobre los DESEMBARQUES de una sucursal en un rango
   * (por defecto "ayer"). Igual que el de inventarios pero SIN filtrar por estatus
   * (muestra todos: entregado/DEX/en ruta/bodega/etc.), centrado en si tienen 67.
   * Optimizado: no hidrata statusHistory (eso causaba OOM); junta paquetes vía la
   * FK unloadingId y calcula el 67 con un agregado aparte.
   */
  async getUnloadingVisibilityReport(subsidiaryId: string, from: Date, to: Date) {
    const start = new Date(from); start.setHours(0, 0, 0, 0);
    const end = new Date(to); end.setHours(23, 59, 59, 999);

    // 1) Desembarques del rango (por COALESCE(date, createdAt), date es nullable).
    const unls: any[] = await this.unloadingRepository.createQueryBuilder('u')
      .leftJoin('u.subsidiary', 'sub')
      .where('sub.id = :subsidiaryId', { subsidiaryId })
      .andWhere('COALESCE(u.date, u.createdAt) BETWEEN :start AND :end', { start, end })
      .select('u.id', 'id').addSelect('u.date', 'date').addSelect('u.createdAt', 'createdAt')
      .orderBy('COALESCE(u.date, u.createdAt)', 'ASC')
      .getRawMany();
    if (unls.length === 0) {
      return { summary: { desembarques: 0, paquetes: 0, con67Hoy: 0, sin67: 0, nunca: 0 }, details: [] };
    }
    const unlIds = unls.map((u) => u.id);
    const unlMeta = new Map(unls.map((u) => [u.id, { date: u.date ?? u.createdAt }]));

    // 2) Paquetes por desembarque (FK unloadingId), solo columnas (sin statusHistory).
    const PKG_COLS: [string, string][] = [
      ['trackingNumber', 'trackingNumber'], ['status', 'status'],
      ['recipientName', 'recipientName'], ['recipientAddress', 'recipientAddress'],
      ['recipientCity', 'recipientCity'], ['recipientZip', 'recipientZip'],
      ['shipmentType', 'shipmentType'], ['fedexUniqueId', 'fedexUniqueId'], ['createdAt', 'createdAt'],
    ];
    const buildPkgQuery = (repo: Repository<any>, alias: string) => {
      const qb = repo.createQueryBuilder(alias)
        .leftJoin(`${alias}.unloading`, 'u')
        .where('u.id IN (:...unlIds)', { unlIds })
        // Solo FedEx: el 44/67 es de FedEx; DHL nunca se mezcla en estos reportes.
        .andWhere(`${alias}.shipmentType = 'fedex'`)
        .select(`${alias}.id`, 'id')
        .addSelect('u.id', 'unloadingId');
      for (const [col, as] of PKG_COLS) qb.addSelect(`${alias}.${col}`, as);
      return qb.getRawMany();
    };
    const [shipRows, chargeRows] = await Promise.all([
      buildPkgQuery(this.shipmentRepository, 's'),
      buildPkgQuery(this.chargeShipmentRepository, 'cs'),
    ]);

    // 3) Último 67 por paquete — agregado sobre shipment_status (chunked).
    const chunk = <T,>(arr: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
    const max67By = async (ids: string[], fkCol: string): Promise<Map<string, LocalScan>> => {
      const m = new Map<string, LocalScan>();
      for (const part of chunk([...new Set(ids)], 1000)) {
        if (part.length === 0) continue;
        const ph = part.map(() => '?').join(',');
        const rows: any[] = await this.dataSource.query(
          // 44 o 67: el escaneo local lo dice FedEx (satélites de Obregón: config 67, FedEx manda 44).
          `SELECT ${fkCol} AS id, MAX(timestamp) AS m,
                  SUBSTRING_INDEX(MAX(CONCAT(timestamp, '|', exceptionCode)), '|', -1) AS code
             FROM shipment_status
            WHERE ${fkCol} IN (${ph}) AND exceptionCode IN ${LOCAL_SCAN_CODES_SQL}
            GROUP BY ${fkCol}`,
          part,
        );
        for (const r of rows) if (r.id && r.m) m.set(String(r.id), { at: new Date(r.m), code: String(r.code) === '44' ? '44' : '67' });
      }
      return m;
    };
    const [ship67, charge67] = await Promise.all([
      max67By(shipRows.map((r) => r.id), 'shipmentId'),
      max67By(chargeRows.map((r) => r.id), 'chargeShipmentId'),
    ]);

    // 4) Agregar por guía (dedup) — SIN filtro de estatus (todos los estatus).
    type Agg = { rep: any; isCharge: boolean; max67: LocalScan | null; minCreatedAt: Date; unloadings: { unloadingId: string; date: Date }[] };
    const byGuide = new Map<string, Agg>();
    const ingest = (row: any, isCharge: boolean, max67Map: Map<string, LocalScan>) => {
      if (!row?.trackingNumber) return;
      const meta = unlMeta.get(row.unloadingId);
      if (!meta) return;
      const max67 = max67Map.get(String(row.id)) ?? null;
      const createdAt = new Date(row.createdAt);
      const ref = { unloadingId: row.unloadingId, date: meta.date };
      const existing = byGuide.get(row.trackingNumber);
      if (!existing) {
        byGuide.set(row.trackingNumber, { rep: row, isCharge, max67, minCreatedAt: createdAt, unloadings: [ref] });
      } else {
        if (createdAt > new Date(existing.rep.createdAt)) existing.rep = row;
        existing.isCharge = existing.isCharge || isCharge;
        existing.max67 = latestLocalScan(existing.max67, max67);
        if (createdAt < existing.minCreatedAt) existing.minCreatedAt = createdAt;
        if (!existing.unloadings.some((u) => u.unloadingId === row.unloadingId)) existing.unloadings.push(ref);
      }
    };
    shipRows.forEach((r) => ingest(r, false, ship67));
    chargeRows.forEach((r) => ingest(r, true, charge67));

    const now = new Date();
    // Días sin código = días COMPLETOS sin escaneo en hora Hermosillo (escaneada anoche = al día).
    const details = Array.from(byGuide.values()).map(({ rep, isCharge, max67, minCreatedAt, unloadings }) => {
      const daysSinceLast67 = daysWithoutLocalScan(max67?.at ?? null, now);
      const cat = localScanCategory(daysSinceLast67);
      const category = cat === 'sinCodigo' ? 'sin67' : cat;
      const sorted = [...unloadings].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      return {
        trackingNumber: rep.trackingNumber,
        status: rep.status,
        recipientName: rep.recipientName,
        recipientAddress: rep.recipientAddress,
        recipientCity: rep.recipientCity,
        recipientZip: rep.recipientZip,
        shipmentType: rep.shipmentType,
        fedexUniqueId: rep.fedexUniqueId,
        isCharge,
        createdAt: minCreatedAt.toISOString(),
        scanCode: max67?.code ?? null, // último código que dio FedEx (44 o 67); null = nunca
        last67Date: max67 ? max67.at.toISOString() : null, // último escaneo local (44 o 67)
        daysSinceLast67,
        has67Today: category === 'hoy',
        category,
        unloadings: sorted,
        unloadingCount: sorted.length,
      };
    });

    details.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const con67Hoy = details.filter((d) => d.category === 'hoy').length;
    const nunca = details.filter((d) => d.category === 'nunca').length;

    return {
      summary: { desembarques: unls.length, paquetes: details.length, con67Hoy, sin67: details.length - con67Hoy, nunca },
      details,
    };
  }

  async getConsolidateToStartUnloading(subdiaryId: string): Promise<ConsolidatedsDto> {
    const timeZone = "America/Hermosillo";

    // Fecha actual en zona local
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const [{ value: y }, , { value: m }, , { value: d }] = fmt.formatToParts(now);
    const todayStr = `${y}-${m}-${d}`;

    // Día actual (0 = domingo, 1 = lunes, ..., 6 = sábado)
    const dayOfWeek = new Date(`${todayStr}T00:00:00`).getDay();

    // Crear fechas base en zona local
    const todayLocal = new Date(`${todayStr}T00:00:00`);
    const startDate = new Date(todayLocal);
    const endDate = new Date(todayLocal);

    // Ventana ampliada para que "consolidados nuevos" no se queden fuera por
    // desfases de fecha/zona horaria (la fecha del consolidado puede venir del
    // manifiesto y no del momento de carga). Si es lunes retrocede al viernes.
    // Nota: la búsqueda directa por consNumber es el escape definitivo cuando un
    // consolidado cae fuera de esta ventana.
    if (dayOfWeek === 1) {
      startDate.setDate(startDate.getDate() - 4); // lunes: cubre desde el jueves
    } else {
      startDate.setDate(startDate.getDate() - 2); // resto: antier
    }

    // Incluir hasta pasado mañana para cubrir consolidados con fecha adelantada.
    endDate.setDate(endDate.getDate() + 2);

    // 🔥 Consulta usando el rango ajustado
    const consolidatedT = await this.consolidatedReporsitory.find({
      where: {
        date: Between(startDate, endDate),
        subsidiary: { id: subdiaryId },
      },
    });

    const f2Consolidated = []

    const consolidateds: ConsolidatedsDto = {
      airConsolidated: consolidatedT
        .filter(c => c.type === ConsolidatedType.AEREO)
        .map(c => ({
          ...c,
          type: "Áereo",
          typeCode: "AER",
          added: [],
          notFound: [],
          color: "text-green-600 bg-green-100",
        })),

      groundConsolidated: consolidatedT
        .filter(c => c.type === ConsolidatedType.ORDINARIA)
        .map(c => ({
          ...c,
          type: "Terrestre",
          typeCode: "TER",
          added: [],
          notFound: [],
          color: "text-blue-600 bg-blue-100",
        })),

      f2Consolidated: f2Consolidated.map(c => ({
        ...c,
        type: "F2/Carga/31.5",
        typeCode: "F2",
        added: [],
        notFound: [],
        color: "text-orange-600 bg-orange-100",
      })),
    };

    return consolidateds;
  }

  /**
   * Universo ESPERADO por consolidado (base del conteo de faltantes en el cliente).
   * Es estático durante la sesión: la membresía de un consolidado no cambia al escanear.
   * DHL-aware y con dedup por guía (registro más reciente).
   */
  private async getExpectedMembersByConsolidated(
    consolidateds: ConsolidatedItemDto[],
  ): Promise<Map<string, ShortShipmentInfo[]>> {
    const result = new Map<string, ShortShipmentInfo[]>();

    const toShort = (item: any): ShortShipmentInfo => ({
      trackingNumber: item.trackingNumber,
      dhlUniqueId: item.dhlUniqueId ?? undefined,
      recipientName: item.recipientName,
      recipientAddress: item.recipientAddress,
      recipientPhone: item.recipientPhone,
      recipientZip: item.recipientZip,
    });

    const nonF2 = consolidateds.filter((c) => c.typeCode !== 'F2');
    const f2 = consolidateds.filter((c) => c.typeCode === 'F2');

    if (nonF2.length > 0) {
      const ids = nonF2.map((c) => c.id);
      const [shipments, charges] = await Promise.all([
        this.shipmentRepository.find({
          where: { consolidatedId: In(ids), status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
          select: ['trackingNumber', 'dhlUniqueId', 'consolidatedId', 'recipientName', 'recipientAddress', 'recipientPhone', 'recipientZip', 'createdAt'],
          order: { createdAt: 'DESC' },
        }),
        this.chargeShipmentRepository.find({
          where: { consolidatedId: In(ids), status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
          select: ['trackingNumber', 'consolidatedId', 'recipientName', 'recipientAddress', 'recipientPhone', 'recipientZip', 'createdAt'],
          order: { createdAt: 'DESC' },
        }),
      ]);

      const byShip = this.groupByConsolidatedId(shipments);
      const byCharge = this.groupByConsolidatedId(charges);

      for (const c of nonF2) {
        const all = [...(byShip.get(c.id) || []), ...(byCharge.get(c.id) || [])];
        result.set(c.id, this.removeDuplicateTNs(all).map(toShort));
      }
    }

    if (f2.length > 0) {
      const ids = f2.map((c) => c.id);
      const charges = await this.chargeShipmentRepository.find({
        where: { charge: { id: In(ids) }, status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
        relations: ['charge'],
        select: ['trackingNumber', 'recipientName', 'recipientAddress', 'recipientPhone', 'recipientZip', 'createdAt'],
        order: { createdAt: 'DESC' },
      });
      const byCharge = new Map<string, any[]>();
      for (const cs of charges) {
        const key = (cs as any).charge?.id;
        if (!key) continue;
        if (!byCharge.has(key)) byCharge.set(key, []);
        byCharge.get(key)!.push(cs);
      }
      for (const c of f2) {
        const all = byCharge.get(c.id) || [];
        result.set(c.id, this.removeDuplicateTNs(all).map(toShort));
      }
    }

    return result;
  }

  /**
   * Inicializa una sesión de desembarque: consolidados del día + su universo
   * esperado completo (para que el cliente cuente faltantes/escaneados sin volver
   * a la BD ni reenviar la lista en cada escaneo). Solo lectura.
   */
  async getUnloadingSessionInit(subsidiaryId: string): Promise<UnloadingSessionInitDto> {
    const consolidateds = await this.getConsolidateToStartUnloading(subsidiaryId);
    const all: ConsolidatedItemDto[] = Object.values(consolidateds).flat();
    const expectedMap = await this.getExpectedMembersByConsolidated(all);

    const map = (arr: ConsolidatedItemDto[]): ConsolidatedInitItemDto[] =>
      arr.map((c) => ({
        id: c.id,
        type: c.type,
        typeCode: c.typeCode,
        numberOfPackages: (c as any).numberOfPackages ?? 0,
        consNumber: (c as any).consNumber ?? undefined,
        color: c.color,
        expected: expectedMap.get(c.id) || [],
      }));

    return {
      airConsolidated: map(consolidateds.airConsolidated),
      groundConsolidated: map(consolidateds.groundConsolidated),
      f2Consolidated: map(consolidateds.f2Consolidated),
    };
  }

  /** Presentación (type/typeCode/color) de un consolidado según su tipo. */
  private consolidatedPresentation(type: ConsolidatedType): { type: string; typeCode: string; color: string } {
    if (type === ConsolidatedType.AEREO) {
      return { type: 'Áereo', typeCode: 'AER', color: 'text-green-600 bg-green-100' };
    }
    return { type: 'Terrestre', typeCode: 'TER', color: 'text-blue-600 bg-blue-100' };
  }

  /**
   * Búsqueda directa por número de consolidado (consulta a BD, con alcance por
   * sucursal) para desembarque. Devuelve el consolidado con su universo esperado
   * en el MISMO formato que session-init, para que el cliente lo agregue a la lista
   * y lo seleccione. Es el escape cuando un consolidado no aparece por la ventana
   * de fechas o por caché.
   */
  async getUnloadingConsolidatedByConsNumber(
    subsidiaryId: string,
    consNumber: string,
  ): Promise<ConsolidatedInitItemDto | null> {
    const norm = (consNumber || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!norm) return null;

    const qb = this.consolidatedReporsitory
      .createQueryBuilder('c')
      .where('TRIM(UPPER(c.consNumber)) = :norm', { norm });
    if (subsidiaryId) qb.andWhere('c.subsidiaryId = :sid', { sid: subsidiaryId });

    const consolidated = await qb.orderBy('c.createdAt', 'DESC').getOne();
    if (!consolidated) return null;

    const presentation = this.consolidatedPresentation(consolidated.type);
    const item: ConsolidatedItemDto = {
      id: consolidated.id,
      ...presentation,
      added: [],
      notFound: [],
    };

    const expectedMap = await this.getExpectedMembersByConsolidated([item]);

    return {
      id: consolidated.id,
      type: presentation.type,
      typeCode: presentation.typeCode,
      numberOfPackages: consolidated.numberOfPackages ?? 0,
      consNumber: consolidated.consNumber ?? undefined,
      color: presentation.color,
      expected: expectedMap.get(consolidated.id) || [],
    };
  }


  /**
   * Guarda el desembarque y pasa sus guías a "En bodega" (en una transacción).
   *
   * Integridad (2026-11-18):
   * - Folio de captura (`clientRequestId`): si llega dos veces (reintento de red, doble pestaña)
   *   se regresa el desembarque que ya existe en vez de crear otro.
   * - Todas las guías deben ser de la sucursal del desembarque (antes no se revisaba).
   * - Guías en estatus FINAL (entregada / devuelta) no se tocan: se saltan y se reportan en
   *   `skippedFinal` (antes se regresaban a "En bodega").
   * - Unidad y sucursal se toman por id (antes se guardaba el objeto que mandaba el cliente).
   */
  async create(createUnloadingDto: CreateUnloadingDto, userId?: string) {
    const subsidiaryId = createUnloadingDto.subsidiary?.id;
    if (!subsidiaryId) throw new BadRequestException('Falta la sucursal del desembarque.');
    const vehicleId = createUnloadingDto.vehicle?.id ?? null;
    const clientRequestId = normalizeClientRequestId(createUnloadingDto.clientRequestId);
    const allShipmentIds = Array.from(new Set(createUnloadingDto.shipments ?? []));
    if (allShipmentIds.length === 0) throw new BadRequestException('No hay guías para desembarcar.');

    if (clientRequestId) {
      const existing = await this.unloadingRepository.findOne({ where: { clientRequestId } });
      if (existing) {
        this.logger.warn(`Desembarque repetido (folio de captura ${clientRequestId}); se regresa ${existing.id}`);
        return { ...existing, duplicate: true, skippedFinal: [] as { trackingNumber: string; reason: string }[] };
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Búsqueda de registros existentes (con su sucursal para revisar a quién pertenecen)
      const shipments = await queryRunner.manager.find(Shipment, {
        where: { id: In(allShipmentIds) },
        relations: ['subsidiary'],
      });

      const foundShipmentIds = new Set(shipments.map(s => s.id));
      const missingIds = allShipmentIds.filter(id => !foundShipmentIds.has(id));

      const chargeShipments = missingIds.length
        ? await queryRunner.manager.find(ChargeShipment, { where: { id: In(missingIds) }, relations: ['subsidiary'] })
        : [];

      const foundChargeShipmentIds = new Set(chargeShipments.map(s => s.id));
      const stillMissing = missingIds.filter(id => !foundChargeShipmentIds.has(id));

      if (stillMissing.length > 0) {
        throw new BadRequestException(`${stillMissing.length} guía(s) ya no existen en el sistema. Vuelve a escanearlas.`);
      }

      // 2. Todas deben ser de la sucursal del desembarque.
      const foreign = [...shipments, ...chargeShipments].filter(s => (s as any).subsidiary?.id !== subsidiaryId);
      if (foreign.length > 0) {
        const list = foreign.slice(0, 10).map(s => s.trackingNumber).join(', ');
        throw new BadRequestException(
          `Estas guías no son de la sucursal: ${list}${foreign.length > 10 ? ` y ${foreign.length - 10} más` : ''}.`,
        );
      }

      // 3. Estatus finales: no se tocan.
      const skippedFinal: { trackingNumber: string; reason: string }[] = [];
      const keep = <T extends { status?: any; trackingNumber: string }>(list: T[]) =>
        list.filter(item => {
          const why = finalStatusReason(item.status);
          if (why) skippedFinal.push({ trackingNumber: item.trackingNumber, reason: why });
          return !why;
        });
      const shipmentsToUpdate = keep(shipments);
      const chargesToUpdate = keep(chargeShipments);

      if (shipmentsToUpdate.length + chargesToUpdate.length === 0) {
        throw new BadRequestException('Todas las guías ya estaban entregadas o devueltas; no hay nada que desembarcar.');
      }

      // 4. Crear y guardar el desembarque
      const newUnloading = queryRunner.manager.create(Unloading, {
        vehicle: vehicleId ? ({ id: vehicleId } as any) : null,
        subsidiary: { id: subsidiaryId } as any,
        missingTrackings: createUnloadingDto.missingTrackings ?? [],
        unScannedTrackings: createUnloadingDto.unScannedTrackings ?? [],
        date: new Date(),
        createdById: userId ?? null,
        clientRequestId,
      });
      const savedUnloading = await queryRunner.manager.save(newUnloading);

      const now = new Date();

      // 5. Actualizaciones e historial (masivo)
      const processUpdates = async (
        entities: any[],
        entityClass: any,
        relationKey: 'shipment' | 'chargeShipment',
        noteSuffix: string,
      ) => {
        if (entities.length === 0) return;
        const ids = entities.map(e => e.id);

        await queryRunner.manager.update(entityClass, { id: In(ids) }, {
          status: ShipmentStatusType.EN_BODEGA,
          unloading: { id: savedUnloading.id },
        });

        const historyRecords = entities.map(item =>
          queryRunner.manager.create(ShipmentStatus, {
            status: ShipmentStatusType.EN_BODEGA,
            notes: `Ingreso a bodega mediante desembarque (Folio: ${savedUnloading.id}) ${noteSuffix}`,
            timestamp: now,
            [relationKey]: { id: item.id },
          }),
        );
        await queryRunner.manager.save(ShipmentStatus, historyRecords);
      };

      await processUpdates(shipmentsToUpdate, Shipment, 'shipment', '');
      await processUpdates(chargesToUpdate, ChargeShipment, 'chargeShipment', '(F2)');

      await queryRunner.commitTransaction();

      this.logger.log(
        `Desembarque exitoso. Folio: ${savedUnloading.id}. Paquetes: ${shipmentsToUpdate.length + chargesToUpdate.length}` +
          (skippedFinal.length ? `. Saltadas por estatus final: ${skippedFinal.length}` : ''),
      );
      return { ...savedUnloading, duplicate: false, skippedFinal };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      // Carrera con el mismo folio de captura (dos envíos a la vez): regresa el que ganó.
      if (clientRequestId && (error as any)?.code === 'ER_DUP_ENTRY') {
        const existing = await this.unloadingRepository.findOne({ where: { clientRequestId } });
        if (existing) return { ...existing, duplicate: true, skippedFinal: [] };
      }
      this.logger.error(`Error en Create Unloading: ${(error as any)?.message}`, (error as any)?.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async validatePackageResp(
    packageToValidate: ValidatedPackageDispatchDto,
    subsidiaryId: string
  ): Promise<ValidatedPackageDispatchDto> {
    let isValid = true;
    let reason = '';

    // Antes tronaba (500) si la guía no tenía sucursal (subsidiary null).
    // Las guías en estatus final (entregada/devuelta) SÍ son válidas aquí: llegaron físicamente
    // y cuentan en su consolidado; al guardar, `create` las salta sin cambiarles el estatus.
    const ownerId = (packageToValidate as any)?.subsidiary?.id ?? null;
    if (!ownerId) {
      isValid = false;
      reason = 'La guía no tiene sucursal asignada';
    } else if (ownerId !== subsidiaryId) {
      isValid = false;
      reason = 'Es de otra sucursal';
    }

    return {
      ...packageToValidate,
      isValid,
      reason
    };
  }

  /**
   * Valida UN tracking (espejo de inventories.validateTrackingNumber) para el
   * escaneo en vivo de desembarque. DHL-aware, registro más reciente, regla de
   * sucursal vía validatePackageResp. No recalcula consolidados.
   */
  async validateOne(trackingNumber: string, subsidiaryId: string): Promise<ValidatedOneDto> {
    const variants = this.dhlVariants(trackingNumber);

    // El registro MÁS RECIENTE, sin filtrar estatus: antes se saltaba el devuelto y tomaba un
    // registro viejo (que el desembarque revivía). Si el más reciente es final, no entra.
    const shipment = await this.shipmentRepository.findOne({
      where: [{ trackingNumber: In(variants) }, { dhlUniqueId: In(variants) }],
      relations: ['subsidiary', 'payment'],
      order: { createdAt: 'DESC' },
    });

    const charge = shipment
      ? null
      : await this.chargeShipmentRepository.findOne({
          where: { trackingNumber: In(variants) },
          relations: ['subsidiary', 'payment'],
          order: { createdAt: 'DESC' },
        });

    const record: any = shipment || charge;
    const isCharge = !shipment && !!charge;

    if (!record) {
      return {
        trackingNumber,
        isValid: false,
        isCharge: false,
        reason: 'La guía no existe en el sistema',
      };
    }

    const validated = await this.validatePackageResp({ ...record, isValid: false }, subsidiaryId);

    // De otra sucursal (o sin sucursal): NO se regresan datos del cliente ni el cobro.
    const ownerId = record?.subsidiary?.id ?? null;
    if (!ownerId || ownerId !== subsidiaryId) {
      return {
        trackingNumber: record.trackingNumber,
        dhlUniqueId: record.dhlUniqueId ?? undefined,
        isValid: false,
        isCharge,
        reason: validated.reason,
      };
    }

    return {
      id: record.id,
      trackingNumber: record.trackingNumber,
      dhlUniqueId: record.dhlUniqueId ?? undefined,
      isValid: validated.isValid,
      isCharge,
      reason: validated.reason,
      consolidatedId: record.consolidatedId,
      recipientName: record.recipientName,
      recipientAddress: record.recipientAddress,
      recipientPhone: record.recipientPhone,
      recipientZip: record.recipientZip,
      recipientCity: record.recipientCity ?? undefined,
      shipmentType: record.shipmentType ?? undefined,
      priority: record.priority,
      isHighValue: record.isHighValue,
      payment: record.payment,
      commitDateTime: record.commitDateTime,
      // Cuenta en el desembarque y en su consolidado, pero al procesar no cambia de estatus.
      alreadyFinal: finalStatusReason(record.status) ?? undefined,
    };
  }


  // ============ MÉTODOS HELPER ============

  private createMostRecentMap<T extends { trackingNumber: string; createdAt: Date }>(
    items: T[]
  ): Map<string, T> {
    const map = new Map<string, T>();

    for (const item of items) {
      const existing = map.get(item.trackingNumber);
      // Si no existe O el que estamos procesando es más nuevo que el guardado
      if (!existing || new Date(item.createdAt) > new Date(existing.createdAt)) {
        map.set(item.trackingNumber, item);
      }
    }

    return map;
  }

  /** Genera variantes JJD<->JD de un código DHL (incluye el original, en mayúsculas). */
  private dhlVariants(code?: string): string[] {
    const c = (code || '').trim().toUpperCase();
    if (!c) return [];
    const out = [c];
    if (c.startsWith('JJD')) out.push(c.substring(1)); // JJD... -> JD...
    else if (c.startsWith('JD')) out.push('J' + c); // JD... -> JJD...
    return out;
  }

  /**
   * Como createMostRecentMap pero indexa por trackingNumber Y dhlUniqueId,
   * incluyendo variantes JJD<->JD. Necesario para que el escaneo de guías DHL
   * encuentre la pieza aunque el lector entregue "JJD" y la BD guarde "JD".
   */
  private createDhlAwareMap<T extends { trackingNumber: string; createdAt: Date; dhlUniqueId?: string }>(
    items: T[]
  ): Map<string, T> {
    const map = new Map<string, T>();
    const setMostRecent = (key: string, item: T) => {
      const existing = map.get(key);
      if (!existing || new Date(item.createdAt) > new Date(existing.createdAt)) {
        map.set(key, item);
      }
    };
    for (const item of items) {
      [...this.dhlVariants(item.trackingNumber), ...this.dhlVariants((item as any).dhlUniqueId)]
        .forEach(k => setMostRecent(k, item));
    }
    return map;
  }


  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }


  private groupByConsolidatedId(items: any[]): Map<string, any[]> {
    const map = new Map<string, any[]>();
    items.forEach(item => {
      if (item.consolidatedId) {
        if (!map.has(item.consolidatedId)) {
          map.set(item.consolidatedId, []);
        }
        map.get(item.consolidatedId)!.push(item);
      }
    });
    return map;
  }


  /**
   * Identidad ÚNICA por pieza para conteos de desembarque.
   *
   * FedEx: cada paquete tiene su `trackingNumber` único.
   * DHL: varias piezas comparten el `trackingNumber` (guía maestra / AWB), y el
   * identificador único por pieza es el `dhlUniqueId` (JD/PID, que es justo lo que
   * se escanea). Por eso la identidad es `dhlUniqueId` cuando existe, y sólo cae al
   * `trackingNumber` cuando la pieza no tiene JD (DHL viejo importado sin PID).
   *
   * Deduplicar por `trackingNumber` colapsaba las piezas DHL de una misma guía y
   * descuadraba el conteo (faltantes/agregados). Con `pieceKey` cuenta "igual que
   * FedEx": por JD o, en su defecto, por trackingNumber.
   */
  private pieceKey(item: { trackingNumber?: string; dhlUniqueId?: string } | null | undefined): string {
    return ((item?.dhlUniqueId || item?.trackingNumber) || '').trim().toUpperCase();
  }

  private removeDuplicateTNs(items: any[]): any[] {
    const uniqueMap = new Map<string, any>();

    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      const key = this.pieceKey(item);
      if (key && !uniqueMap.has(key)) {
        uniqueMap.set(key, item);
      }
    }

    return Array.from(uniqueMap.values());
  }


  async findAll() {
    return `This action returns all unloading`;
  }


  async findBySubsidiaryId(subsidiaryId: string) {
    // Calcular la fecha límite (5 días antes de hoy)
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 15);
    // Opcional: establecer a medianoche para incluir todo el día
    fiveDaysAgo.setHours(0, 0, 0, 0);


    // Traer unloadings con la relación directa a vehicle
    const unloadings = await this.unloadingRepository.find({
      where: { 
        subsidiary: { id: subsidiaryId },
        date: MoreThanOrEqual(fiveDaysAgo)
      },
      select: {
        id: true,
        trackingNumber: true,
        date: true,
        vehicle: {
          id: true,
          plateNumber: true,
          name: true,
        },
        subsidiary: {
          id: true,
          name: true,
        },
      },
      relations: ['subsidiary', 'vehicle'],
      order: { createdAt: 'DESC' },
    });

    if (!unloadings.length) return [];

    const results = await Promise.all(
      unloadings.map(async (unloading) => {
        // Buscar Shipments y ChargeShipments ligados al unloading
        const [shipments, chargeShipments] = await Promise.all([
          this.shipmentRepository.find({
            where: { unloading: { id: unloading.id } },
          }),
          this.chargeShipmentRepository.find({
            where: { unloading: { id: unloading.id } },
          }),
        ]);

        // Calcular número total de paquetes
        const numberOfPackages = shipments.length + chargeShipments.length;

        return {
          id: unloading.id,
          trackingNumber: unloading.trackingNumber,
          date: unloading.date,
          subsidiary: unloading.subsidiary,
          vehicle: unloading.vehicle,
          numberOfPackages,
        };
      }),
    );

    return results;
  }

  async findAllBySubsidiary(
    subsidiaryId: string,
    opts: { page?: string | number; limit?: string | number; from?: string; to?: string; search?: string } = {},
  ): Promise<PaginatedResult<any>> {
    const { start, end } = resolveDateRange(opts.from, opts.to);
    const { page, limit, skip } = parsePagination(opts.page, opts.limit);
    const search = (opts.search || '').trim();

    // Conteo total exacto (sin joins de colección, para no inflar el COUNT).
    const countQb = this.unloadingRepository
      .createQueryBuilder('unloading')
      .leftJoin('unloading.subsidiary', 'subsidiary')
      .where('subsidiary.id = :subsidiaryId', { subsidiaryId })
      .andWhere('COALESCE(unloading.date, unloading.createdAt) BETWEEN :start AND :end', { start, end });
    if (search) countQb.andWhere('unloading.trackingNumber LIKE :search', { search: `%${search}%` });
    const total = await countQb.getCount();

    const qb = this.unloadingRepository.createQueryBuilder('unloading')
      .leftJoinAndSelect('unloading.vehicle', 'vehicle')
      .leftJoinAndSelect('unloading.subsidiary', 'subsidiary')
      .leftJoin('unloading.shipments', 'shipments')
      .leftJoin('unloading.chargeShipments', 'chargeShipments')
      .where('subsidiary.id = :subsidiaryId', { subsidiaryId })
      .andWhere('COALESCE(unloading.date, unloading.createdAt) BETWEEN :start AND :end', { start, end });
    if (search) qb.andWhere('unloading.trackingNumber LIKE :search', { search: `%${search}%` });
    qb
      .select([
        'unloading.id',
        'unloading.trackingNumber',
        'unloading.missingTrackings',
        'unloading.unScannedTrackings',
        'unloading.date',
        'unloading.createdAt',
        'vehicle.id',
        'vehicle.plateNumber',
        'vehicle.name',
        'subsidiary.id',
        'subsidiary.name',
      ])
      .addSelect('COUNT(DISTINCT shipments.id)', 'shipmentsCount')
      .addSelect('COUNT(DISTINCT chargeShipments.id)', 'chargeShipmentsCount')
      .groupBy('unloading.id')
      .addGroupBy('vehicle.id')
      .addGroupBy('subsidiary.id')
      .orderBy('unloading.createdAt', 'DESC')
      .offset(skip)
      .limit(limit);

    const { entities, raw } = await qb.getRawAndEntities();

    const data = entities.map((unloading) => {
      const rawData = raw.find(r => r.unloading_id === unloading.id);
      const sc = rawData ? Number(rawData.shipmentsCount) : 0;
      const cc = rawData ? Number(rawData.chargeShipmentsCount) : 0;
      return { ...unloading, shipments: sc, chargeShipments: cc, totalPackages: sc + cc };
    });

    return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** Desembarque completo (con paquetes) para el detalle / exportación. */
  async findOneWithPackages(id: string) {
    const unloading = await this.unloadingRepository.findOne({
      where: { id },
      relations: [
        'vehicle',
        'subsidiary',
        'shipments',
        'shipments.payment',
        'chargeShipments',
        'chargeShipments.payment',
        'createdBy',
      ],
    });
    if (!unloading) return unloading;
    // "Hecho por": solo el nombre (nunca la contraseña ni el resto del usuario).
    const u: any = unloading.createdBy;
    return {
      ...unloading,
      createdBy: u ? ({ id: u.id, name: [u.name, u.lastName].filter(Boolean).join(' ') || u.email || '' } as any) : null,
    };
  }


  async getUnloadingReport(startDate?: Date, endDate?: Date): Promise<UnloadingReportDto[]> {
    // Convertir fechas a UTC considerando UTC-7 (Hermosillo/Arizona)
    let startDateUTC: Date;
    let endDateUTC: Date;

    if (startDate && endDate) {
        // Convertir fechas proporcionadas de UTC-7 a UTC
        startDateUTC = this.convertHermosilloToUTC(startDate);
        endDateUTC = this.convertHermosilloToUTC(endDate);
    } else if (startDate && !endDate) {
        // Solo startDate proporcionado
        startDateUTC = this.convertHermosilloToUTC(startDate);
        endDateUTC = new Date(startDateUTC);
        endDateUTC.setUTCDate(endDateUTC.getUTCDate() + 1);
    } else if (!startDate && endDate) {
        // Solo endDate proporcionado
        endDateUTC = this.convertHermosilloToUTC(endDate);
        startDateUTC = new Date(endDateUTC);
        startDateUTC.setUTCDate(startDateUTC.getUTCDate() - 1);
    } else {
        // Sin fechas proporcionadas, usar hoy en Hermosillo convertido a UTC
        const nowHermosillo = new Date();
        startDateUTC = this.convertHermosilloToUTC(nowHermosillo);
        startDateUTC.setUTCHours(0, 0, 0, 0);
        endDateUTC = new Date(startDateUTC);
        endDateUTC.setUTCDate(endDateUTC.getUTCDate() + 1);
    }

    try {
      // Las 3 consultas de "verificación" que había aquí solo imprimían a consola: se quitaron.
      // 4. Ahora hacer la consulta completa CON FILTRO EN SHIPMENTS Y CHARGE SHIPMENTS
      const rawData = await this.unloadingRepository
        .createQueryBuilder('u')
        .leftJoinAndSelect('u.subsidiary', 's')
        .leftJoinAndSelect(
          'u.shipments', 
          'sh',
          'sh.commitDateTime >= :startDate AND sh.commitDateTime < :endDate', // FILTRO SHIPMENTS
          { startDate: startDateUTC.toISOString(), endDate: endDateUTC.toISOString() }
        )
        .leftJoinAndSelect('sh.packageDispatch', 'shPD')
        .leftJoinAndSelect('shPD.drivers', 'shDriver')
        .leftJoinAndSelect(
          'u.chargeShipments',
          'cs',
          'cs.commitDateTime >= :startDate AND cs.commitDateTime < :endDate', // FILTRO CHARGE SHIPMENTS
          { startDate: startDateUTC.toISOString(), endDate: endDateUTC.toISOString() }
        )
        .leftJoinAndSelect('cs.packageDispatch', 'csPD')
        .leftJoinAndSelect('csPD.drivers', 'csDriver')
        .where('u.date >= :startDate AND u.date < :endDate', {
          startDate: startDateUTC.toISOString(),
          endDate: endDateUTC.toISOString()
        })
        .getMany();

      this.logger.debug('===== RESULTADOS =====');
      this.logger.debug('Unloadings encontrados con joins:', rawData.length);

      // DEBUG: Verificar shipments y chargeShipments filtrados
      rawData.forEach((u, index) => {
        this.logger.debug(`Unloading ${index + 1}:`, {
          id: u.id,
          date: u.date,
          subsidiary: u.subsidiary?.name,
          shipments: u.shipments?.length || 0,
          chargeShipments: u.chargeShipments?.length || 0,
          shipmentsSample: u.shipments?.slice(0, 2).map(s => ({
            tracking: s.trackingNumber,
            commitDate: s.commitDateTime
          })),
          chargeSample: u.chargeShipments?.slice(0, 2).map(cs => ({
            tracking: cs.trackingNumber,
            commitDate: cs.commitDateTime
          }))
        });
      });

      // Procesar los datos
      const formattedData: UnloadingReportDto[] = rawData.map(unloading => {
        if (!unloading) return null;

        // Filtrar adicionalmente por si algún shipment se coló sin commitDateTime (aunque el join debería prevenirlo)
        const filteredShipments = (unloading.shipments || []).filter(sh => 
          sh.commitDateTime && 
          new Date(sh.commitDateTime) >= startDateUTC && 
          new Date(sh.commitDateTime) < endDateUTC
        );

        const filteredChargeShipments = (unloading.chargeShipments || []).filter(cs => 
          cs.commitDateTime && 
          new Date(cs.commitDateTime) >= startDateUTC && 
          new Date(cs.commitDateTime) < endDateUTC
        );

        const uniqueShipments = this.removeDuplicateShipments(filteredShipments);
        const uniqueChargeShipments = this.removeDuplicateShipments(filteredChargeShipments);

        this.logger.debug(`📦 Unloading ${unloading.id}: ${uniqueShipments.length} shipments, ${uniqueChargeShipments.length} chargeShipments después del filtro`);

        return {
          id: unloading.id,
          date: unloading.date,
          subsidiary: {
            id: unloading.subsidiary?.id || 'unknown',
            name: unloading.subsidiary?.name || 'Sucursal Desconocida',
          },
          shipments: uniqueShipments.map(sh => ({
            id: sh.id,
            trackingNumber: sh.trackingNumber,
            status: sh.status,
            commitDateTime: sh.commitDateTime,
            routeId: sh.routeId,
            packageDispatch: sh.packageDispatch ? {
              id: sh.packageDispatch.id,
              trackingNumber: sh.packageDispatch.trackingNumber,
              firstDriverName: this.getFirstDriverName(sh.packageDispatch.drivers),
            } : null,
          })),
          chargeShipments: uniqueChargeShipments.map(cs => ({
            id: cs.id,
            trackingNumber: cs.trackingNumber,
            status: cs.status,
            commitDateTime: cs.commitDateTime,
            routeId: cs.routeId,
            packageDispatch: cs.packageDispatch ? {
              id: cs.packageDispatch.id,
              trackingNumber: cs.packageDispatch.trackingNumber,
              firstDriverName: this.getFirstDriverName(cs.packageDispatch.drivers),
            } : null,
          })),
        };
      }).filter(Boolean);

      this.logger.debug('===== DATOS FORMATEADOS =====');
      this.logger.debug('Total unloadings a procesar:', formattedData.length);
      
      // Resumen final
      const totalShipments = formattedData.reduce((sum, u) => sum + u.shipments.length, 0);
      const totalChargeShipments = formattedData.reduce((sum, u) => sum + u.chargeShipments.length, 0);
      this.logger.debug(`📊 Resumen: ${totalShipments} shipments + ${totalChargeShipments} chargeShipments = ${totalShipments + totalChargeShipments} paquetes total`);

      return formattedData;

    } catch (error) {
      console.error('Error en getUnloadingReport:', error);
      throw error;
    }
  }

  // Métodos auxiliares para conversión de timezone
  private convertHermosilloToUTC(date: Date): Date {
    // Hermosillo es UTC-7, así que para convertir a UTC sumamos 7 horas
    const utcDate = new Date(date.getTime() + (7 * 60 * 60 * 1000));
    return utcDate;
  }

  private convertUTCToHermosillo(date: Date): Date {
    // Para convertir UTC a Hermosillo restamos 7 horas
    const hermosilloDate = new Date(date.getTime() - (7 * 60 * 60 * 1000));
    return hermosilloDate;
  }

  private formatDateForDisplay(dateString: string): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('es-MX', { 
      timeZone: 'America/Hermosillo',
      dateStyle: 'short',
      timeStyle: 'short' 
    });
  }

  private getFirstDriverName(drivers: any[]): string | null {
    if (!drivers || !Array.isArray(drivers) || drivers.length === 0) {
      return null;
    }
    return drivers[0]?.name || null;
  }

  private removeDuplicateShipments(shipments: any[]): any[] {
    if (!shipments || !Array.isArray(shipments)) {
      return [];
    }
    
    const seen = new Set();
    return shipments.filter(shipment => {
      if (!shipment || !shipment.id) {
        return false;
      }
      const key = shipment.id;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }


  async sendUnloadingReport(startDate?: Date, endDate?: Date) {
    const unloadings = await this.getUnloadingReport(startDate, endDate);

    this.logger.debug('===== DEBUG UNLOADINGS =====');
    this.logger.debug('Total unloadings:', unloadings.length);
    unloadings.forEach((u, index) => {
        this.logger.debug(`Unloading ${index + 1}:`, {
            id: u.id,
            subsidiary: u.subsidiary.name,
            shipments: u.shipments.length,
            chargeShipments: u.chargeShipments.length,
            shipmentsSinRuta: u.shipments.filter(s => !s.packageDispatch?.firstDriverName).length,
            chargeSinRuta: u.chargeShipments.filter(cs => !cs.packageDispatch?.firstDriverName).length
        });
    });

    // Separar paquetes con y sin ruta
    let shipmentsWithRoute = [];
    let shipmentsWithoutRoute = [];
    
    unloadings.forEach(unloading => {
        const unloadingShipments = [
            ...(unloading.shipments || []),
            ...(unloading.chargeShipments || [])
        ];
        
        unloadingShipments.forEach(shipment => {
            if (shipment.trackingNumber) {
                const shipmentWithMeta = {
                    ...shipment,
                    subsidiaryName: unloading.subsidiary?.name,
                    unloadingDate: unloading.date
                };
                
                // DEBUG DETALLADO de cada shipment
                const hasDriver = shipment.packageDispatch?.firstDriverName;
                this.logger.debug(`📦 ${shipment.trackingNumber}: ${hasDriver ? 'CON RUTA' : 'SIN RUTA'} - Driver: ${shipment.packageDispatch?.firstDriverName || 'N/A'}`);
                
                if (hasDriver) {
                    shipmentsWithRoute.push(shipmentWithMeta);
                } else {
                    shipmentsWithoutRoute.push(shipmentWithMeta);
                }
            }
        });
    });

    this.logger.debug('===== RESUMEN FINAL =====');
    this.logger.debug('Total con ruta:', shipmentsWithRoute.length);
    this.logger.debug('Total sin ruta:', shipmentsWithoutRoute.length);
    this.logger.debug('Ejemplos sin ruta:', shipmentsWithoutRoute.slice(0, 3).map(s => s.trackingNumber));

    // Si no hay shipments con datos, no enviar correo
    if (shipmentsWithRoute.length === 0 && shipmentsWithoutRoute.length === 0) {
        this.logger.debug('No se encontraron shipments para enviar en el reporte');
        return;
    }

    // Ordenar paquetes con ruta por conductor Y por salida a ruta
    shipmentsWithRoute.sort((a, b) => {
        const driverA = a.packageDispatch?.firstDriverName || 'Sin conductor';
        const driverB = b.packageDispatch?.firstDriverName || 'Sin conductor';
        
        if (driverA !== driverB) {
            return driverA.localeCompare(driverB);
        }
        
        const routeA = a.packageDispatch?.trackingNumber || '';
        const routeB = b.packageDispatch?.trackingNumber || '';
        
        if (routeA !== routeB) {
            return routeA.localeCompare(routeB);
        }
        
        return (a.trackingNumber || '').localeCompare(b.trackingNumber || '');
    });

    // Ordenar paquetes sin ruta por tracking number
    shipmentsWithoutRoute.sort((a, b) => {
        return (a.trackingNumber || '').localeCompare(b.trackingNumber || '');
    });

    // Generar HTML para ambas secciones
    const htmlWithRoute = this.generateRouteSection(shipmentsWithRoute, 'Con Salida a Ruta');
    const htmlWithoutRoute = this.generateNoRouteSection(shipmentsWithoutRoute, 'Sin Salida a Ruta');

    // Crear contenido HTML más robusto
    const htmlContent = this.generateEmailContent(
        shipmentsWithRoute, 
        shipmentsWithoutRoute, 
        htmlWithRoute, 
        htmlWithoutRoute
    );

    this.logger.debug('===== ENVIANDO CORREO =====');
    this.logger.debug('Tamaño aproximado del HTML:', htmlContent.length, 'caracteres');
    
    try {
        const result = await this.mailService.sendHighPriorityUnloadingPriorityPackages({
            to: 'paqueteriaymensajeriadelyaqui@hotmail.com',
            cc: ['sistemas@paqueteriaymensajeriadelyaqui.com','bodegacsl@paqueteriaymensajeriadelyaqui.com'],
            //to: 'javier.rappaz@gmail.com',
            //subject: this.generateEmailSubject(shipmentsWithRoute, shipmentsWithoutRoute, startDate, endDate),
            htmlContent
        });

        this.logger.debug(`✅ Correo enviado: ${shipmentsWithRoute.length} con ruta, ${shipmentsWithoutRoute.length} sin ruta`);
        return {
            success: true,
            withRoute: shipmentsWithRoute.length,
            withoutRoute: shipmentsWithoutRoute.length,
            totalUnloadings: unloadings.length
        };
    } catch (error) {
        console.error('❌ Error al enviar correo:', error);
        this.logger.error('Error al enviar correo:', error);
        throw error;
    }
  }

  // NUEVO MÉTODO para generar el contenido del email de forma más robusta
  private generateEmailContent(
      shipmentsWithRoute: any[], 
      shipmentsWithoutRoute: any[], 
      htmlWithRoute: string, 
      htmlWithoutRoute: string
  ): string {
      return `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reporte de Descargas</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 1000px; margin: auto; padding: 20px;">
      <h2 style="border-bottom: 3px solid #e74c3c; padding-bottom: 8px; color: #2c3e50;">
          📦 Reporte Consolidado de Descargas
      </h2>

      <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #2c3e50;">Resumen General</h3>
          <div style="display: flex; gap: 20px; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 200px;">
                  <strong>Total de paquetes:</strong> ${shipmentsWithRoute.length + shipmentsWithoutRoute.length}<br>
                  <strong>Con salida a ruta:</strong> ${shipmentsWithRoute.length}<br>
                  <strong>Sin salida a ruta:</strong> ${shipmentsWithoutRoute.length}<br>
                  <strong>Total de conductores:</strong> ${this.getUniqueDriversCount(shipmentsWithRoute)}<br>
                  <strong>Total de salidas a ruta:</strong> ${this.getUniqueRoutesCount(shipmentsWithRoute)}<br>
                  <strong>Fecha de generación:</strong> ${new Date().toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo' })}
              </div>
              <div style="flex: 1; min-width: 200px;">
                  ${this.generateStatusSummary([...shipmentsWithRoute, ...shipmentsWithoutRoute])}
              </div>
          </div>
      </div>

      ${htmlWithRoute}
      ${shipmentsWithoutRoute.length > 0 ? htmlWithoutRoute : '<div style="margin-bottom: 30px;"><p>✅ No hay paquetes sin salida a ruta.</p></div>'}

      <div style="margin-top: 25px; padding: 15px; background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px;">
          <h4 style="margin-top: 0; color: #856404;">📋 Consideraciones</h4>
          <ul style="margin-bottom: 0; color: #856404;">
              <li>Los paquetes están agrupados por conductor y salida a ruta, ordenados por tracking number</li>
              <li>El <strong>Tracking Salida</strong> corresponde a la salida a ruta del conductor</li>
              <li>Paquetes <strong>Sin Salida a Ruta</strong> requieren atención inmediata para asignación</li>
              <li>Paquetes con estatus <span style="color: #c0392b; font-weight: bold;">ENTREGADO</span> ya fueron completados</li>
              <li>Paquetes con estatus <span style="color: #e67e22; font-weight: bold;">EN RUTA</span> están en proceso de entrega</li>
          </ul>
      </div>

      <p style="margin-top: 25px; text-align: center;">
          Para un monitoreo detallado de los envíos, visite: 
          <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none; font-weight: bold;">
              https://app-pmy.vercel.app/
          </a>
      </p>

      <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

      <p style="font-size: 0.9em; color: #7f8c8d; text-align: center;">
          📧 Este correo fue generado automáticamente por el sistema de seguimiento<br />
          ⏰ Hora de generación: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Hermosillo' })}<br />
          🙏 Por favor, no responda a este mensaje
      </p>
  </body>
  </html>`;
  }

  // MÉTODO MEJORADO para sección sin ruta
  private generateNoRouteSection(shipments: any[], title: string): string {
      if (shipments.length === 0) {
          return '';
      }

      const htmlRows = shipments
          .map(shipment => `
              <tr style="border-bottom: 1px solid #ddd;">
                  <td style="padding: 8px; text-align: center;">${shipment.trackingNumber ?? "N/A"}</td>
                  <td style="padding: 8px;">${shipment.subsidiaryName ?? "N/A"}</td>
                  <td style="padding: 8px; text-align: center;">
                      ${
                          shipment.commitDateTime
                          ? new Date(shipment.commitDateTime).toLocaleDateString('es-MX', {
                              timeZone: 'America/Hermosillo',
                          })
                          : "Sin fecha"
                      }
                  </td>
                  <td style="padding: 8px; text-align: center;">
                      <span style="
                          padding: 4px 8px;
                          border-radius: 12px;
                          font-size: 0.85em;
                          font-weight: bold;
                          ${this.getStatusStyle(shipment.status)}
                      ">
                          ${this.translateStatus(shipment.status) ?? "N/A"}
                      </span>
                  </td>
                  <td style="padding: 8px; text-align: center; color: #e74c3c; font-weight: bold;">
                      ⚠️ SIN ASIGNAR
                  </td>
              </tr>
          `)
          .join("");

      return `
          <div style="margin-bottom: 30px;">
              <h3 style="color: #e74c3c; border-left: 4px solid #e74c3c; padding-left: 10px; background-color: #fdf2f2; padding: 10px; border-radius: 4px;">
                  ⚠️ ${title} <span style="font-size: 0.8em; color: #7f8c8d;">(${shipments.length} paquetes)</span>
              </h3>
              <div style="background-color: #fdf2f2; padding: 10px; border-radius: 4px; margin-bottom: 10px;">
                  <p style="margin: 0; color: #e74c3c; font-weight: bold;">
                      ❗ Estos ${shipments.length} paquetes requieren asignación inmediata a una ruta
                  </p>
              </div>
              <table 
                  border="0" 
                  cellpadding="0" 
                  cellspacing="0" 
                  style="border-collapse: collapse; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.05);"
              >
                  <thead style="background-color: #f8d7da; color: #721c24; text-align: center;">
                      <tr>
                          <th style="padding: 12px;">Tracking Paquete</th>
                          <th style="padding: 12px;">Sucursal</th>
                          <th style="padding: 12px;">Fecha Compromiso</th>
                          <th style="padding: 12px;">Estatus</th>
                          <th style="padding: 12px;">Situación</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${htmlRows}
                  </tbody>
              </table>
          </div>
      `;
  }

  // MÉTODO ACTUALIZADO para paquetes con ruta (agrupa por conductor Y salida a ruta)
  private generateRouteSection(shipments: any[], title: string): string {
      let currentDriver = '';
      let currentRoute = '';
      
      const htmlRows = shipments
          .map(shipment => {
              const driver = shipment.packageDispatch?.firstDriverName || 'Sin conductor asignado';
              const routeTracking = shipment.packageDispatch?.trackingNumber || 'N/A';
              
              let routeHeader = '';
              if (driver !== currentDriver || routeTracking !== currentRoute) {
                  currentDriver = driver;
                  currentRoute = routeTracking;
                  routeHeader = `
                      <tr style="background-color: #e8f4fd;">
                          <td colspan="5" style="padding: 10px; font-weight: bold; border-bottom: 2px solid #3498db;">
                              🚗 Conductor: ${driver} | 📦 Salida a ruta: ${routeTracking}
                          </td>
                      </tr>
                  `;
              }

              return `
                  ${routeHeader}
                  <tr style="border-bottom: 1px solid #ddd;">
                      <td style="padding: 8px; text-align: center;">${shipment.trackingNumber ?? "N/A"}</td>
                      <td style="padding: 8px;">${shipment.subsidiaryName ?? "N/A"}</td>
                      <td style="padding: 8px; text-align: center;">
                          ${
                              shipment.commitDateTime
                              ? new Date(shipment.commitDateTime).toLocaleDateString('es-MX', {
                                  timeZone: 'America/Hermosillo',
                              })
                              : "Sin fecha"
                          }
                      </td>
                      <td style="padding: 8px; text-align: center;">
                          <span style="
                              padding: 4px 8px;
                              border-radius: 12px;
                              font-size: 0.85em;
                              font-weight: bold;
                              ${this.getStatusStyle(shipment.status)}
                          ">
                              ${this.translateStatus(shipment.status) ?? "N/A"}
                          </span>
                      </td>
                      <td style="padding: 8px; text-align: center;">${routeTracking}</td>
                  </tr>
              `;
          })
          .join("");

      return `
          <div style="margin-bottom: 30px;">
              <h3 style="color: #2c3e50; border-left: 4px solid #3498db; padding-left: 10px;">
                  📋 ${title} <span style="font-size: 0.8em; color: #7f8c8d;">(${shipments.length} paquetes)</span>
              </h3>
              <table 
                  border="0" 
                  cellpadding="0" 
                  cellspacing="0" 
                  style="border-collapse: collapse; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.05);"
              >
                  <thead style="background-color: #2c3e50; color: white; text-align: center;">
                      <tr>
                          <th style="padding: 12px;">Tracking Paquete</th>
                          <th style="padding: 12px;">Sucursal</th>
                          <th style="padding: 12px;">Fecha Compromiso</th>
                          <th style="padding: 12px;">Estatus</th>
                          <th style="padding: 12px;">Tracking Salida</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${htmlRows || `
                          <tr>
                              <td colspan="5" style="text-align: center; padding: 20px; color: #7f8c8d;">
                                  No hay paquetes en esta categoría
                              </td>
                          </tr>
                      `}
                  </tbody>
              </table>
          </div>
      `;
  }

  // NUEVO MÉTODO para contar salidas a ruta únicas
  private getUniqueRoutesCount(shipments: any[]): number {
      const routes = new Set();
      shipments.forEach(shipment => {
          if (shipment.packageDispatch?.trackingNumber) {
              routes.add(shipment.packageDispatch.trackingNumber);
          }
      });
      return routes.size;
  }

  // Métodos auxiliares
  getUniqueDriversCount(shipments) {
      const drivers = new Set();
      shipments.forEach(shipment => {
          if (shipment.packageDispatch?.firstDriverName) {
              drivers.add(shipment.packageDispatch.firstDriverName);
          }
      });
      return drivers.size;
  }

  generateStatusSummary(shipments) {
      const statusCount = {};
      
      shipments.forEach(shipment => {
          const status = shipment.status || 'desconocido';
          statusCount[status] = (statusCount[status] || 0) + 1;
      });

      const summaryItems = Object.entries(statusCount)
          .map(([status, count]) => 
              `<div style="margin: 3px 0;">
                  <strong>${this.translateStatus(status)}:</strong> ${count}
              </div>`
          )
          .join('');

      return summaryItems;
  }

  getStatusStyle(status) {
      const styles = {
          'entregado': 'background-color: #d4edda; color: #155724;',
          'en_ruta': 'background-color: #fff3cd; color: #856404;',
          'recoleccion': 'background-color: #cce7ff; color: #004085;',
          'no_entregado': 'background-color: #f8d7da; color: #721c24;',
          'desconocido': 'background-color: #e2e3e5; color: #383d41;'
      };
      
      return styles[status] || 'background-color: #f8f9fa; color: #6c757d;';
  }

  translateStatus(status) {
      const translations = {
          'entregado': 'ENTREGADO',
          'en_ruta': 'EN RUTA',
          'recoleccion': 'RECOLECCIÓN',
          'no_entregado': 'NO ENTREGADO',
          'desconocido': 'DESCONOCIDO'
      };
      
      return translations[status] || status?.toUpperCase() || 'N/A';
  }

  async getPriorityFromUnloading(unloading: Unloading) {
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);

    const tomorrowUTC = new Date(todayUTC);
    tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);

    if (!unloading) return null;

    const shipments = (unloading.shipments || []).filter(
      s => s.commitDateTime >= todayUTC && s.commitDateTime < tomorrowUTC
    );

    const chargeShipments = (unloading.chargeShipments || []).filter(
      cs => cs.commitDateTime >= todayUTC && cs.commitDateTime < tomorrowUTC
    );

    const htmlRows = [...shipments, ...chargeShipments]
      .map(
        s => `
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 8px; text-align: center;">${s.trackingNumber ?? "N/A"}</td>
            <td style="padding: 8px;">${s.subsidiary?.name ?? "N/A"}</td>
            <td style="padding: 8px; text-align: center;">
              ${
                s.commitDateTime
                  ? new Date(s.commitDateTime).toLocaleDateString('es-MX', {
                      timeZone: 'America/Hermosillo',
                    })
                  : "Sin fecha"
              }
            </td>
            <td style="padding: 8px; text-align: center;">${s.status ?? "N/A"}</td>
          </tr>
        `
      )
      .join("");

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
        <h2 style="border-bottom: 3px solid #e74c3c; padding-bottom: 8px;">
          Reporte de Descarga con Paquetes Críticos
        </h2>

        <p>
          Dentro de la descarga <strong>${unloading.trackingNumber ?? "N/A"}</strong>
          se han detectado paquetes con fecha de vencimiento el día de hoy 
          (<strong>${new Date(unloading.date).toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo' })}</strong>).
        </p>

        <p style="color:#c0392b; font-weight:bold;">
          Estos envíos deben ser considerados para <u>entrega inmediata</u>.
        </p>

        <table 
          border="0" 
          cellpadding="0" 
          cellspacing="0" 
          style="border-collapse: collapse; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.05); margin-top: 15px;"
        >
          <thead style="background-color: #f7f7f7; text-align: center;">
            <tr>
              <th style="padding: 10px;">Tracking Number</th>
              <th style="padding: 10px;">Destino</th>
              <th style="padding: 10px;">Fecha de Vencimiento</th>
              <th style="padding: 10px;">Estatus</th>
            </tr>
          </thead>
          <tbody>
            ${
              htmlRows ||
              `<tr>
                <td colspan="5" style="text-align: center; padding: 15px; color: #7f8c8d;">
                  No se encontraron paquetes vencidos en el día.
                </td>
              </tr>`
            }
          </tbody>
        </table>

        <p style="margin-top: 20px; font-weight: bold; color: #c0392b;">
          Este correo se genera automáticamente debido a la criticidad de la descarga.
        </p>

        <p style="margin-top: 20px;">
          Para un monitoreo detallado de los envíos, por favor visite: 
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

    const result = await this.mailService.sendHighPriorityUnloadingPriorityPackages({
      to: unloading.subsidiary.officeEmail,
      cc: `${unloading.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`,
      //cc: 'javier.rappaz@gmail.com'
      htmlContent
    });

    this.logger.debug('Correo enviado correctamente:', result);

    return { ...unloading, shipments, chargeShipments };
  }

  /**
   * Entrada segura del correo del desembarque (ruta `POST /unloadings/upload`).
   * - Solo un desembarque de las sucursales del usuario (de otra: "no encontrado").
   * - Exactamente un PDF y un Excel, revisando su CONTENIDO (no el tipo que dice el navegador).
   * - Los nombres de los adjuntos y el de la sucursal salen del servidor (antes del cliente).
   * Se puede llamar varias veces (reenvío): los destinatarios siempre salen de la base.
   */
  async sendByEmailSecure(files: Express.Multer.File[], unloadingId: string, user: UnloadingUser) {
    const unloading = await this.unloadingRepository.findOne({
      where: { id: unloadingId },
      relations: ['subsidiary'],
    });
    if (!unloading) throw new NotFoundException('Desembarque no encontrado.');
    try {
      assertSubsidiaryAccess(user, unloading.subsidiary?.id);
    } catch {
      throw new NotFoundException('Desembarque no encontrado.');
    }

    if (!files || files.length !== 2) {
      throw new BadRequestException('Se esperan dos archivos: el PDF y el Excel del desembarque.');
    }
    const pdf = files.find(f => looksLikePdf(f.buffer));
    const excel = files.find(f => f !== pdf && looksLikeXlsx(f.buffer));
    if (!pdf || !excel) {
      throw new BadRequestException('Los archivos no son un PDF y un Excel válidos.');
    }

    const subsidiaryName = unloading.subsidiary?.name ?? '';
    const named = (f: Express.Multer.File, ext: 'pdf' | 'xlsx', mimetype: string): Express.Multer.File => ({
      ...f,
      originalname: safeAttachmentName(subsidiaryName, ext, unloading.date ?? unloading.createdAt ?? new Date()),
      mimetype,
    });

    return this.sendByEmail(
      named(pdf, 'pdf', 'application/pdf'),
      named(excel, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      subsidiaryName,
      unloadingId,
    );
  }

  async sendByEmail(
    file: Express.Multer.File, 
    excelFile: Express.Multer.File, 
    subsidiaryName: string, 
    unloadingId: string
  ) {
    const unloading = await this.unloadingRepository.findOne({
      where: { id: unloadingId },
      relations: [
        'vehicle',
        'shipments',
        'subsidiary',
        'shipments.subsidiary',
        // `payment` es @OneToOne NO-eager en Shipment/ChargeShipment: sin cargarla aquí,
        // `loadUnloadingInput()` recibe `s.payment === undefined` y el motor de plantillas
        // nunca renderiza "Cobro"/[$] (flag DOC_ENGINE_UNLOADING) aunque el paquete sí tenga cobro.
        'shipments.payment',
        'chargeShipments',
        'chargeShipments.subsidiary',
        'chargeShipments.payment',
        'createdBy',
      ],
    });

    if (!unloading) {
      throw new NotFoundException(`Unloading con id ${unloadingId} no encontrado`);
    }

    this.logger.debug(`Unloading encontrado: ${unloading.id}`);

    try {
      // enviar correo con las prioridades
      await this.getPriorityFromUnloading(unloading);
    } catch (err) {
      this.logger.error(`Error enviando correo de prioridades para unloading ${unloading.id}`, err);
    }

    // Unificación "Desembarque": detrás de flag, el backend genera PDF/Excel por el
    // Motor de Plantillas (plantilla canónica única). Si algo falla, se conservan los
    // archivos subidos por el frontend (respaldo). Flag OFF => comportamiento actual intacto.
    if (process.env.DOC_ENGINE_UNLOADING === 'true') {
      try {
        const input = this.loadUnloadingInput(unloading, subsidiaryName);
        const gen = await this.renderUnloadingDocuments(input);
        if (gen.pdf) file = { ...file, buffer: gen.pdf };
        if (gen.excel) excelFile = { ...excelFile, buffer: gen.excel };
        this.logger.log(
          `Desembarque ${unloading.trackingNumber}: PDF ${gen.pdf ? 'del servidor' : 'de la app (respaldo)'}, Excel ${gen.excel ? 'del servidor' : 'de la app (respaldo)'}`,
        );
      } catch (e: any) {
        this.logger.warn(`Motor unloading falló; uso archivos subidos: ${e?.message}`);
      }
    }

    // segundo correo con los archivos adjuntos
    try {
      const sent = await this.mailService.sendHighPriorityUnloadingEmail(
        file,
        excelFile,
        subsidiaryName,
        unloading,
      );
      this.logger.log(`Correo de desembarque ${unloading.trackingNumber} enviado (${subsidiaryName}).`);
      return sent;
    } catch (err) {
      this.logger.error(`Error enviando correo de unloading con archivos adjuntos para ${unloading.id}`, err);
      throw err; // importante propagar para que el flujo lo sepa
    }
  }

  /** Genera PDF+Excel de "Desembarque" por el motor. Si un formato no entrega buffer, queda undefined (respaldo). */
  async renderUnloadingDocuments(input: UnloadingInput): Promise<{ pdf?: Buffer; excel?: Buffer }> {
    const data = buildUnloadingData(input);
    const [pdf, excel] = await Promise.all([
      this.templateService.render('unloading_pdf', data).then((r) => r.buffer).catch(() => undefined),
      this.templateService.render('unloading_excel', data).then((r) => r.buffer).catch(() => undefined),
    ]);
    return { pdf, excel };
  }

  /** Arma el UnloadingInput a partir del Unloading ya cargado (espejo backend de UnloadingPDFReport/generateUnloadingExcelClient).
   * Gap conocido: `missingTrackings`/`unScannedTrackings` solo guardan el tracking (sin datos del
   * destinatario), aunque el frontend soporta una versión enriquecida; el data-provider degrada sin romper. */
  private loadUnloadingInput(unloading: Unloading, subsidiaryName: string): UnloadingInput {
    const map = (s: any, isCharge: boolean): UnloadingPackage => ({
      trackingNumber: s.trackingNumber,
      recipientName: s.recipientName,
      recipientAddress: s.recipientAddress,
      recipientZip: s.recipientZip,
      recipientPhone: s.recipientPhone,
      commitDateTime: s.commitDateTime ? new Date(s.commitDateTime).toISOString() : undefined,
      isCharge,
      isHighValue: s.isHighValue,
      payment: s.payment ? { amount: s.payment.amount, type: s.payment.type } : null,
      status: s.status ?? null,
    });
    return {
      subsidiaryName: unloading.subsidiary?.name ?? subsidiaryName,
      vehicleName: unloading.vehicle?.name,
      trackingNumber: unloading.trackingNumber ?? '',
      packages: [
        ...(unloading.shipments ?? []).map((s) => map(s, false)),
        ...(unloading.chargeShipments ?? []).map((s) => map(s, true)),
      ],
      missingPackages: unloading.missingTrackings ?? [],
      unScannedTrackings: unloading.unScannedTrackings ?? [],
      createdAt: unloading.createdAt,
      createdByName: [unloading.createdBy?.name, unloading.createdBy?.lastName].filter(Boolean).join(' ') || undefined,
    };
  }

  async findShipmentsByUnloadingId(id: string) {
    // Buscar el Unloading
    const unloading = await this.unloadingRepository.findOne({
      where: { id },
      relations: ['subsidiary'],
    });

    if (!unloading) {
      throw new Error(`No se encontró ningún Unloading con id: ${id}`);
    }

    // Buscar Shipments y ChargeShipments
    const [shipments, chargeShipments] = await Promise.all([
      this.shipmentRepository.find({
        where: { unloading: { id } },
        relations: [
          'packageDispatch',
          'packageDispatch.drivers',
          'packageDispatch.vehicle',
          'packageDispatch.routes',
          'packageDispatch.subsidiary',
          'packageDispatch.routeClosure',
          'packageDispatch.routeClosure.createdBy',
          'unloading',
          'unloading.subsidiary',
          'subsidiary',
          'payment',
        ],
      }),
      this.chargeShipmentRepository.find({
        where: { unloading: { id } },
        relations: [
          'packageDispatch',
          'packageDispatch.drivers',
          'packageDispatch.vehicle',
          'packageDispatch.routes',
          'packageDispatch.subsidiary',
          'packageDispatch.routeClosure',
          'packageDispatch.routeClosure.createdBy',
          'unloading',
          'unloading.subsidiary',
          'payment',
          'subsidiary'
        ],
      }),
    ]);

    if (shipments.length === 0 && chargeShipments.length === 0) {
      return [];
    }

    // ===================================================
    // 🔥 NUEVA FUNCIONES REUSABLES
    // ===================================================

    // 1. DaysInWarehouse
    const calcDaysInWarehouse = (createdAt: Date, status: string) => {
      //if (status !== 'entre') return "N/A";
      const today = new Date();
      const created = new Date(createdAt);
      const diff = Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      return diff;
    };

    // ========= 🔥 Helper: obtener dexCode =========
    const getDexCode = async (shipmentId: string, status: string) => {
      const rejectedStatuses = [
        'rechazado',
        'no_entregado',
        'direccion_incorrecta',
        'cliente_no_encontrado',
        'cambio_fecha_solicitado'
      ];

      if (!rejectedStatuses.includes(status)) {
        return null;
      }

      const row = await this.shipmentStatusRepository
        .createQueryBuilder('ss')
        .select('ss.exceptionCode', 'exceptionCode')
        .where('ss.shipmentId = :shipmentId', { shipmentId })
        .orderBy('ss.createdAt', 'DESC')
        .limit(1)
        .getRawOne();

      return row?.exceptionCode ?? null;
    };

    // ===================================================
    // MAPEO
    // ===================================================

    const mapShipment = async (shipment: any, isCharge: boolean) => {
      const dispatch = shipment.packageDispatch;

      const inWarehouse = !dispatch;
      const ubication = inWarehouse ? 'EN BODEGA' : 'EN RUTA';

      const driverName =
        dispatch?.drivers?.length && dispatch.drivers[0]
          ? dispatch.drivers[0].name
          : null;

      // Consolidated manual por consNumber
      let consolidated = null;
      if (shipment.consNumber) {
        consolidated = await this.consolidatedReporsitory.findOne({
          where: { consNumber: shipment.consNumber },
        });
      }

      // =============================
      // NUEVO: Calculamos valores
      // =============================
      const daysInWarehouse = calcDaysInWarehouse(
        shipment.createdAt,
        shipment.status
      );

      const dexCode = await getDexCode(
        shipment.id,
        shipment.status
      );


      return {
        shipmentData: {
          id: shipment.id,
          trackingNumber: shipment.trackingNumber,
          shipmentStatus: shipment.status,
          commitDateTime: shipment.commitDateTime,
          ubication,
          warehouse: shipment.subsidiary.name,

          unloading: shipment.unloading
            ? {
                trackingNumber: shipment.unloading.trackingNumber,
                date: shipment.unloading.date,
                subsidiary: shipment.unloading.subsidiary
                  ? shipment.unloading.subsidiary.name
                  : null,
              }
            : null,

          consolidated: consolidated
            ? {
                consNumber: consolidated.consNumber,
                date: consolidated.createdAt,
              }
            : null,

          destination: shipment.recipientCity || null,

          payment: shipment.payment
            ? {
                type: shipment.payment.type,
                amount: +shipment.payment.amount
              }
            : null,

          createdDate: shipment.createdAt,

          recipientName: shipment.recipientName,
          recipientAddress: shipment.recipientAddress,
          recipientPhone: shipment.recipientPhone,
          recipientZip: shipment.recipientZip,

          shipmentType: shipment.shipmentType,

          daysInWareHouse: daysInWarehouse,
          dexCode,

          isCharge,
        },

        packageDispatch: dispatch
          ? {
              id: dispatch.id,
              trackingNumber: dispatch.trackingNumber,
              createdAt: dispatch.createdAt,
              status: dispatch.status,
              driver: driverName,
              vehicle: dispatch.vehicle
                ? {
                    name: dispatch.vehicle.name || null,
                    plateNumber: dispatch.vehicle.plateNumber || null,
                  }
                : null,
              routes: dispatch.routes?.length
                ? dispatch.routes.map((r) => r.name)
                : [],
              subsidiary: dispatch.subsidiary
                ? {
                    id: dispatch.subsidiary.id,
                    name: dispatch.subsidiary.name,
                  }
                : null,
              routeClosure: dispatch.routeClosure
                ? {
                    closeDate: dispatch.routeClosure.closeDate,
                    closedBy: dispatch.routeClosure.createdBy
                      ? dispatch.routeClosure.createdBy.name
                      : null,
                  }
                : null,
            }
          : null,
      };
    };

    // Ejecutar mapeo async
    const normalShipments = await Promise.all(
      shipments.map((s) => mapShipment(s, false)),
    );
    const chargeShipmentsMapped = await Promise.all(
      chargeShipments.map((s) => mapShipment(s, true)),
    );

    return [...normalShipments, ...chargeShipmentsMapped];
  }

  async updateFedexDataByUnloadingId(unloadingId: string) {
    // Validar que se proporcione el ID del unloading
    if (!unloadingId) {
      throw new Error('El ID del unloading es requerido');
    }

    // 1. Buscar el unloading específico por ID
    const unloading = await this.unloadingRepository.findOne({
      where: { id: unloadingId },
      select: ['id', 'trackingNumber'] // Ajusta según el nombre del campo en tu entidad
    });

    if (!unloading) {
      console.warn(`No se encontró el unloading con ID: ${unloadingId}`);
      return [];
    }

    this.logger.debug(`🔍 Procesando unloading: ${unloading.trackingNumber}`);

    // 2. Obtener solo IDs y tracking numbers de shipments
    const shipmentsForFedex = [];
    const shipmentsTrackingNumbers = [];
    const chargeShipmentsTrackingNumbers = [];

    // Obtener solo ID y trackingNumber de shipments normales
    const shipments = await this.shipmentRepository.find({
      where: { 
        unloading: { id: unloading.id },
        status: In([ShipmentStatusType.EN_RUTA, ShipmentStatusType.DESCONOCIDO, ShipmentStatusType.PENDIENTE, ShipmentStatusType.NO_ENTREGADO]) 
      },
      select: ['id', 'trackingNumber']
    });

    // Obtener solo ID y trackingNumber de chargeShipments
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { 
        unloading: { id: unloading.id }, 
        status: In([ShipmentStatusType.EN_RUTA, ShipmentStatusType.DESCONOCIDO, ShipmentStatusType.PENDIENTE, ShipmentStatusType.NO_ENTREGADO])
      },
      select: ['id', 'trackingNumber']
    });

    this.logger.debug(`📦 Shipments: ${shipments.length}, ChargeShipments: ${chargeShipments.length}`);

    if (shipments.length === 0 && chargeShipments.length === 0) {
      console.warn(`⚠️ No se encontraron shipments para unloading ${unloading.trackingNumber}`);
      return [];
    }

    // Combinar y mapear solo los datos necesarios
    const allShipments = [
      ...shipments.map(s => ({
        id: s.id,
        trackingNumber: s.trackingNumber,
        isCharge: false
      })),
      ...chargeShipments.map(s => ({
        id: s.id,
        trackingNumber: s.trackingNumber,
        isCharge: true
      }))
    ];

    shipmentsTrackingNumbers.push(...shipments.map(s => s.trackingNumber));
    chargeShipmentsTrackingNumbers.push(...chargeShipments.map(s => s.trackingNumber));
    shipmentsForFedex.push(...allShipments);

    this.logger.debug(`✅ Unloading ${unloading.trackingNumber}: ${allShipments.length} shipments listos para FedEx`);

    // 3. Procesar con FedEx
    try {
      // New Method
      const result = await this.shipmentService.processMasterFedexUpdate(shipmentsTrackingNumbers);

      // Old method
      //const result = await this.shipmentService.checkStatusOnFedexBySubsidiaryRulesTesting(shipmentsTrackingNumbers, true);
      const resultChargShipments = await this.shipmentService.checkStatusOnFedexChargeShipment(chargeShipmentsTrackingNumbers);

      /*
      // Registrar resultados para auditoría
      this.logger.log(
        `✅ Resultado para unloading ${unloading.trackingNumber}: ` +
        `${result.updatedShipments.length} envíos actualizados, ` +
        `${resultChargShipments.updatedChargeShipments.length} envíos F2 actualizados, ` +
        `${result.shipmentsWithError.length} errores, ` +
        `${resultChargShipments.chargeShipmentsWithError.length} errores de F2, ` +
        `${result.unusualCodes.length} códigos inusuales, ` +
        `${result.shipmentsWithOD.length} excepciones OD o fallos de validación`
      );

      // Registrar detalles de errores, códigos inusuales y excepciones OD si los hay
      if (result.shipmentsWithError.length) {
        this.logger.warn(`⚠️ Errores detectados: ${JSON.stringify(result.shipmentsWithError, null, 2)}`);
      }

      if (resultChargShipments.chargeShipmentsWithError.length) {
        this.logger.warn(`⚠️ Errores detectados en F2: ${JSON.stringify(resultChargShipments.chargeShipmentsWithError, null, 2)}`);
      }

      if (result.unusualCodes.length) {
        this.logger.warn(`⚠️ Códigos inusuales: ${JSON.stringify(result.unusualCodes, null, 2)}`);
      }
      
      if (result.shipmentsWithOD.length) {
        this.logger.warn(`⚠️ Excepciones OD o fallos de validación: ${JSON.stringify(result.shipmentsWithOD, null, 2)}`);
      }*/

    } catch (err) {
      this.logger.error(`❌ Error al actualizar FedEx para unloading ${unloading.trackingNumber}: ${err.message}`);
    }

    return shipmentsForFedex;
  }

  async getShipmentsWithout67ByUnloading(id: string){
    const shipmentsWithout67 = [];

    const shipments = await this.shipmentRepository.find({
      where: { unloading: { id } , status: Not(In(TERMINAL_SHIPMENT_STATUSES)) },
      relations: [
        'statusHistory'
      ],
    });

    this.logger.debug("📦 Shipments encontrados:", shipments.length);

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { unloading: { id } , status: Not(In(TERMINAL_SHIPMENT_STATUSES))},
      relations: [
        'statusHistory',
      ],
    });

    this.logger.debug("⚡ ChargeShipments encontrados:", chargeShipments.length);

    const allShipments = [...shipments, ...chargeShipments]

    for (const shipment of allShipments) {
        try {
          if (!shipment.statusHistory || shipment.statusHistory.length === 0) {
            shipmentsWithout67.push({
              trackingNumber: shipment.trackingNumber,
              currentStatus: shipment.status,
              statusHistoryCount: 0,
              exceptionCodes: [],
              firstStatusDate: null,
              lastStatusDate: null,
              comment: 'Sin historial de estados',
            });
            continue;
          }

          const sortedHistory = shipment.statusHistory.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );

          const hasExceptionCode67 = sortedHistory.some(status => 
            status.exceptionCode === '67'
          );

          if (!hasExceptionCode67) {
            const firstStatus = sortedHistory[0];
            const lastStatus = sortedHistory[sortedHistory.length - 1];

            const exceptionCodes = sortedHistory
              .map(h => h.exceptionCode)
              .filter(code => code !== null && code !== undefined);

            shipmentsWithout67.push({
              trackingNumber: shipment.trackingNumber,
              recipientAddress: shipment.recipientAddress,
              recipientName: shipment.recipientName,
              recipientCity: shipment.recipientCity,
              recipientZip: shipment.recipientZip,
              commitDateTime: shipment.commitDateTime,
              currentStatus: shipment.status,
              statusHistoryCount: sortedHistory.length,
              exceptionCodes: [...new Set(exceptionCodes)],
              firstStatusDate: firstStatus?.timestamp,
              lastStatusDate: lastStatus?.timestamp,
              comment: 'No tiene exceptionCode 67',
            });
          }

        } catch (error) {
          shipmentsWithout67.push({
            trackingNumber: shipment.trackingNumber,
            currentStatus: shipment.status,
            statusHistoryCount: 0,
            exceptionCodes: [],
            firstStatusDate: null,
            lastStatusDate: null,
            comment: `Error: ${error.message}`,
          });
        }
      }

    return { 
      count: shipmentsWithout67.length,
      shipments: shipmentsWithout67
    };

  }

  async getShipmentsWithout44ByUnloading(id: string) {
    const shipmentsWithout44 = [];

    // 1. Buscar Shipments normales relacionados a la descarga
    const shipments = await this.shipmentRepository.find({
      where: { unloading: { id }, status: Not(In(TERMINAL_SHIPMENT_STATUSES)) },
      relations: ['statusHistory'],
    });

    this.logger.debug("📦 Shipments encontrados:", shipments.length);

    // 2. Buscar ChargeShipments relacionados a la descarga
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { unloading: { id }, status: Not(In(TERMINAL_SHIPMENT_STATUSES)) },
      relations: ['statusHistory'],
    });

    this.logger.debug("⚡ ChargeShipments encontrados:", chargeShipments.length);

    const allShipments = [...shipments, ...chargeShipments];

    for (const shipment of allShipments) {
      try {
        // Validar si tiene historial
        if (!shipment.statusHistory || shipment.statusHistory.length === 0) {
          shipmentsWithout44.push({
            trackingNumber: shipment.trackingNumber,
            currentStatus: shipment.status,
            statusHistoryCount: 0,
            exceptionCodes: [],
            firstStatusDate: null,
            lastStatusDate: null,
            comment: 'Sin historial de estados',
          });
          continue;
        }

        // Ordenar historial por fecha cronológica
        const sortedHistory = shipment.statusHistory.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        // --- VALIDACIÓN DEL CÓDIGO 44 ---
        const hasExceptionCode44 = sortedHistory.some(status => 
          status.exceptionCode === '44'
        );

        if (!hasExceptionCode44) {
          const firstStatus = sortedHistory[0];
          const lastStatus = sortedHistory[sortedHistory.length - 1];

          const exceptionCodes = sortedHistory
            .map(h => h.exceptionCode)
            .filter(code => code !== null && code !== undefined);

          shipmentsWithout44.push({
            trackingNumber: shipment.trackingNumber,
            recipientAddress: shipment.recipientAddress,
            recipientName: shipment.recipientName,
            recipientCity: shipment.recipientCity,
            recipientZip: shipment.recipientZip,
            commitDateTime: shipment.commitDateTime,
            currentStatus: shipment.status,
            statusHistoryCount: sortedHistory.length,
            exceptionCodes: [...new Set(exceptionCodes)],
            firstStatusDate: firstStatus?.timestamp,
            lastStatusDate: lastStatus?.timestamp,
            comment: 'No tiene exceptionCode 44',
          });
        }

      } catch (error) {
        shipmentsWithout44.push({
          trackingNumber: shipment.trackingNumber,
          currentStatus: shipment.status,
          statusHistoryCount: 0,
          exceptionCodes: [],
          firstStatusDate: null,
          lastStatusDate: null,
          comment: `Error: ${error.message}`,
        });
      }
    }

    return { 
      count: shipmentsWithout44.length,
      shipments: shipmentsWithout44
    };
  }
}
