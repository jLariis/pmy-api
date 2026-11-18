import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InventoryType } from 'src/common/enums/inventory-type.enum';
import { buildZipCityMap, resolveZoneCity, ZipCoverageRow } from './zone-city.util';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import { Between, DataSource, In, Not, Repository } from 'typeorm';
import { PaginatedResult, parsePagination, resolveDateRange } from 'src/common/pagination.util';
import { ChargeShipment, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { ValidationPayloadDto } from 'src/unloading/dto/validate-payload.dto';
import { MailService } from 'src/mail/mail.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import * as ExcelJS from 'exceljs';
import { fromZonedTime } from 'date-fns-tz';
import { LD_QUALIFYING_SQL_IN } from 'src/common/ld-codes';
import { classifyLd } from 'src/common/ld-rule.util';
import { TemplateService } from 'src/documents/template.service';
import { buildInventoryData, InventoryInput } from 'src/documents/data/inventory.mapper';
import { buildInventoryNo67Data } from 'src/documents/data/inventory-no67.mapper';
import { buildMissingScanReport, MISSING_SCAN_REPORT_WINDOW, missingScanWhere } from './missing-scan-report';
import { INVENTORY_STATUS_SOURCE, realMovementSql } from 'src/common/inventory-movement.util';
import { buildCcList, escapeHtml, pickCriticalPackages } from './inventory-critical.util';
import { canAccessSubsidiary, foreignTrackings } from './inventory-scope.util';
import {
  diffInventories,
  emptyGoneCounts,
  inventoryGoneBucket,
  InventoryGoneCounts,
  inventoryPackageKey,
  InventoryPackageRow,
} from './inventory-compare.util';
import { herDay } from 'src/common/ld-rule.util';
import { daysWithoutLocalScan, isLocalScanCode, latestLocalScan, LocalScan, localScanCategory, LOCAL_SCAN_CODES_SQL } from 'src/utils/local-scan-visibility.util';

// Candado temporal del reporte "Sin código 44": vive con su motor (missing-scan-report.ts).
export { MISSING_SCAN_REPORT_WINDOW };

export interface ShipmentWithout67 {
  trackingNumber: string;
  currentStatus: string;
  statusHistoryCount: number;
  exceptionCodes: string[];
  firstStatusDate: Date | null;
  lastStatusDate: Date | null;
  daysInSystem: number | null;
  /** Alta del shipment (createdAt) en ISO, para "Días con el paquete". */
  createdAt: string | null;
  /** Código que monitorea la sucursal ('44' | '67'). */
  scanCode: '44' | '67';
  /** Para la confirmación con FedEx desde el front. */
  shipmentType?: string;
  fedexUniqueId?: string | null;
  comment: string;
}

export interface Inventory67Response {
  summary: {
    totalShipments: number;
    withoutCode67: number;
    withCode67: number;
    inventoryDate?: Date;
    percentageWithout67: number;
    inventoryId?: string;
  };
  details: ShipmentWithout67[];
}

@Injectable()
export class InventoriesService {
  private readonly logger = new Logger(InventoriesService.name);

  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
    private readonly mailService: MailService,
    private readonly dataSource: DataSource,
    private readonly templateService: TemplateService,
  ){}


  async create(createInventoryDto: CreateInventoryDto, userId?: string) {
    const { inventoryDate, shipments = [], chargeShipments = [], subsidiary } = createInventoryDto;
    // El front mandaba `inventoryType` y aquí se esperaba `type`: todo quedaba "Inicial".
    const requestedType = createInventoryDto.type ?? createInventoryDto.inventoryType;
    const type = Object.values(InventoryType).includes(requestedType as InventoryType)
      ? (requestedType as InventoryType)
      : InventoryType.INITIAL;
    const rejectedTrackings = (createInventoryDto.rejectedTrackings ?? [])
      .filter((r) => r?.trackingNumber)
      .map((r) => ({
        trackingNumber: String(r.trackingNumber).trim(),
        reason: String(r.reason ?? '').slice(0, 300),
        kind: String(r.kind ?? ''),
      }));

    if (!subsidiary?.id) throw new BadRequestException('Selecciona una sucursal para guardar el inventario.');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Cargar las entidades necesarias dentro de la transacción
      const shipmentsToSave = shipments.length
        ? await queryRunner.manager.find(Shipment, { where: { id: In(shipments) }, relations: ['subsidiary'] })
        : [];
      const chargeShipmentsToSave = chargeShipments.length
        ? await queryRunner.manager.find(ChargeShipment, { where: { id: In(chargeShipments) }, relations: ['subsidiary'] })
        : [];
      const subsidiaryObj = await queryRunner.manager.findOneBy(Subsidiary, {
        id: subsidiary.id
      });

      if (!subsidiaryObj) {
        throw new BadRequestException('La sucursal seleccionada no existe.');
      }

      // Todo paquete del inventario debe ser de ESA sucursal (antes se aceptaba cualquier id).
      const foreign = foreignTrackings([...shipmentsToSave, ...chargeShipmentsToSave], subsidiaryObj.id);
      if (foreign.length > 0) {
        const list = foreign.slice(0, 20).join(', ') + (foreign.length > 20 ? ` y ${foreign.length - 20} más` : '');
        throw new BadRequestException(`Estas guías son de otra sucursal: ${list}. Quítalas o traspásalas antes de guardar.`);
      }

      // 2. Crear y Guardar el Inventario
      // Esto guardará automáticamente las relaciones en las tablas pivote
      const newInventory = queryRunner.manager.create(Inventory, {
        inventoryDate: inventoryDate || new Date(),
        shipments: shipmentsToSave,
        chargeShipments: chargeShipmentsToSave,
        subsidiary: subsidiaryObj,
        createdById: userId ?? null,
        type,
        rejectedTrackings: rejectedTrackings.length ? rejectedTrackings : null,
      });

      const savedInventory = await queryRunner.manager.save(newInventory);

      // 3. Preparar Fecha Localizada (Hermosillo)
      const now = new Date();
      //const utcDate = fromZonedTime(now, 'America/Hermosillo');

      // 4. Generar historial para cada paquete (Bulk History)
      const historyRecords: ShipmentStatus[] = [];

      // Historial para Shipments normales
      shipmentsToSave.forEach(s => {
        historyRecords.push(queryRunner.manager.create(ShipmentStatus, {
          status: s.status, // Mantenemos su status actual (probablemente EN_BODEGA)
          notes: `Paquete confirmado en inventario físico (Folio Inv: ${savedInventory.id}) en ${subsidiaryObj.name}`,
          timestamp: now,
          source: INVENTORY_STATUS_SOURCE, // no es movimiento (ver inventory-movement.util)
          shipment: s
        }));
      });

      // Historial para ChargeShipments (F2)
      chargeShipmentsToSave.forEach(cs => {
        historyRecords.push(queryRunner.manager.create(ShipmentStatus, {
          status: cs.status,
          notes: `Paquete F2 confirmado en inventario físico (Folio Inv: ${savedInventory.id}) en ${subsidiaryObj.name}`,
          timestamp: now,
          source: INVENTORY_STATUS_SOURCE,
          chargeShipment: cs
        }));
      });

      // Guardado masivo de historiales
      if (historyRecords.length > 0) {
        await queryRunner.manager.save(ShipmentStatus, historyRecords);
      }

      // Foto del estatus de cada paquete AL MOMENTO del inventario (mig 122). Si la columna aún
      // no existe (migración pendiente) se avisa y el inventario se guarda igual: en MySQL un
      // error de sentencia no aborta la transacción.
      try {
        if (shipmentsToSave.length) {
          await queryRunner.query(
            'UPDATE inventory_shipment j JOIN shipment s ON s.id = j.shipmentId SET j.statusAtInventory = s.status WHERE j.inventoryId = ?',
            [savedInventory.id],
          );
        }
        if (chargeShipmentsToSave.length) {
          await queryRunner.query(
            'UPDATE inventory_charge_shipments j JOIN charge_shipment cs ON cs.id = j.chargeShipmentId SET j.statusAtInventory = cs.status WHERE j.inventoryId = ?',
            [savedInventory.id],
          );
        }
      } catch (e) {
        this.logger.warn(`No se guardó el estatus al inventario (¿falta la migración 122?): ${e?.message}`);
      }

      // 5. Confirmar transacción
      await queryRunner.commitTransaction();
      
      this.logger.log(`Inventario guardado. ID: ${savedInventory.id}. Sucursal: ${subsidiaryObj.name}`);
      return savedInventory;

    } catch (error) {
      // Si algo falla, rollback de todo el inventario e historiales
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error al crear inventario: ${error.message}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async validatePackage(
      packageToValidate: ValidatedPackageDispatchDto,
      subsidiaryId: string
    ): Promise<ValidatedPackageDispatchDto> {
      let isValid = true;
      let reason = '';
  
      /*const existePackageOnPackageDispatch = await this.inventoryRepository
      .createQueryBuilder('package')
      .leftJoinAndSelect('shipment', 'shipment', 'shipment.routeId = package.id')
      .select([
        'package.id AS package_id',
        'shipment.trackingNumber AS shipment_trackingNumber', // Fix: Use shipment.trackingNumber
        'package.status AS package_status',
        'package.startTime AS package_startTime',
        'package.estimatedArrival AS package_estimatedArrival',
        'package.createdAt AS package_createdAt',
        'package.updatedAt AS package_updatedAt',
        'package.vehicleId AS package_vehicleId',
        'package.subsidiaryId AS package_subsidiaryId',
      ])
      .where('shipment.trackingNumber = :trackingNumber', { trackingNumber: packageToValidate.trackingNumber })
      .getRawOne();*/
  
      /*const existPackageOnReturn = await this.devolutionRepository.findOne({
        where: { trackingNumber: packageToValidate.trackingNumber },
      })*/
  
      /*if (existePackageOnPackageDispatch) {
        isValid = false;
        reason = 'El paquete ya existe en otra salida a ruta';
      }
  
      if(existPackageOnReturn) {
        isValid = false;
        reason = 'El paquete existe en una devolución';
      }*/
  
      if (packageToValidate.subsidiary.id !== subsidiaryId) {
        isValid = false;
        reason = 'El paquete no pertenece a la sucursal actual';
      }
  
      // Permitir por ahora...
      /*if (packageToValidate.status === ShipmentStatusType.ENTREGADO) {
        isValid = false;
        reason = 'El paquete ya ha sido entregado';
      }*/
  
      return {
        ...packageToValidate,
        isValid,
        reason
      };
  }

  async validateTrackingNumbersResp1306(
    trackingNumbers: string[],
    subsidiaryId?: string
  ): Promise<{
    validatedShipments: (ValidatedPackageDispatchDto & { isCharge?: boolean })[];
  }> {
    // 1. Consultas iniciales en paralelo
    const [shipments, chargeShipments] = await Promise.all([
      this.shipmentRepository.find({
        where: { trackingNumber: In(trackingNumbers), status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
        relations: ['subsidiary', 'statusHistory', 'payment', 'packageDispatch'],
        order: { createdAt: 'DESC' },
      }),
      this.chargeShipmentRepository.find({
        where: { trackingNumber: In(trackingNumbers), status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
        relations: ['subsidiary', 'charge', 'packageDispatch', 'payment'],
      }),
    ]);

    const shipmentsMap = new Map(shipments.map(s => [s.trackingNumber, s]));
    const chargeMap = new Map(chargeShipments.map(c => [c.trackingNumber, c]));

    const validatedShipments: (ValidatedPackageDispatchDto & { isCharge?: boolean })[] = [];
    
    // --- CONFIGURACIÓN DE CONCURRENCIA ---
    const CHUNK_SIZE = 20; // Procesa 20 paquetes a la vez
    for (let i = 0; i < trackingNumbers.length; i += CHUNK_SIZE) {
      const chunk = trackingNumbers.slice(i, i + CHUNK_SIZE);
      
      // Creamos las promesas para el lote actual
      const chunkPromises = chunk.map(async (tn) => {
        const shipment = shipmentsMap.get(tn);
        if (shipment) {
          const validated = await this.validatePackage({ ...shipment, isValid: false }, subsidiaryId);
          return { ...validated, isCharge: false };
        }

        const chargeShipment = chargeMap.get(tn);
        if (chargeShipment) {
          const validatedCharge = await this.validatePackage({ ...chargeShipment, isValid: false }, subsidiaryId);
          return { ...validatedCharge, isCharge: true };
        }

        return {
          trackingNumber: tn,
          isValid: false,
          reason: 'No se encontraron datos para el tracking number en la base de datos',
          subsidiary: null,
          status: null,
        };
      });

      // Esperamos a que el lote de 20 termine antes de seguir con el siguiente
      const results = await Promise.all(chunkPromises);
      validatedShipments.push(...results);
    }

    return { validatedShipments };
  }

  /**
   * Validación incremental "en vivo".
   *
   * El frontend manda TODO lo escaneado, pero marca con `isAlreadyValidated`
   * lo que ya validó antes (trae su data en el payload). Aquí solo consultamos
   * la BD para los NUEVOS, así cada escaneo responde al instante en vez de
   * revalidar toda la lista.
   *
   * Además, cuando un trackingNumber/dhlUniqueId existe varias veces en BD se
   * conserva SIEMPRE el registro más reciente (createMostRecentLookup).
   */
  async validateTrackingNumbers(
    payload: ValidationPayloadDto[],
    subsidiaryId?: string
  ): Promise<{
    validatedShipments: (ValidatedPackageDispatchDto & { isCharge?: boolean })[];
  }> {
    if (!payload || payload.length === 0) {
      return { validatedShipments: [] };
    }

    // 1. Solo los NUEVOS van a la BD; los ya validados se reusan del payload (caché).
    const newItems = payload.filter(p => !p.isAlreadyValidated && p.trackingNumber);

    // 2. Variantes JJD/JD + búsqueda por dhlUniqueId, solo para los nuevos.
    const searchSet = new Set<string>();
    const originalToVariants = new Map<string, string[]>();
    for (const { trackingNumber: tn } of newItems) {
      const variants = [tn];
      if (tn.startsWith('JJD')) variants.push(tn.substring(1));
      else if (tn.startsWith('JD')) variants.push('J' + tn);
      variants.forEach(v => searchSet.add(v));
      originalToVariants.set(tn, variants);
    }

    // 3. Consulta única solo de los nuevos.
    let shipments: Shipment[] = [];
    let chargeShipments: ChargeShipment[] = [];
    if (searchSet.size > 0) {
      const allToSearch = Array.from(searchSet);
      [shipments, chargeShipments] = await Promise.all([
        this.shipmentRepository.find({
          where: [
            { trackingNumber: In(allToSearch), status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
            { dhlUniqueId: In(allToSearch), status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
          ],
          relations: ['subsidiary', 'payment'],
          order: { createdAt: 'DESC' },
        }),
        this.chargeShipmentRepository.find({
          where: { trackingNumber: In(allToSearch), status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) },
          relations: ['subsidiary', 'payment'],
          order: { createdAt: 'DESC' },
        }),
      ]);
    }

    // 4. Mapas que conservan SIEMPRE el registro más reciente (por trackingNumber y dhlUniqueId).
    const shipmentsMap = this.createMostRecentLookup(shipments);
    const chargeMap = this.createMostRecentLookup(chargeShipments);

    // 5. Armar la respuesta en el ORDEN del payload, deduplicando escaneos repetidos.
    const validatedShipments: (ValidatedPackageDispatchDto & { isCharge?: boolean })[] = [];
    const processed = new Set<string>();

    for (const item of payload) {
      const tn = item.trackingNumber?.trim();
      if (!tn) continue;

      const key = tn.toUpperCase();
      if (processed.has(key)) continue; // mismo escaneo repetido -> uno solo
      processed.add(key);

      // 🟢 Cacheado: reusar lo ya validado (no toca BD).
      if (item.isAlreadyValidated) {
        validatedShipments.push({ ...(item as any) });
        continue;
      }

      // 🔵 Nuevo: buscar por variante (más reciente).
      const variants = originalToVariants.get(item.trackingNumber) || [item.trackingNumber];
      let matchedShipment: any = null;
      let matchedCharge: any = null;
      for (const v of variants) {
        const vk = v.toUpperCase();
        if (shipmentsMap.has(vk)) { matchedShipment = shipmentsMap.get(vk); break; }
        if (chargeMap.has(vk)) { matchedCharge = chargeMap.get(vk); break; }
      }

      if (matchedShipment) {
        const validated = await this.validatePackage({ ...matchedShipment, isValid: false }, subsidiaryId);
        validatedShipments.push({ ...validated, isCharge: false });
      } else if (matchedCharge) {
        const validatedCharge = await this.validatePackage({ ...matchedCharge, isValid: false }, subsidiaryId);
        validatedShipments.push({ ...validatedCharge, isCharge: true });
      } else {
        validatedShipments.push({
          trackingNumber: tn,
          isValid: false,
          reason: 'No se encontraron datos para el tracking number en la base de datos',
          subsidiary: null,
          status: null,
        });
      }
    }

    await this.attachZoneCities(validatedShipments as any[], subsidiaryId);
    await this.attachCurrentStatusAt(validatedShipments as any[]);
    return { validatedShipments };
  }

  /**
   * Pone `zoneCity` (ciudad para agrupar/ordenar) a cada paquete: memoria de CP por
   * sucursal (`subsidiary_zip_coverage`) y, si el CP no está, la ciudad de la guía.
   */
  async attachZoneCities<T extends { recipientZip?: string | null; recipientCity?: string | null; zoneCity?: string | null }>(
    packages: T[],
    subsidiaryId?: string | null,
  ): Promise<T[]> {
    const zips = [...new Set(packages.map((p) => (p?.recipientZip ?? '').trim()).filter(Boolean))];
    let rows: ZipCoverageRow[] = [];
    if (zips.length) {
      try {
        rows = await this.dataSource.query(
          'SELECT zip, city, subsidiaryId, share, status FROM subsidiary_zip_coverage WHERE zip IN (?)',
          [zips],
        );
      } catch (e) {
        // Sin memoria de CP no se rompe el inventario: se usa la ciudad de la guía.
        this.logger.warn(`No se pudo leer la memoria de CP: ${e?.message}`);
      }
    }
    const zipCities = buildZipCityMap(rows, subsidiaryId);
    for (const p of packages) {
      if (p && !p.zoneCity) p.zoneCity = resolveZoneCity(p, zipCities);
    }
    return packages;
  }

  /**
   * Indexa por trackingNumber Y dhlUniqueId (en mayúsculas) conservando siempre
   * el registro con createdAt más reciente. Resuelve "tomar el más nuevo" cuando
   * un mismo número aparece varias veces en BD.
   */
  private createMostRecentLookup<T extends { trackingNumber?: string; dhlUniqueId?: string; createdAt?: Date }>(
    items: T[]
  ): Map<string, T> {
    const map = new Map<string, T>();
    const put = (raw: string | undefined, item: T) => {
      if (!raw) return;
      const key = raw.trim().toUpperCase();
      const existing = map.get(key);
      if (!existing || new Date(item.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
        map.set(key, item);
      }
    };
    for (const item of items) {
      put(item.trackingNumber, item);
      put((item as any).dhlUniqueId, item);
    }
    return map;
  }

  async findAll(
    subsidiaryId: string,
    opts: {
      page?: string | number;
      limit?: string | number;
      from?: string;
      to?: string;
      search?: string;
      type?: string;
      sortBy?: string;
      sortDir?: string;
    } = {},
  ): Promise<PaginatedResult<any>> {
    const { start, end } = resolveDateRange(opts.from, opts.to);
    const { page, limit, skip } = parsePagination(opts.page, opts.limit);
    const search = (opts.search || '').trim();
    const type = opts.type && opts.type !== 'all' ? opts.type : undefined;

    // Búsqueda por folio O por guía (FedEx o pieza DHL, con variante JJD/JD). Con búsqueda se
    // busca en TODAS las fechas (así también abre el enlace de los correos de otra semana).
    const upper = search.toUpperCase();
    const variants = [upper];
    if (upper.startsWith('JJD')) variants.push(upper.slice(1));
    else if (upper.startsWith('JD')) variants.push('J' + upper);
    const trackingMatchSql =
      `(EXISTS (SELECT 1 FROM inventory_shipment js JOIN shipment s ON s.id = js.shipmentId
                 WHERE js.inventoryId = inventory.id AND (s.trackingNumber IN (:...variants) OR s.dhlUniqueId IN (:...variants)))
        OR EXISTS (SELECT 1 FROM inventory_charge_shipments jc JOIN charge_shipment cs ON cs.id = jc.chargeShipmentId
                 WHERE jc.inventoryId = inventory.id AND cs.trackingNumber IN (:...variants)))`;

    const applyFilters = <T extends import('typeorm').SelectQueryBuilder<Inventory>>(qb: T): T => {
      qb.where('subsidiary.id = :subsidiaryId', { subsidiaryId });
      if (search) {
        qb.andWhere(`(inventory.trackingNumber LIKE :search OR ${trackingMatchSql})`, { search: `%${search}%`, variants });
      } else {
        qb.andWhere('inventory.inventoryDate BETWEEN :start AND :end', { start, end });
      }
      if (type) qb.andWhere('inventory.type = :type', { type });
      return qb;
    };

    const total = await applyFilters(
      this.inventoryRepository.createQueryBuilder('inventory').leftJoin('inventory.subsidiary', 'subsidiary'),
    ).getCount();

    // Orden de TODO el historial (no solo la página): columnas permitidas.
    const SORTS: Record<string, string> = {
      trackingNumber: 'inventory.trackingNumber',
      type: 'inventory.type',
      createdBy: 'createdByName',
      totalPackages: 'totalPackages',
      rejectedCount: 'rejectedCount',
      inventoryDate: 'inventory.inventoryDate',
    };
    const sortCol = SORTS[opts.sortBy ?? ''] ?? SORTS.inventoryDate;
    const sortDir: 'ASC' | 'DESC' = String(opts.sortDir ?? '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const qb = applyFilters(
      this.inventoryRepository
        .createQueryBuilder('inventory')
        .leftJoin('inventory.subsidiary', 'subsidiary')
        .leftJoin('inventory.createdBy', 'createdBy')
        .leftJoin('inventory.shipments', 'shipments')
        .leftJoin('inventory.chargeShipments', 'chargeShipments'),
    )
      .select([
        'inventory.id',
        'inventory.trackingNumber',
        'inventory.inventoryDate',
        'inventory.createdAt',
        'inventory.type',
        'inventory.rejectedTrackings',
        'subsidiary.id',
        'subsidiary.name',
      ])
      .addSelect('COUNT(DISTINCT shipments.id)', 'shipmentsCount')
      .addSelect('COUNT(DISTINCT chargeShipments.id)', 'chargeShipmentsCount')
      .addSelect('COUNT(DISTINCT shipments.id) + COUNT(DISTINCT chargeShipments.id)', 'totalPackages')
      .addSelect('COALESCE(JSON_LENGTH(inventory.rejectedTrackings), 0)', 'rejectedCount')
      .addSelect("TRIM(CONCAT(IFNULL(createdBy.name, ''), ' ', IFNULL(createdBy.lastName, '')))", 'createdByName');
    if (search) qb.addSelect(`CASE WHEN ${trackingMatchSql} THEN 1 ELSE 0 END`, 'matchedByTracking');

    const { entities, raw } = await qb
      .groupBy('inventory.id')
      .addGroupBy('subsidiary.id')
      .addGroupBy('createdBy.id')
      .orderBy(sortCol, sortDir)
      .addOrderBy('inventory.id', 'DESC')
      .offset(skip)
      .limit(limit)
      .getRawAndEntities();

    // "Contra el anterior": solo para los inventarios de esta página.
    const summaries = await this.compareSummaries(
      entities.map((inv) => ({ id: inv.id, inventoryDate: inv.inventoryDate, subsidiaryId: inv.subsidiary?.id ?? subsidiaryId })),
    );

    const data = entities.map((inv) => {
      const r = raw.find((x) => x.inventory_id === inv.id);
      const sc = Number(r?.shipmentsCount || 0);
      const cc = Number(r?.chargeShipmentsCount || 0);
      const { rejectedTrackings, ...rest } = inv;
      return {
        ...rest,
        shipmentsCount: sc,
        chargeShipmentsCount: cc,
        totalPackages: sc + cc,
        rejectedCount: Array.isArray(rejectedTrackings) ? rejectedTrackings.length : 0,
        createdByName: (r?.createdByName || '').trim() || null,
        matchedByTracking: Number(r?.matchedByTracking || 0) === 1,
        compareSummary: summaries.get(inv.id) ?? null,
      };
    });

    return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** Paquetes de un inventario (envíos + cargas) con lo necesario para comparar y mostrar. */
  private async inventoryPackages(inventoryId: string, light = false): Promise<InventoryPackageRow[]> {
    if (light) {
      // Historial: solo lo necesario para contar (sin datos del destinatario ni cobro).
      const [ships, charges] = await Promise.all([
        this.dataSource.query(
          `SELECT s.id, s.trackingNumber, s.dhlUniqueId, s.status, 0 AS isCharge
             FROM inventory_shipment j JOIN shipment s ON s.id = j.shipmentId WHERE j.inventoryId = ?`,
          [inventoryId],
        ),
        this.dataSource.query(
          `SELECT cs.id, cs.trackingNumber, NULL AS dhlUniqueId, cs.status, 1 AS isCharge
             FROM inventory_charge_shipments j JOIN charge_shipment cs ON cs.id = j.chargeShipmentId WHERE j.inventoryId = ?`,
          [inventoryId],
        ),
      ]);
      return [...ships, ...charges];
    }
    const [ships, charges] = await Promise.all([
      this.dataSource.query(
        `SELECT s.id, s.trackingNumber, s.dhlUniqueId, s.recipientName, s.recipientAddress, s.recipientCity,
                s.recipientZip, s.commitDateTime, s.status, 0 AS isCharge,
                (SELECT CONCAT(p.type, ' $', p.amount) FROM payment p WHERE p.id = s.paymentId OR p.shipmentId = s.id LIMIT 1) AS paymentLabel
           FROM inventory_shipment j JOIN shipment s ON s.id = j.shipmentId WHERE j.inventoryId = ?`,
        [inventoryId],
      ),
      this.dataSource.query(
        `SELECT cs.id, cs.trackingNumber, NULL AS dhlUniqueId, cs.recipientName, cs.recipientAddress, cs.recipientCity,
                cs.recipientZip, cs.commitDateTime, cs.status, 1 AS isCharge,
                (SELECT CONCAT(p.type, ' $', p.amount) FROM payment p WHERE p.chargeShipmentId = cs.id LIMIT 1) AS paymentLabel
           FROM inventory_charge_shipments j JOIN charge_shipment cs ON cs.id = j.chargeShipmentId WHERE j.inventoryId = ?`,
        [inventoryId],
      ),
    ]);
    return [...ships, ...charges];
  }

  /**
   * Último movimiento REAL (sin confirmaciones de inventario) de cada paquete ENTRE `since` y
   * `until` (los dos inventarios que se comparan). Llave `s:<id>` / `c:<id>`.
   */
  private async lastMovementsSince(
    rows: { id: string; isCharge?: boolean | number | null }[],
    since: Date,
    until: Date,
  ): Promise<Map<string, { at: Date; status: string; exceptionCode: string | null; notes: string | null }>> {
    const out = new Map<string, { at: Date; status: string; exceptionCode: string | null; notes: string | null }>();
    const groups: [string, string, string[]][] = [
      ['s', 'shipmentId', rows.filter((r) => !Number(r.isCharge ?? 0)).map((r) => r.id)],
      ['c', 'chargeShipmentId', rows.filter((r) => !!Number(r.isCharge ?? 0)).map((r) => r.id)],
    ];
    for (const [prefix, fk, ids] of groups) {
      for (let i = 0; i < ids.length; i += 800) {
        const part = ids.slice(i, i + 800);
        if (!part.length) continue;
        const found: any[] = await this.dataSource.query(
          `SELECT ${fk} AS id, timestamp AS at, status, exceptionCode, notes FROM shipment_status
            WHERE ${fk} IN (${part.map(() => '?').join(',')}) AND timestamp > ? AND timestamp <= ? AND ${realMovementSql()}
            ORDER BY timestamp DESC`,
          [...part, since, until],
        );
        for (const r of found) {
          const key = `${prefix}:${r.id}`;
          if (!out.has(key)) out.set(key, { at: new Date(r.at), status: r.status, exceptionCode: r.exceptionCode || null, notes: r.notes || null });
        }
      }
    }
    return out;
  }

  /** Inventario anterior de la misma sucursal el mismo día (hora Hermosillo), o null. */
  private async previousSameDay(inv: { id: string; inventoryDate: Date; subsidiaryId?: string | null }) {
    if (!inv.subsidiaryId) return null;
    const dayStart = fromZonedTime(`${herDay(inv.inventoryDate)}T00:00:00.000`, 'America/Hermosillo');
    return this.inventoryRepository
      .createQueryBuilder('i')
      .select(['i.id', 'i.trackingNumber', 'i.inventoryDate', 'i.type'])
      .where('i.subsidiaryId = :sub', { sub: inv.subsidiaryId })
      .andWhere('i.id <> :id', { id: inv.id })
      .andWhere('i.inventoryDate >= :dayStart AND i.inventoryDate < :at', { dayStart, at: inv.inventoryDate })
      .orderBy('i.inventoryDate', 'DESC')
      .getOne();
  }

  /**
   * Comparación completa contra el anterior: las que ya no están, cada una con su grupo
   * (Sin movimiento / Bodega / DEX / Ruta / POD / Otros), sus datos y su último movimiento.
   */
  private async buildComparison(inv: { id: string; inventoryDate: Date; subsidiaryId?: string | null }, light = false) {
    const previous = await this.previousSameDay(inv);
    if (!previous) return null;
    const [prevPkgs, currPkgs] = await Promise.all([this.inventoryPackages(previous.id, light), this.inventoryPackages(inv.id, light)]);
    const diff = diffInventories(prevPkgs, currPkgs);
    // Para contar, el movimiento solo decide entre Bodega y Sin movimiento (las que siguen "en
    // bodega"); en el detalle se trae para todas porque se muestra.
    const needMoves = light
      ? (diff.gone as any[]).filter((g) => ['sinMovimiento', 'bodega'].includes(inventoryGoneBucket(g.status, false)))
      : (diff.gone as any[]);
    // Lo que pasó ENTRE los dos inventarios (no después): es lo que explica si debía estar o no.
    const moves = await this.lastMovementsSince(needMoves, new Date(previous.inventoryDate), new Date(inv.inventoryDate));
    const counts: InventoryGoneCounts = emptyGoneCounts();
    const gone = diff.gone.map((g: any) => {
      const lastMovement = moves.get(`${g.isCharge ? 'c' : 's'}:${g.id}`) ?? null;
      const bucket = inventoryGoneBucket(g.status, !!lastMovement);
      counts[bucket]++;
      return {
        id: g.id,
        trackingNumber: g.trackingNumber,
        dhlUniqueId: g.dhlUniqueId ?? null,
        recipientName: g.recipientName ?? null,
        recipientAddress: g.recipientAddress ?? null,
        recipientCity: g.recipientCity ?? null,
        recipientZip: g.recipientZip ?? null,
        commitDateTime: g.commitDateTime ? new Date(g.commitDateTime).toISOString() : null,
        paymentLabel: g.paymentLabel ?? null,
        status: g.status ?? null,
        isCharge: !!g.isCharge,
        bucket,
        lastMovement: lastMovement
          ? { at: lastMovement.at.toISOString(), status: lastMovement.status, exceptionCode: lastMovement.exceptionCode, notes: lastMovement.notes }
          : null,
      };
    });
    return {
      previous: {
        id: previous.id,
        trackingNumber: previous.trackingNumber,
        inventoryDate: previous.inventoryDate,
        type: previous.type,
        totalPackages: new Set(prevPkgs.map(inventoryPackageKey)).size,
      },
      counts,
      gone,
      appearedKeys: diff.appearedKeys,
      keptKeys: diff.keptKeys,
    };
  }

  /**
   * Comparación contra el inventario ANTERIOR de la misma sucursal el mismo día (hora Hermosillo).
   * Sin anterior ese día → `previous: null`.
   */
  async compareWithPrevious(id: string, user?: { role?: string; subsidiaryIds?: string[] }) {
    const inv = await this.inventoryRepository.findOne({
      where: { id },
      relations: ['subsidiary'],
      select: { id: true, inventoryDate: true, type: true, subsidiary: { id: true } },
    });
    if (!inv) throw new NotFoundException('No se encontró el inventario.');
    this.assertSubsidiaryAccess(user, inv.subsidiary?.id);
    const cmp = await this.buildComparison({ id: inv.id, inventoryDate: inv.inventoryDate, subsidiaryId: inv.subsidiary?.id });
    return cmp ?? { previous: null, counts: emptyGoneCounts(), gone: [], appearedKeys: [], keptKeys: [] };
  }

  /** Resumen de la comparación para la columna "Contra el anterior" del historial (por renglón). */
  private async compareSummaries(rows: { id: string; inventoryDate: Date; subsidiaryId?: string | null }[]) {
    const out = new Map<string, any>();
    // De a pocos para no acaparar el pool de conexiones.
    for (let i = 0; i < rows.length; i += 5) {
      const part = rows.slice(i, i + 5);
      const res = await Promise.all(
        part.map((r) =>
          this.buildComparison(r, true).catch((e) => {
            this.logger.warn(`No se pudo comparar el inventario ${r.id}: ${e?.message}`);
            return null;
          }),
        ),
      );
      part.forEach((r, k) => {
        const c = res[k];
        out.set(r.id, c
          ? {
              previousType: c.previous.type,
              previousDate: c.previous.inventoryDate,
              counts: c.counts,
              appeared: c.appearedKeys.length,
              kept: c.keptKeys.length,
            }
          : null);
      });
    }
    return out;
  }

  async findOne(id: string) {
    return await this.inventoryRepository.findOneBy({ id });
  }

  /**
   * Pone `currentStatusAt`: cuándo llegó el paquete a su estatus ACTUAL (último renglón de historial
   * con ese estatus, sin confirmaciones de inventario). El Excel lo usa como fecha de entrega o de DEX.
   */
  private async attachCurrentStatusAt(pkgs: { id?: string; isCharge?: boolean; currentStatusAt?: string | null }[]) {
    const groups: [string, string, string, typeof pkgs][] = [
      ['shipmentId', 'shipment', 's', pkgs.filter((p) => p?.id && !p.isCharge)],
      ['chargeShipmentId', 'charge_shipment', 'c', pkgs.filter((p) => p?.id && p.isCharge)],
    ];
    try {
      for (const [fk, table, , list] of groups) {
        const byId = new Map(list.map((p) => [String(p.id), p]));
        const ids = [...byId.keys()];
        for (let i = 0; i < ids.length; i += 800) {
          const part = ids.slice(i, i + 800);
          if (!part.length) continue;
          const rows: any[] = await this.dataSource.query(
            `SELECT ss.${fk} AS id, MAX(ss.timestamp) AS at
               FROM shipment_status ss JOIN ${table} t ON t.id = ss.${fk}
              WHERE ss.${fk} IN (${part.map(() => '?').join(',')}) AND ss.status = t.status AND ${realMovementSql('ss')}
              GROUP BY ss.${fk}`,
            part,
          );
          for (const r of rows) {
            const p = byId.get(String(r.id));
            if (p && r.at) p.currentStatusAt = new Date(r.at).toISOString();
          }
        }
      }
    } catch (e) {
      // Sin la fecha el Excel solo deja la columna vacía; no rompe el detalle ni la validación.
      this.logger.warn(`No se pudo leer la fecha del estatus actual: ${e?.message}`);
    }
  }

  /** Pone `statusAtInventory` (estatus al guardar el inventario, mig 122) a cada paquete. */
  private async attachStatusAtInventory(inventory: Inventory) {
    try {
      const [ships, charges]: any[][] = await Promise.all([
        this.dataSource.query('SELECT shipmentId AS id, statusAtInventory AS st FROM inventory_shipment WHERE inventoryId = ?', [inventory.id]),
        this.dataSource.query('SELECT chargeShipmentId AS id, statusAtInventory AS st FROM inventory_charge_shipments WHERE inventoryId = ?', [inventory.id]),
      ]);
      const sm = new Map(ships.map((r) => [String(r.id), r.st ?? null]));
      const cm = new Map(charges.map((r) => [String(r.id), r.st ?? null]));
      for (const p of (inventory.shipments ?? []) as any[]) p.statusAtInventory = sm.get(String(p.id)) ?? null;
      for (const p of (inventory.chargeShipments ?? []) as any[]) p.statusAtInventory = cm.get(String(p.id)) ?? null;
    } catch (e) {
      // Sin la migración 122 el detalle sigue funcionando (solo estatus actual).
      this.logger.warn(`No se pudo leer el estatus al inventario: ${e?.message}`);
    }
  }

  /** Misma regla que SubsidiaryScopeGuard, para cuando la sucursal sale del registro y no del URL. */
  private assertSubsidiaryAccess(user: { role?: string; subsidiaryIds?: string[] } | undefined, subsidiaryId?: string | null) {
    if (!user) return; // llamadas internas
    if (canAccessSubsidiary(user, subsidiaryId)) return;
    throw new ForbiddenException('Solo puedes consultar datos de tus sucursales asignadas.');
  }

  /**
   * Inventario completo (con paquetes y su ciudad) para el detalle / exportación.
   * `user` acota por sucursal igual que SubsidiaryScopeGuard (aquí el param es el id del inventario).
   */
  async findOneFull(id: string, user?: { role?: string; subsidiaryIds?: string[] }) {
    const inventory = await this.inventoryRepository.findOne({
      where: { id },
      relations: [
        'subsidiary',
        'shipments',
        'shipments.payment',
        'chargeShipments',
        'chargeShipments.payment',
      ],
    });
    if (!inventory) throw new NotFoundException('No se encontró el inventario.');

    this.assertSubsidiaryAccess(user, inventory.subsidiary?.id);

    const subsidiaryId = inventory.subsidiary?.id;
    await this.attachZoneCities((inventory.shipments ?? []) as any[], subsidiaryId);
    await this.attachZoneCities((inventory.chargeShipments ?? []) as any[], subsidiaryId);
    await this.attachStatusAtInventory(inventory);
    await this.attachCurrentStatusAt([
      ...((inventory.shipments ?? []) as any[]).map((p) => Object.assign(p, { isCharge: false })),
      ...((inventory.chargeShipments ?? []) as any[]).map((p) => Object.assign(p, { isCharge: true })),
    ]);
    return inventory;
  }

  /**
   * Correo de "Paquetes críticos": paquetes del inventario que VENCEN HOY (hora Hermosillo) y
   * siguen activos. Solo se manda si hay al menos uno (ver inventory-critical.util).
   */
  async getPriorityPackages(inventory: Inventory) {
    if (!inventory) return null;

    const shipments = pickCriticalPackages(inventory.shipments || []);
    const chargeShipments = pickCriticalPackages(inventory.chargeShipments || []);
    const critical = [...shipments, ...chargeShipments];

    if (critical.length === 0) {
      this.logger.debug(`Inventario ${inventory.id}: sin paquetes que venzan hoy; no se manda correo de críticos.`);
      return { ...inventory, shipments, chargeShipments };
    }
    if (!inventory.subsidiary?.officeEmail) {
      this.logger.warn(`Inventario ${inventory.id}: la sucursal no tiene correo de oficina; no se manda correo de críticos.`);
      return { ...inventory, shipments, chargeShipments };
    }

    const fmtDay = (d: Date | string) => new Date(d).toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo' });
    const htmlRows = critical
      .map(
        (s) => `
            <tr style="border-bottom: 1px solid #ddd;">
              <td style="padding: 8px; text-align: center;">${escapeHtml(s.trackingNumber ?? 'N/A')}</td>
              <td style="padding: 8px;">${escapeHtml(s.subsidiary?.name ?? inventory.subsidiary?.name ?? 'N/A')}</td>
              <td style="padding: 8px; text-align: center;">${s.commitDateTime ? fmtDay(s.commitDateTime) : 'Sin fecha'}</td>
              <td style="padding: 8px; text-align: center;">${s.payment ? `${escapeHtml(s.payment.type)} $ ${escapeHtml(s.payment.amount)}` : ''}</td>
              <td style="padding: 8px; text-align: center;">${escapeHtml(s.status ?? 'N/A')}</td>
            </tr>`,
      )
      .join('');

    const htmlContent = `
        <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
          <h2 style="border-bottom: 3px solid #e74c3c; padding-bottom: 8px;">
            Reporte de Inventario con Paquetes Críticos
          </h2>
          <p>
            En el inventario <strong>${escapeHtml(inventory.trackingNumber ?? 'N/A')}</strong>
            hay <strong>${critical.length}</strong> paquete(s) que vencen hoy
            (<strong>${fmtDay(inventory.inventoryDate)}</strong>).
          </p>
          <p style="color:#c0392b; font-weight:bold;">
            Estos envíos deben ser considerados para <u>entrega inmediata</u>.
          </p>
          <table border="0" cellpadding="0" cellspacing="0"
            style="border-collapse: collapse; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.05); margin-top: 15px;">
            <thead style="background-color: #f7f7f7; text-align: center;">
              <tr>
                <th style="padding: 10px;">Tracking Number</th>
                <th style="padding: 10px;">Destino</th>
                <th style="padding: 10px;">Fecha de Vencimiento</th>
                <th style="padding: 10px;">Cobro</th>
                <th style="padding: 10px;">Estatus</th>
              </tr>
            </thead>
            <tbody>${htmlRows}</tbody>
          </table>
          <p style="margin-top: 20px;">
            Para un monitoreo detallado de los envíos, por favor visite:
            <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none;">https://app-pmy.vercel.app/</a>
          </p>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />
          <p style="font-size: 0.9em; color: #7f8c8d;">
            Este correo fue enviado automáticamente por el sistema.<br />
            Por favor, no responda a este mensaje.
          </p>
        </div>
      `;

    await this.mailService.sendHighPriorityPackagesOnInvetory({
      to: inventory.subsidiary.officeEmail,
      cc: buildCcList(inventory.subsidiary.officeEmailToCopy, 'sistemas@paqueteriaymensajeriadelyaqui.com'),
      htmlContent,
    });
    this.logger.log(`Inventario ${inventory.id}: correo de críticos enviado (${critical.length} paquete(s)).`);

    return { ...inventory, shipments, chargeShipments };
  }

  async sendByEmail(
    file: Express.Multer.File,
    excelFile: Express.Multer.File,
    subsidiaryName: string,
    inventoryId: string,
    user?: { role?: string; subsidiaryIds?: string[] },
    opts: { resend?: boolean } = {},
  ) {
    // Guarda crítica: con inventoryId vacío, TypeORM ignora la condición `id`
    // y devuelve un inventario arbitrario (el primero de la tabla), provocando
    // que el correo se envíe a la sucursal equivocada.
    if (!inventoryId) {
      throw new NotFoundException('inventoryId es requerido para enviar el correo de inventario.');
    }

    const inventory = await this.inventoryRepository.findOne(
      {
        where: {id: inventoryId},
        relations: [
          'subsidiary', 
          'shipments', 
          'chargeShipments', 
          'shipments.subsidiary',
          'shipments.payment', 
          'chargeShipments.subsidiary',
          'chargeShipments.payment',
        ]
      });

    if(!inventory) {
      throw new NotFoundException(`Inventario con id ${inventoryId} no encontrado`);
    }

    this.assertSubsidiaryAccess(user, inventory.subsidiary?.id);

    // El correo de críticos es un aviso extra: si falla, el correo del inventario sale igual.
    // En un REENVÍO desde el historial no se repite.
    try {
      if (!opts.resend) await this.getPriorityPackages(inventory);
    } catch (err) {
      this.logger.warn(`No se pudo enviar el correo de críticos del inventario ${inventory.id}: ${err?.message}`);
    }

    // Unificación "Inventario": detrás de flag, el backend genera PDF/Excel por el
    // Motor de Plantillas (plantilla canónica única). Si algo falla, se conservan los
    // archivos subidos por el frontend (respaldo). Flag OFF => comportamiento actual intacto.
    if (process.env.DOC_ENGINE_INVENTORY === 'true') {
      try {
        const input = this.loadInventoryInput(inventory, subsidiaryName);
        const gen = await this.renderInventoryDocuments(input);
        if (gen.pdf) file = { ...file, buffer: gen.pdf };
        if (gen.excel) excelFile = { ...excelFile, buffer: gen.excel };
      } catch (e: any) {
        this.logger.warn(`Motor inventario falló; uso archivos subidos: ${e?.message}`);
      }
    }

    try {
      return await this.mailService.sendHighPriorityInventoryEmail(
        file,
        excelFile,
        subsidiaryName,
        inventory
      );
    } catch (err) {
      this.logger.error(`Error al enviar correo de inventario con archivos adjuntos para ${inventory.id}`, err);
      throw err;
    }
  }

  /** Genera PDF+Excel de "Inventario" por el motor. Si un formato no entrega buffer, queda undefined (respaldo). */
  async renderInventoryDocuments(input: InventoryInput): Promise<{ pdf?: Buffer; excel?: Buffer }> {
    const data = buildInventoryData(input);
    const [pdf, excel] = await Promise.all([
      this.templateService.render('inventory_pdf', data).then((r) => r.buffer).catch(() => undefined),
      this.templateService.render('inventory_excel', data).then((r) => r.buffer).catch(() => undefined),
    ]);
    return { pdf, excel };
  }

  /** Arma el InventoryInput a partir del Inventory ya cargado (espejo backend de InventoryPDFReport/generateInventoryExcel).
   * Gap conocido: `Inventory` (entidad) NO persiste `missingTrackings`/`unScannedTrackings` (solo viven en el
   * payload transitorio del frontend antes de guardar el inventario); el data-provider degrada sin romper
   * (las secciones correspondientes simplemente no aparecen). */
  private loadInventoryInput(inventory: Inventory, subsidiaryName: string): InventoryInput {
    const map = (s: any, isCharge: boolean) => ({
      trackingNumber: s.trackingNumber,
      recipientName: s.recipientName,
      recipientAddress: s.recipientAddress,
      recipientZip: s.recipientZip,
      recipientPhone: s.recipientPhone,
      commitDateTime: s.commitDateTime ? new Date(s.commitDateTime).toISOString() : undefined,
      isCharge,
      isHighValue: s.isHighValue,
      payment: s.payment ? { amount: s.payment.amount, type: s.payment.type } : null,
    });
    return {
      subsidiaryName: inventory.subsidiary?.name ?? subsidiaryName,
      trackingNumber: inventory.trackingNumber ?? '',
      inventoryDate: inventory.inventoryDate,
      packages: [
        ...(inventory.shipments ?? []).map((s) => map(s, false)),
        ...(inventory.chargeShipments ?? []).map((s) => map(s, true)),
      ],
      missingTrackings: [],
      unScannedTrackings: [],
    };
  }

  async checkInventory67BySubsidiaryResp(subsidiaryId: string) {

    const inventory = await this.inventoryRepository.findOne({
      where: {
        subsidiary: { id: subsidiaryId }
      },
      order: {
        inventoryDate: 'DESC'
      },
      select: ['id', 'inventoryDate'],
      relations: {
        shipments: {
          statusHistory: true
        }
      }
    });  

    console.log('Último inventario encontrado:', inventory);

    if (!inventory) {
      this.logger.warn(`No se encontró inventario para la sucursal con id: ${subsidiaryId}`);
      return [];
    }

    const shipmentsWithout67 = [];

    for (const shipment of inventory.shipments) {
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

      // ⚠️ FALTABA ESTE RETURN - Agrégalo al final
      return {
        summary: {
          totalShipments: inventory.shipments.length,
          withoutCode67: shipmentsWithout67.length,
          withCode67: inventory.shipments.length - shipmentsWithout67.length,
        },
        details: shipmentsWithout67
      };


    /*return { 
      inventory: inventory,
      shipments: inventory.shipments
    };*/

  }

  /**
   * MÉTODO PRINCIPAL - Corregido para relación Inventory -> shipments (array)
   */
  async checkInventory67BySubsidiary(subsidiaryId: string): Promise<{
    summary: {
      totalShipments: number;
      withoutCode67: number;
      withCode67: number;
      inventoryDate?: Date;
      percentageWithout67: number;
      inventoryId?: string;
      scanCode?: '44' | '67';
    };
    details: ShipmentWithout67[];
  }> {
    const startTime = Date.now();
    
    try {
      // 1️⃣ OBTENER INVENTARIO MÁS RECIENTE CON SHIPMENTS
      const latestInventory = await this.getLatestInventoryWithShipments(subsidiaryId);
      
      if (!latestInventory) {
        this.logger.log(`⏱️ ${Date.now() - startTime}ms - Sin inventario`);
        return this.getEmptyResult();
      }

      console.log(`📦 Inventario ID: ${latestInventory.id}, Shipments: ${latestInventory.shipments?.length || 0}`);

      // Código por sucursal (44/67): el reporte usa el que la sucursal monitorea.
      const scanCode = await this.scanCodeForSubsidiary(subsidiaryId);

      // 2️⃣ PROCESAR SHIPMENTS DEL INVENTARIO
      const { shipmentsWithout67, totalShipments } =
        await this.processInventoryShipments(latestInventory, scanCode);

      const withoutCode67 = shipmentsWithout67.length;
      const withCode67 = Math.max(0, totalShipments - withoutCode67);
      const percentageWithout67 = totalShipments > 0 
        ? Math.round((withoutCode67 / totalShipments) * 100 * 10) / 10 
        : 0;

      this.logger.log(`⏱️ ${Date.now() - startTime}ms - ${withoutCode67}/${totalShipments} sin código 67`);

      return {
        summary: {
          totalShipments,
          withoutCode67,
          withCode67,
          inventoryDate: latestInventory.inventoryDate,
          percentageWithout67,
          inventoryId: latestInventory.id,
          scanCode, // '44' | '67' — código que monitorea la sucursal
        },
        details: shipmentsWithout67
      };

    } catch (error) {
      this.logger.error(`❌ Error: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Reporte de VISIBILIDAD 67 sobre los INVENTARIOS de una sucursal en un rango
   * (por defecto "ayer"). Busca los inventarios con `inventoryDate` en el rango,
   * junta sus paquetes (envíos + cargas) y los DEDUPLICA por guía: una sola fila
   * por paquete con su ESTATUS ACTUAL + los campos estilo Visibilidad 67 (alta,
   * último 67, días sin 67, categoría) + la lista de inventarios en los que
   * estuvo ese día (tipo/fecha). La confirmación con FedEx la hace el front
   * reutilizando el mismo endpoint de Visibilidad 67 (por número de guía).
   */
  /**
   * Último escaneo local (44 o 67) por paquete: un agregado sobre shipment_status, en bloques.
   * El código lo dice FedEx — una sucursal configurada en 67 puede recibir 44 (satélites de Obregón).
   */
  private async lastLocalScanBy(ids: string[], fkCol: string): Promise<Map<string, LocalScan>> {
    const m = new Map<string, LocalScan>();
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 1000) {
      const part = unique.slice(i, i + 1000);
      const ph = part.map(() => '?').join(',');
      const rows: any[] = await this.dataSource.query(
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
  }

  /** Código configurado de la sucursal (solo etiqueta): '44' si `monitorFedexCode44`, si no '67'. */
  private async scanCodeForSubsidiary(subsidiaryId: string): Promise<'44' | '67'> {
    const sub = await this.subsidiaryRepository.findOne({ where: { id: subsidiaryId }, select: ['monitorFedexCode44'] });
    return sub?.monitorFedexCode44 === true ? '44' : '67';
  }

  async getInventoryVisibilityReport(subsidiaryId: string, from: Date, to: Date) {
    const start = new Date(from); start.setHours(0, 0, 0, 0);
    const end = new Date(to); end.setHours(23, 59, 59, 999);
    // Código configurado (44/67): solo etiqueta los que nunca tuvieron escaneo. El que cuenta es
    // el que dio FedEx — 44 o 67, cualquiera (ver local-scan-visibility.util).
    const configuredCode = await this.scanCodeForSubsidiary(subsidiaryId);

    // 1) Inventarios del rango (solo metadatos — NO cargamos paquetes ni historial
    //    por relación: eso explotaba la memoria con el join de statusHistory).
    const invs = await this.inventoryRepository.find({
      where: { subsidiary: { id: subsidiaryId }, inventoryDate: Between(start, end) },
      select: ['id', 'type', 'inventoryDate'],
      order: { inventoryDate: 'ASC' },
    });
    if (invs.length === 0) {
      return { summary: { inventarios: 0, paquetes: 0, con67Hoy: 0, sin67: 0, nunca: 0 }, details: [] };
    }
    const invIds = invs.map((i) => i.id);
    const invMeta = new Map(invs.map((i) => [i.id, { type: String(i.type ?? 'initial'), inventoryDate: i.inventoryDate }]));

    // 2) Membresías paquete↔inventario vía tablas pivote, SOLO columnas necesarias
    //    (sin statusHistory, y envíos/cargas en consultas separadas para no hacer
    //    producto cartesiano shipments×chargeShipments).
    const PKG_COLS: [string, string][] = [
      ['trackingNumber', 'trackingNumber'], ['status', 'status'],
      ['recipientName', 'recipientName'], ['recipientAddress', 'recipientAddress'],
      ['recipientCity', 'recipientCity'], ['recipientZip', 'recipientZip'],
      ['shipmentType', 'shipmentType'], ['fedexUniqueId', 'fedexUniqueId'], ['createdAt', 'createdAt'],
    ];
    const buildPkgQuery = (repo: Repository<any>, alias: string, pivot: string, fk: string) => {
      const qb = repo.createQueryBuilder(alias)
        .innerJoin(pivot, 'j', `j.${fk} = ${alias}.id`)
        .where('j.inventoryId IN (:...invIds)', { invIds })
        // Solo los que REALMENTE se quedaron en bodega (estatus actual = en_bodega).
        .andWhere(`LOWER(${alias}.status) = :enBodega`, { enBodega: ShipmentStatusType.EN_BODEGA })
        // Solo FedEx: el 44/67 es de FedEx; DHL nunca se mezcla en estos reportes.
        .andWhere(`${alias}.shipmentType = 'fedex'`)
        .select(`${alias}.id`, 'id')
        .addSelect('j.inventoryId', 'inventoryId');
      for (const [col, as] of PKG_COLS) qb.addSelect(`${alias}.${col}`, as);
      return qb.getRawMany();
    };
    const [shipRows, chargeRows] = await Promise.all([
      buildPkgQuery(this.shipmentRepository, 's', 'inventory_shipment', 'shipmentId'),
      buildPkgQuery(this.chargeShipmentRepository, 'cs', 'inventory_charge_shipments', 'chargeShipmentId'),
    ]);

    // 3) Último escaneo local (44 o 67) por paquete — UN agregado sobre shipment_status,
    //    acotado a los ids de este reporte (chunked). Sin hidratar el historial.
    const max67By = (ids: string[], fkCol: string) => this.lastLocalScanBy(ids, fkCol);
    const [ship67, charge67] = await Promise.all([
      max67By(shipRows.map((r) => r.id), 'shipmentId'),
      max67By(chargeRows.map((r) => r.id), 'chargeShipmentId'),
    ]);

    // 4) Agregar por guía (dedup): estatus actual = copia más nueva; 67 = máximo
    //    entre copias; inventarios = en cuáles estuvo.
    type Agg = { rep: any; isCharge: boolean; max67: LocalScan | null; minCreatedAt: Date; inventories: { inventoryId: string; type: string; inventoryDate: Date }[] };
    const byGuide = new Map<string, Agg>();

    const ingest = (row: any, isCharge: boolean, max67Map: Map<string, LocalScan>) => {
      if (!row?.trackingNumber) return;
      const inv = invMeta.get(row.inventoryId);
      if (!inv) return;
      const max67 = max67Map.get(String(row.id)) ?? null;
      const createdAt = new Date(row.createdAt);
      const invRef = { inventoryId: row.inventoryId, type: inv.type, inventoryDate: inv.inventoryDate };
      const existing = byGuide.get(row.trackingNumber);
      if (!existing) {
        byGuide.set(row.trackingNumber, { rep: row, isCharge, max67, minCreatedAt: createdAt, inventories: [invRef] });
      } else {
        if (createdAt > new Date(existing.rep.createdAt)) existing.rep = row;
        existing.isCharge = existing.isCharge || isCharge;
        existing.max67 = latestLocalScan(existing.max67, max67);
        if (createdAt < existing.minCreatedAt) existing.minCreatedAt = createdAt;
        if (!existing.inventories.some((i) => i.inventoryId === row.inventoryId)) existing.inventories.push(invRef);
      }
    };
    shipRows.forEach((r) => ingest(r, false, ship67));
    chargeRows.forEach((r) => ingest(r, true, charge67));

    // Días sin código = días COMPLETOS sin escaneo en hora Hermosillo (escaneada anoche = al día).
    const now = new Date();
    const details = Array.from(byGuide.values()).map(({ rep, isCharge, max67, minCreatedAt, inventories }) => {
      const daysSinceLast67 = daysWithoutLocalScan(max67?.at ?? null, now);
      const cat = localScanCategory(daysSinceLast67);
      const category = cat === 'sinCodigo' ? 'sin67' : cat;
      // Orden cronológico de los inventarios en que estuvo (inicial→dex→final).
      const invSorted = [...inventories].sort((a, b) => new Date(a.inventoryDate).getTime() - new Date(b.inventoryDate).getTime());
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
        scanCode: max67?.code ?? configuredCode, // último código que dio FedEx (o el configurado si nunca hubo)
        configuredCode,
        createdAt: minCreatedAt.toISOString(),
        last67Date: max67 ? max67.at.toISOString() : null,
        daysSinceLast67,
        has67Today: category === 'hoy',
        category,
        inventories: invSorted.map((i) => ({ type: i.type, inventoryDate: i.inventoryDate, inventoryId: i.inventoryId })),
        inventoryTypes: invSorted.map((i) => i.type).join(', '),
        inventoryCount: invSorted.length,
      };
    });

    // Orden por defecto: alta en sistema, del más viejo al más nuevo.
    details.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const con67Hoy = details.filter((d) => d.category === 'hoy').length;
    const nunca = details.filter((d) => d.category === 'nunca').length;

    return {
      summary: {
        inventarios: invs.length,
        paquetes: details.length,
        con67Hoy,
        sin67: details.length - con67Hoy,
        nunca,
      },
      details,
    };
  }

  /**
   * Reporte "Sin código de escaneo por sucursal/zona" (el front lo llama "Sin código 44"): lista
   * los paquetes ACTIVOS (pendiente/en_bodega) de las sucursales indicadas —una lista, o toda una
   * zona ya resuelta a sucursales por el caller— y, por GUÍA (agregando todas sus copias), calcula
   * los días desde el último escaneo local de FedEx (44 o 67, el que haya dado FedEx; la config de
   * la sucursal solo etiqueta los que nunca tuvieron). Mismo motor que el welcome dashboard.
   *
   * IMPORTANTE (fix): antes se anclaba a `Inventory` en un rango de fechas y salía VACÍO para todas
   * las sucursales — las que realmente monitorean 44 (Hermosillo / Ruta Extendida) casi no crean
   * inventarios, así que nunca había uno en rango. Ahora se listan los activos directamente y sin
   * filtro de fecha: un paquete activo viejo sin su escaneo es justo el más importante de mostrar.
   *
   * POR AHORA (pedido de operación, 2026-10-07): el reporte se acota a paquetes dados de alta en
   * OCTUBRE 2026 (hora local Hermosillo) sin importar lo que mande el front, y SOLO FedEx
   * (el código 44/67 es de FedEx; DHL no aplica). Para quitar el candado, quitar
   * `MISSING_SCAN_REPORT_WINDOW` de `missingScanWhere` (missing-scan-report.ts).
   */
  async getMissingScanReportMulti(subsidiaryIds: string[]) {
    const emptySummary = { paquetes: 0, conCodigoHoy: 0, sinCodigo: 0, nunca: 0 };
    const period = { from: MISSING_SCAN_REPORT_WINDOW.from.toISOString(), to: MISSING_SCAN_REPORT_WINDOW.to.toISOString() };
    const ids = [...new Set((subsidiaryIds || []).filter(Boolean))];
    if (ids.length === 0) return { summary: emptySummary, details: [], period };

    const subs = await this.subsidiaryRepository.find({
      where: { id: In(ids) },
      select: ['id', 'name', 'monitorFedexCode44'],
    });

    // Motor compartido con el welcome dashboard (ver missing-scan-report.ts): el código lo dice
    // FedEx (44 o 67, cualquiera cuenta) y los días se cuentan completos en hora Hermosillo.
    const where = missingScanWhere(ids);
    const [shipments, chargeShipments] = await Promise.all([
      this.shipmentRepository.find({ where, relations: ['statusHistory', 'subsidiary'] }),
      this.chargeShipmentRepository.find({ where, relations: ['statusHistory', 'subsidiary'] }),
    ]);

    const tagged = [
      ...shipments.map((s) => ({ s, isCharge: false })),
      ...chargeShipments.map((s) => ({ s, isCharge: true })),
    ];
    return { ...buildMissingScanReport(tagged, subs), period };
  }

  // ============ MÉTODOS HELPER CORREGIDOS ============

  /**
   * Obtiene el inventario más reciente CON SUS SHIPMENTS
   */
  private async getLatestInventoryWithShipments(subsidiaryId: string): Promise<Inventory | null> {
    return await this.inventoryRepository.findOne({
      where: { subsidiary: { id: subsidiaryId } },
      relations: [
        'shipments',
        'shipments.statusHistory' // Cargar historial de cada shipment
      ],
      select: {
        id: true,
        inventoryDate: true,
        shipments: {
          id: true,
          trackingNumber: true,
          status: true,
          createdAt: true,
          shipmentType: true,
          fedexUniqueId: true,
          statusHistory: {
            id: true,
            exceptionCode: true,
            timestamp: true,
          }
        }
      },
      order: { inventoryDate: 'DESC' },
    });
  }

  /**
   * Procesa los shipments del inventario
   */
  private async processInventoryShipments(inventory: Inventory, scanCode: '44' | '67' = '67'): Promise<{
    shipmentsWithout67: ShipmentWithout67[];
    totalShipments: number;
  }> {
    // Solo FedEx: el 44/67 es de FedEx; DHL nunca se mezcla en estos reportes.
    const fedexShipments = (inventory.shipments || []).filter((s) => String(s.shipmentType || '').toLowerCase() === 'fedex');
    if (fedexShipments.length === 0) {
      return { shipmentsWithout67: [], totalShipments: 0 };
    }

    const shipmentsWithout67: ShipmentWithout67[] = [];
    const totalShipments = fedexShipments.length;

    // Procesar en batches para mejor rendimiento
    const BATCH_SIZE = 100;
    
    for (let i = 0; i < totalShipments; i += BATCH_SIZE) {
      const batch = fedexShipments.slice(i, Math.min(i + BATCH_SIZE, totalShipments));
      
      for (const shipment of batch) {
        try {
          const result = this.processSingleShipment(shipment, scanCode);
          if (result) {
            shipmentsWithout67.push(result);
          }
        } catch (error) {
          // Si falla un shipment, continuar con los demás
          shipmentsWithout67.push({
            trackingNumber: shipment.trackingNumber,
            currentStatus: shipment.status,
            statusHistoryCount: 0,
            exceptionCodes: [],
            firstStatusDate: null,
            lastStatusDate: null,
            daysInSystem: null,
            createdAt: shipment.createdAt ? new Date(shipment.createdAt).toISOString() : null,
            scanCode,
            shipmentType: shipment.shipmentType,
            fedexUniqueId: shipment.fedexUniqueId ?? null,
            comment: `Error: ${error.message}`,
          });
        }
      }
    }

    return { shipmentsWithout67, totalShipments };
  }

  /**
   * Procesa un solo shipment del inventario
   */
  private processSingleShipment(shipment: any, scanCode: '44' | '67' = '67'): ShipmentWithout67 | null {
    const statusHistory = shipment.statusHistory || [];
    const historyCount = statusHistory.length;

    // Verificar si tiene código 67 en su historial
    let hasCode67 = false;
    let firstStatusDate: Date | null = null;
    let lastStatusDate: Date | null = null;
    const exceptionCodes = new Set<string>();

    // Procesar historial en un solo loop
    if (historyCount > 0) {
      let minDate: Date | null = null;
      let maxDate: Date | null = null;
      
      for (const status of statusHistory) {
        // Escaneo local de FedEx: 44 o 67, cualquiera (el código lo dice FedEx, no la config)
        if (isLocalScanCode(status.exceptionCode)) {
          hasCode67 = true;
          break; // Salir temprano si ya tiene el código
        }
        
        // Recoger exception codes únicos (excluyendo null/empty)
        if (status.exceptionCode && status.exceptionCode.trim() !== '') {
          exceptionCodes.add(status.exceptionCode);
        }
        
        // Encontrar fechas mínimas y máximas
        const statusDate = new Date(status.timestamp);
        if (!minDate || statusDate < minDate) {
          minDate = statusDate;
        }
        if (!maxDate || statusDate > maxDate) {
          maxDate = statusDate;
        }
      }
      
      firstStatusDate = minDate;
      lastStatusDate = maxDate;
    }

    // Si tiene código 67, NO incluirlo
    if (hasCode67) {
      return null;
    }

    // Calcular días en sistema
    let daysInSystem: number | null = null;
    if (firstStatusDate) {
      const today = new Date();
      const diffTime = Math.abs(today.getTime() - firstStatusDate.getTime());
      daysInSystem = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    return {
      trackingNumber: shipment.trackingNumber,
      currentStatus: shipment.status,
      statusHistoryCount: historyCount,
      exceptionCodes: Array.from(exceptionCodes),
      firstStatusDate,
      lastStatusDate,
      daysInSystem,
      createdAt: shipment.createdAt ? new Date(shipment.createdAt).toISOString() : null,
      scanCode,
      shipmentType: shipment.shipmentType,
      fedexUniqueId: shipment.fedexUniqueId ?? null,
      comment: historyCount === 0
        ? 'Sin historial de estados'
        : 'Nunca registró 44 ni 67',
    };
  }

  /**
   * Resultado vacío
   */
  private getEmptyResult() {
    return {
      summary: {
        totalShipments: 0,
        withoutCode67: 0,
        withCode67: 0,
        percentageWithout67: 0,
      },
      details: []
    };
  }

  // ============ GENERADOR DE EXCEL ============

  /**
   * Genera el Excel de "Shipments sin código 67" (B5). Unificación: detrás de flag, el backend
   * genera el Excel por el Motor de Plantillas (`inventory_no67_excel`). Si el motor no entrega
   * buffer (o falla), se conserva el armado inline exceljs original
   * (`generateExcelReportLegacy`). Flag OFF => comportamiento actual intacto.
   */
  async generateExcelReport(subsidiaryId: string): Promise<Buffer> {
    if (process.env.DOC_ENGINE_INVENTORY_NO67 === 'true') {
      try {
        const buf = await this.renderInventoryNo67Excel(subsidiaryId);
        if (buf) return buf;
      } catch (e: any) {
        this.logger.warn(`Motor inventory_no67_excel falló; uso armado legacy: ${e?.message}`);
      }
    }
    return this.generateExcelReportLegacy(subsidiaryId);
  }

  /** Consulta los shipments-sin-67 y renderiza vía el Motor. `undefined` si el motor no entrega buffer. */
  async renderInventoryNo67Excel(subsidiaryId: string): Promise<Buffer | undefined> {
    const inventoryData = await this.checkInventory67BySubsidiary(subsidiaryId);
    const data = buildInventoryNo67Data(inventoryData);
    const result = await this.templateService.render('inventory_no67_excel', data);
    return result.buffer;
  }

  /**
   * Genera reporte Excel optimizado (armado inline exceljs, legacy — retrocompat con Flag OFF).
   */
  async generateExcelReportLegacy(subsidiaryId: string): Promise<Buffer> {
    const startTime = Date.now();

    try {
      // 1. Obtener datos
      const inventoryData = await this.checkInventory67BySubsidiary(subsidiaryId);

      // 2. Crear workbook
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Sistema de Inventario';
      workbook.created = new Date();

      // 3. Agregar hojas
      this.addSummarySheet(workbook, inventoryData);
      this.addDetailsSheet(workbook, inventoryData.details);
      this.addStatisticsSheet(workbook, inventoryData);

      // 4. Generar buffer
      this.logger.log(`📊 Excel generado en: ${Date.now() - startTime}ms`);
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(arrayBuffer);

    } catch (error) {
      this.logger.error(`❌ Error generando Excel: ${error.message}`);
      throw error;
    }
  }

  /**
   * Agrega hoja de resumen
   */
  private addSummarySheet(workbook: ExcelJS.Workbook, data: any): void {
    const worksheet = workbook.addWorksheet('Resumen');
    
    // Título
    worksheet.mergeCells('A1:G1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'REPORTE - SHIPMENTS SIN CÓDIGO 67';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '2E75B6' }
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    
    // Información del inventario
    const infoRows = [
      ['Fecha de generación:', new Date()],
      ['Fecha de inventario:', data.summary.inventoryDate || 'N/A'],
      ['ID Inventario:', data.summary.inventoryId || 'N/A'],
      ['Total Shipments:', data.summary.totalShipments],
      ['Sin código 67:', data.summary.withoutCode67],
      ['Con código 67:', data.summary.withCode67],
      ['Porcentaje sin 67:', `${data.summary.percentageWithout67}%`],
    ];
    
    infoRows.forEach(([label, value], index) => {
      const row = 3 + index;
      worksheet.getCell(`A${row}`).value = label;
      worksheet.getCell(`B${row}`).value = value;
      
      if (value instanceof Date) {
        worksheet.getCell(`B${row}`).numFmt = 'dd/mm/yyyy hh:mm';
      }
      
      if (typeof value === 'number' && index >= 3) {
        worksheet.getCell(`B${row}`).font = { bold: true, color: { argb: 'E46C0A' } };
      }
    });
    
    // Formato
    worksheet.columns = [
      { width: 25 },
      { width: 25 },
    ];
    
    // Ajustar alturas
    for (let i = 1; i <= 10; i++) {
      worksheet.getRow(i).height = 25;
    }
  }

  /**
   * Agrega hoja de detalles
   */
  private addDetailsSheet(workbook: ExcelJS.Workbook, details: ShipmentWithout67[]): void {
    const worksheet = workbook.addWorksheet('Detalles');
    
    // Encabezados
    const headers = [
      { header: 'No.', key: 'index', width: 8 },
      { header: 'Tracking Number', key: 'trackingNumber', width: 25 },
      { header: 'Estado', key: 'currentStatus', width: 20 },
      { header: 'Historial', key: 'statusHistoryCount', width: 12 },
      { header: 'Códigos', key: 'exceptionCodes', width: 25 },
      { header: 'Primera Fecha', key: 'firstStatusDate', width: 22 },
      { header: 'Última Fecha', key: 'lastStatusDate', width: 22 },
      { header: 'Días', key: 'daysInSystem', width: 10 },
      { header: 'Días con el paquete', key: 'daysWithPackage', width: 18 },
      { header: 'Comentario', key: 'comment', width: 30 },
    ];
    
    worksheet.columns = headers.map(h => ({
      header: h.header,
      key: h.key,
      width: h.width
    }));
    
    // Estilo encabezados
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '5B9BD5' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 30;
    
    // Agregar datos
    details.forEach((item, index) => {
      const rowNumber = index + 2;
      const row = worksheet.getRow(rowNumber);
      
      // Datos
      row.getCell('index').value = index + 1;
      row.getCell('trackingNumber').value = item.trackingNumber;
      row.getCell('currentStatus').value = item.currentStatus;
      row.getCell('statusHistoryCount').value = item.statusHistoryCount;
      row.getCell('exceptionCodes').value = item.exceptionCodes.join(', ');
      
      // Fechas formateadas
      if (item.firstStatusDate) {
        const date = new Date(item.firstStatusDate);
        row.getCell('firstStatusDate').value = date;
        row.getCell('firstStatusDate').numFmt = 'dd/mm/yyyy hh:mm';
      }
      
      if (item.lastStatusDate) {
        const date = new Date(item.lastStatusDate);
        row.getCell('lastStatusDate').value = date;
        row.getCell('lastStatusDate').numFmt = 'dd/mm/yyyy hh:mm';
      }
      
      // Días
      if (item.daysInSystem !== null) {
        row.getCell('daysInSystem').value = item.daysInSystem;
        row.getCell('daysInSystem').numFmt = '0';
      }

      // Días con el paquete (desde la creación del shipment = createdAt), en días calendario.
      if (item.createdAt) {
        const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const dwp = Math.max(0, Math.round((dayStart(new Date()) - dayStart(new Date(item.createdAt))) / 86_400_000));
        row.getCell('daysWithPackage').value = dwp;
        row.getCell('daysWithPackage').numFmt = '0';
      }

      // Comentario
      row.getCell('comment').value = item.comment;
      
      // Color alternado
      if (rowNumber % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'F2F2F2' }
        };
      }
      
      // Bordes
      headers.forEach((_, colIndex) => {
        row.getCell(colIndex + 1).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });
    
    // Congelar encabezados y auto-filtro
    worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
    worksheet.autoFilter = 'A1:I1';
  }

  /**
   * Agrega hoja de estadísticas
   */
  private addStatisticsSheet(workbook: ExcelJS.Workbook, data: any): void {
    const worksheet = workbook.addWorksheet('Estadísticas');
    
    // Título
    worksheet.mergeCells('A1:C1');
    worksheet.getCell('A1').value = 'ESTADÍSTICAS';
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    
    // Distribución por estado
    const statusStats = this.calculateStatusStats(data.details);
    
    worksheet.getCell('A3').value = 'Distribución por Estado';
    worksheet.getCell('A3').font = { bold: true };
    
    worksheet.getCell('A4').value = 'Estado';
    worksheet.getCell('B4').value = 'Cantidad';
    worksheet.getCell('C4').value = 'Porcentaje';
    
    let row = 5;
    statusStats.forEach(stat => {
      worksheet.getCell(`A${row}`).value = stat.status;
      worksheet.getCell(`B${row}`).value = stat.count;
      worksheet.getCell(`C${row}`).value = `${stat.percentage}%`;
      row++;
    });
    
    // Distribución por días
    const dayStats = this.calculateDayStats(data.details);
    
    worksheet.getCell('A' + (row + 2)).value = 'Distribución por Días en Sistema';
    worksheet.getCell('A' + (row + 2)).font = { bold: true };
    
    worksheet.getCell('A' + (row + 3)).value = 'Rango';
    worksheet.getCell('B' + (row + 3)).value = 'Cantidad';
    
    let dayRow = row + 4;
    dayStats.forEach(stat => {
      worksheet.getCell(`A${dayRow}`).value = stat.range;
      worksheet.getCell(`B${dayRow}`).value = stat.count;
      dayRow++;
    });
    
    // Formato
    worksheet.columns = [
      { width: 25 },
      { width: 15 },
      { width: 15 },
    ];
  }

  /**
   * Calcula estadísticas por estado
   */
  private calculateStatusStats(details: ShipmentWithout67[]): Array<{
    status: string;
    count: number;
    percentage: number;
  }> {
    const statusMap = new Map<string, number>();
    
    details.forEach(item => {
      const count = statusMap.get(item.currentStatus) || 0;
      statusMap.set(item.currentStatus, count + 1);
    });
    
    const total = details.length;
    return Array.from(statusMap.entries())
      .map(([status, count]) => ({
        status,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100 * 10) / 10 : 0
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Calcula estadísticas por días
   */
  private calculateDayStats(details: ShipmentWithout67[]): Array<{
    range: string;
    count: number;
  }> {
    const ranges = [
      { range: '0-7 días', min: 0, max: 7 },
      { range: '8-30 días', min: 8, max: 30 },
      { range: '31-90 días', min: 31, max: 90 },
      { range: '91-180 días', min: 91, max: 180 },
      { range: 'Más de 180 días', min: 181, max: Infinity },
      { range: 'Sin fecha', min: -1, max: -1 },
    ];
    
    const counts = new Array(ranges.length).fill(0);
    
    details.forEach(item => {
      const days = item.daysInSystem;
      
      if (days === null || days === undefined) {
        counts[5]++; // Sin fecha
      } else {
        for (let i = 0; i < ranges.length - 1; i++) {
          if (days >= ranges[i].min && days <= ranges[i].max) {
            counts[i]++;
            break;
          }
        }
      }
    });
    
    return ranges.map((range, index) => ({
      range: range.range,
      count: counts[index]
    }));
  }

  // ============ MÉTODO DE DESCARGA ============

  /**
   * Genera y prepara archivo para descarga
   */
  async downloadExcelReport(
    subsidiaryId: string, 
    subsidiaryName?: string
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    
    const buffer = await this.generateExcelReport(subsidiaryId);
    
    // Generar nombre de archivo
    const timestamp = new Date()
      .toISOString()
      .replace(/[:\-T.]/g, '')
      .slice(0, 14);
    
    const namePart = subsidiaryName 
      ? subsidiaryName.replace(/[^a-z0-9]/gi, '_').slice(0, 30)
      : `sucursal_${subsidiaryId.slice(0, 8)}`;
    
    const fileName = `sin_codigo_67_${namePart}_${timestamp}.xlsx`;
    
    return {
      buffer,
      fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
  }

  /**
   * Reporte "Inventario sin movimiento (Local Delay de bodega)": del ÚLTIMO
   * inventario del rango (default: ayer), qué guías NO se movieron ese día y por
   * eso causan LD (vencen ese día, sin POD ni DEX 03/07/08/17/42 y SIN ningún
   * movimiento FedEx). Devuelve el detalle (con consNumber, tel.) + resumen.
   */
  async getInventoryLDReport(subsidiaryId: string, from?: string, to?: string) {
    const ZONE = 'America/Hermosillo';
    const HER = -7 * 3600 * 1000;
    const herDay = (x: any) => new Date(new Date(x).getTime() + HER).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() + HER - 86400000).toISOString().slice(0, 10);
    const startStr = from || yesterday;
    const endStr = to || from || yesterday;
    const startUtc = fromZonedTime(`${startStr}T00:00:00.000`, ZONE);
    const endUtc = fromZonedTime(`${endStr}T23:59:59.999`, ZONE);
    const rangeDays = new Set<string>();
    { let d = startStr, guard = 0; while (d <= endStr && guard++ < 400) { rangeDays.add(d); d = new Date(new Date(d + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10); } }

    const sub = await this.subsidiaryRepository.findOne({ where: { id: subsidiaryId } });
    const subsidiaryName = sub?.name ?? '';
    const fedexCost = Number(sub?.fedexCostPackage) || 0;
    const dhlCost = Number((sub as any)?.dhlCostPackage) || 0;
    const costOf = (t?: string) => (String(t || '').toLowerCase() === 'dhl' ? dhlCost : fedexCost);

    const emptyMeta = { rangeStart: startStr, rangeEnd: endStr, subsidiaryName, fedexCost, dhlCost, lastInventory: null as any };
    const invs = await this.inventoryRepository.find({
      where: { subsidiary: { id: subsidiaryId }, inventoryDate: Between(startUtc, endUtc) },
      order: { inventoryDate: 'DESC', id: 'DESC' }, take: 1, select: ['id', 'inventoryDate', 'type'],
    });
    const lastInventory = invs[0];
    if (!lastInventory) {
      return { summary: { enBodega: 0, conMovimiento: 0, sinMovimiento: 0, causanLD: 0, montoPerdido: 0 }, details: [], meta: emptyMeta };
    }

    const chunk = <T,>(arr: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
    const PKG_COLS: [string, string][] = [
      ['trackingNumber', 'trackingNumber'], ['status', 'status'],
      ['recipientName', 'recipientName'], ['recipientAddress', 'recipientAddress'],
      ['recipientCity', 'recipientCity'], ['recipientZip', 'recipientZip'], ['recipientPhone', 'recipientPhone'],
      ['shipmentType', 'shipmentType'], ['commitDateTime', 'commitDateTime'],
      ['fedexUniqueId', 'fedexUniqueId'], ['createdAt', 'createdAt'], ['consNumber', 'consNumber'],
    ];
    const buildPkgQuery = (repo: Repository<any>, alias: string, pivot: string, fk: string) => {
      const qb = repo.createQueryBuilder(alias)
        .innerJoin(pivot, 'j', `j.${fk} = ${alias}.id`)
        .where('j.inventoryId = :invId', { invId: lastInventory.id })
        .select(`${alias}.id`, 'id');
      for (const [col, as] of PKG_COLS) qb.addSelect(`${alias}.${col}`, as);
      return qb.getRawMany();
    };
    const [shipRows, chargeRows] = await Promise.all([
      buildPkgQuery(this.shipmentRepository, 's', 'inventory_shipment', 'shipmentId'),
      buildPkgQuery(this.chargeShipmentRepository, 'cs', 'inventory_charge_shipments', 'chargeShipmentId'),
    ]);

    // Movimiento en el rango (cualquier scan) + días con DEX 03/07/08/17/42.
    const aggBy = async (ids: string[], fkCol: string) => {
      const moved = new Map<string, number>();
      const dexDays = new Map<string, Set<string>>();
      for (const part of chunk([...new Set(ids)], 800)) {
        if (part.length === 0) continue;
        const ph = part.map(() => '?').join(',');
        const mv: any[] = await this.dataSource.query(
          `SELECT ${fkCol} AS id, SUM(timestamp BETWEEN ? AND ? AND ${realMovementSql()}) AS n FROM shipment_status WHERE ${fkCol} IN (${ph}) GROUP BY ${fkCol}`,
          [startUtc, endUtc, ...part],
        );
        for (const r of mv) if (r.id) moved.set(String(r.id), Number(r.n) || 0);
        const dx: any[] = await this.dataSource.query(
          `SELECT ${fkCol} AS id, timestamp AS ts FROM shipment_status WHERE ${fkCol} IN (${ph}) AND exceptionCode IN (${LD_QUALIFYING_SQL_IN})`,
          part,
        );
        for (const r of dx) {
          if (!r.id) continue;
          const k = herDay(r.ts);
          if (!dexDays.has(String(r.id))) dexDays.set(String(r.id), new Set());
          dexDays.get(String(r.id))!.add(k);
        }
      }
      return { moved, dexDays };
    };
    const [shipAgg, chargeAgg] = await Promise.all([
      aggBy(shipRows.map((r) => r.id), 'shipmentId'),
      aggBy(chargeRows.map((r) => r.id), 'chargeShipmentId'),
    ]);

    const DELIVERED = new Set<string>([
      ShipmentStatusType.ENTREGADO, ShipmentStatusType.ENTREGADO_POR_FEDEX, ShipmentStatusType.ENTREGADO_EN_BODEGA,
    ]);
    const build = (row: any, isCharge: boolean, agg: { moved: Map<string, number>; dexDays: Map<string, Set<string>> }) => {
      const id = String(row.id);
      const statusLower = String(row.status ?? '').toLowerCase();
      const commitDay = row.commitDateTime ? herDay(row.commitDateTime) : null;
      const dueOnFilterDate = !!commitDay && rangeDays.has(commitDay);
      const movedThatDay = (agg.moved.get(id) || 0) > 0;
      const dexOnCommitDay = !!(commitDay && agg.dexDays.get(id)?.has(commitDay));
      const isDelivered = DELIVERED.has(statusLower);
      const ld = classifyLd({ status: statusLower, due: dueOnFilterDate ? 'today' : null, dexOnCommitDay, movedOnCommitDay: movedThatDay, requireNoMovement: true, excludeClosed: false });
      const isLD = ld === 'possible_ld' || ld === 'ld';
      return {
        trackingNumber: row.trackingNumber, status: row.status, isCharge,
        consNumber: row.consNumber || '',
        recipientName: row.recipientName, recipientAddress: row.recipientAddress,
        recipientCity: row.recipientCity, recipientZip: row.recipientZip, recipientPhone: row.recipientPhone,
        shipmentType: row.shipmentType, fedexUniqueId: row.fedexUniqueId,
        commitDateTime: row.commitDateTime ? new Date(row.commitDateTime).toISOString() : null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
        dueOnFilterDate, movedThatDay, dexOnCommitDay, isLD,
        costPackage: costOf(row.shipmentType), ldSource: 'local',
      };
    };
    const details = [
      ...shipRows.map((r) => build(r, false, shipAgg)),
      ...chargeRows.map((r) => build(r, true, chargeAgg)),
    ];
    details.sort((a, b) => (a.isLD !== b.isLD ? (a.isLD ? -1 : 1) : 0));

    const ldRows = details.filter((d) => d.isLD);
    return {
      summary: {
        enBodega: details.length,
        conMovimiento: details.filter((d) => d.movedThatDay).length,
        sinMovimiento: details.filter((d) => !d.movedThatDay).length,
        causanLD: ldRows.length,
        montoPerdido: ldRows.reduce((s, d) => s + d.costPackage, 0),
      },
      details,
      meta: {
        rangeStart: startStr, rangeEnd: endStr, subsidiaryName, fedexCost, dhlCost,
        lastInventory: { id: String(lastInventory.id), inventoryDate: new Date(lastInventory.inventoryDate).toISOString(), type: String(lastInventory.type ?? '') },
      },
    };
  }

}
