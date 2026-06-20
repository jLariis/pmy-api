import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import { Between, DataSource, In, Not, Repository } from 'typeorm';
import { PaginatedResult, parsePagination, resolveDateRange } from 'src/common/pagination.util';
import { ChargeShipment, Consolidated, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { ValidationPayloadDto } from 'src/unloading/dto/validate-payload.dto';
import { MailService } from 'src/mail/mail.service';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import * as ExcelJS from 'exceljs';
import { fromZonedTime } from 'date-fns-tz';

export interface ShipmentWithout67 {
  trackingNumber: string;
  currentStatus: string;
  statusHistoryCount: number;
  exceptionCodes: string[];
  firstStatusDate: Date | null;
  lastStatusDate: Date | null;
  daysInSystem: number | null;
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
    @InjectRepository(Consolidated)
    private readonly consolidatedRepository: Repository<Consolidated>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
    private readonly mailService: MailService,
    private readonly dataSource: DataSource
  ){}


  async create(createInventoryDto: CreateInventoryDto, userId?: string) {
    const { inventoryDate, shipments, chargeShipments, subsidiary } = createInventoryDto;
    
    console.log("🚀 ~ InventoriesService ~ create ~ subsidiary:", subsidiary)
    
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Cargar las entidades necesarias dentro de la transacción
      const shipmentsToSave = await queryRunner.manager.findBy(Shipment, {
        id: In(shipments)
      });
      const chargeShipmentsToSave = await queryRunner.manager.findBy(ChargeShipment, {
        id: In(chargeShipments)
      });
      const subsidiaryObj = await queryRunner.manager.findOneBy(Subsidiary, { 
        id: subsidiary.id 
      });
      
      console.log("🚀 ~ InventoriesService ~ create ~ subsidiaryObj:", subsidiaryObj)

      if (!subsidiaryObj) {
        throw new Error(`La sucursal con ID ${subsidiary.id} no existe.`);
      }

      // 2. Crear y Guardar el Inventario
      // Esto guardará automáticamente las relaciones en las tablas pivote
      const newInventory = queryRunner.manager.create(Inventory, {
        inventoryDate: inventoryDate || new Date(),
        shipments: shipmentsToSave,
        chargeShipments: chargeShipmentsToSave,
        subsidiary: subsidiaryObj,
        createdById: userId ?? null,
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
          shipment: s
        }));
      });

      // Historial para ChargeShipments (F2)
      chargeShipmentsToSave.forEach(cs => {
        historyRecords.push(queryRunner.manager.create(ShipmentStatus, {
          status: cs.status,
          notes: `Paquete F2 confirmado en inventario físico (Folio Inv: ${savedInventory.id}) en ${subsidiaryObj.name}`,
          timestamp: now,
          chargeShipment: cs
        }));
      });

      // Guardado masivo de historiales
      if (historyRecords.length > 0) {
        await queryRunner.manager.save(ShipmentStatus, historyRecords);
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

  async validateTrackingNumber(
    trackingNumber: string,
    subsidiaryId?: string
  ): Promise<ValidatedPackageDispatchDto & { isCharge?: boolean; consolidated?: Consolidated }> {
    const shipment = await this.shipmentRepository.findOne({
      where: { 
        trackingNumber,
        status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) 
      },
      relations: ['subsidiary', 'statusHistory', 'payment'],
      order: { createdAt: 'DESC' }
    });


    if (!shipment) {
      const chargeShipment = await this.chargeShipmentRepository.findOne({
        where: { 
          trackingNumber,
          status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) 
        },
        relations: ['subsidiary', 'charge', 'payment'],
        order: { createdAt: 'DESC' }
      });

      if (!chargeShipment) {
      // Retornar DTO mínimo con un mensaje indicando el motivo
      return {
        trackingNumber,
        isValid: false,
        reason: 'No se encontraron datos para el tracking number en la base de datos',
        subsidiary: null,
        status: null,
      };
    }

      const validatedCharge = await this.validatePackage(
        {
          ...chargeShipment,
          isValid: false,
        },
        subsidiaryId
      );

      return {
        ...validatedCharge,
        isCharge: true,
      };
    }

    const consolidated = await this.consolidatedRepository.findOne({
      where: { id: shipment.consolidatedId },
    });

    const validatedShipment = await this.validatePackage(
      {
        ...shipment,
        isValid: false,
        isCharge: false,
      },
      subsidiaryId
    );

    return {
      ...validatedShipment,
      consolidated,
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

    return { validatedShipments };
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
    } = {},
  ): Promise<PaginatedResult<any>> {
    const { start, end } = resolveDateRange(opts.from, opts.to);
    const { page, limit, skip } = parsePagination(opts.page, opts.limit);
    const search = (opts.search || '').trim();
    const type = opts.type && opts.type !== 'all' ? opts.type : undefined;

    // Filtros comunes (semana + búsqueda + tipo). NO carga relaciones pesadas:
    // los paquetes se devuelven como conteo y el detalle se pide aparte por id.
    const applyFilters = <T extends import('typeorm').SelectQueryBuilder<Inventory>>(qb: T): T => {
      qb.where('subsidiary.id = :subsidiaryId', { subsidiaryId })
        .andWhere('inventory.inventoryDate BETWEEN :start AND :end', { start, end });
      if (search) qb.andWhere('inventory.trackingNumber LIKE :search', { search: `%${search}%` });
      if (type) qb.andWhere('inventory.type = :type', { type });
      return qb;
    };

    const total = await applyFilters(
      this.inventoryRepository.createQueryBuilder('inventory').leftJoin('inventory.subsidiary', 'subsidiary'),
    ).getCount();

    const { entities, raw } = await applyFilters(
      this.inventoryRepository
        .createQueryBuilder('inventory')
        .leftJoin('inventory.subsidiary', 'subsidiary')
        .leftJoin('inventory.shipments', 'shipments')
        .leftJoin('inventory.chargeShipments', 'chargeShipments'),
    )
      .select([
        'inventory.id',
        'inventory.trackingNumber',
        'inventory.inventoryDate',
        'inventory.createdAt',
        'inventory.type',
        'subsidiary.id',
        'subsidiary.name',
      ])
      .addSelect('COUNT(DISTINCT shipments.id)', 'shipmentsCount')
      .addSelect('COUNT(DISTINCT chargeShipments.id)', 'chargeShipmentsCount')
      .groupBy('inventory.id')
      .addGroupBy('subsidiary.id')
      .orderBy('inventory.inventoryDate', 'DESC')
      .offset(skip)
      .limit(limit)
      .getRawAndEntities();

    const data = entities.map((inv) => {
      const r = raw.find((x) => x.inventory_id === inv.id);
      const sc = Number(r?.shipmentsCount || 0);
      const cc = Number(r?.chargeShipmentsCount || 0);
      return { ...inv, shipmentsCount: sc, chargeShipmentsCount: cc, totalPackages: sc + cc };
    });

    return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  async findOne(id: string) {
    return await this.inventoryRepository.findOneBy({ id });
  }

  /** Inventario completo (con paquetes) para el detalle / exportación. */
  async findOneFull(id: string) {
    return await this.inventoryRepository.findOne({
      where: { id },
      relations: [
        'subsidiary',
        'shipments',
        'shipments.payment',
        'chargeShipments',
        'chargeShipments.payment',
      ],
    });
  }

  async getPriorityPackages(inventory: Inventory) {
      const timeZone = "America/Hermosillo";

      const todayUTC = new Date();
      todayUTC.setUTCHours(0, 0, 0, 0);
  
      const tomorrowUTC = new Date(todayUTC);
      tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);
  
      if (!inventory) return null;
  
      const shipments = (inventory.shipments || []).filter(
        s => 
          s.commitDateTime >= todayUTC && 
          s.commitDateTime < tomorrowUTC &&
          s.status === ShipmentStatusType.EN_RUTA
      );
  
      const chargeShipments = (inventory.chargeShipments || []).filter(
        cs => 
          cs.commitDateTime >= todayUTC && 
          cs.commitDateTime < tomorrowUTC &&
          cs.status === ShipmentStatusType.EN_RUTA
      );
  
      const htmlRows = [...shipments, ...chargeShipments]
        .map(
          (s) => `
            <tr style="border-bottom: 1px solid #ddd;">
              <td style="padding: 8px; text-align: center;">${s.trackingNumber ?? "N/A"}</td>
              <td style="padding: 8px;">${s.subsidiary?.name ?? "N/A"}</td>
              <td style="padding: 8px; text-align: center;">
                ${
                  s.commitDateTime
                    ? new Date(s.commitDateTime).toLocaleDateString("es-MX", {
                        timeZone: "America/Hermosillo",
                      })
                    : "Sin fecha"
                }
              </td>
              <td style="padding: 8px; text-align: center;">
                ${s.payment ? `${s.payment.type} $ ${s.payment.amount}` : ""}
              </td>
              <td style="padding: 8px; text-align: center;">${s.status ?? "N/A"}</td>
            </tr>
          `
        )
        .join("");
  
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
          <h2 style="border-bottom: 3px solid #e74c3c; padding-bottom: 8px;">
            Reporte de Inventario con Paquetes Críticos
          </h2>
  
          <p>
            Dentro del Inventario <strong>${inventory.trackingNumber ?? "N/A"}</strong>
            se han detectado paquetes con fecha de vencimiento el día de hoy 
            (<strong>${new Date(inventory.inventoryDate).toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo' })}</strong>).
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
                <th style="padding: 10px;">Cobro</th>
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
  
      const result = await this.mailService.sendHighPriorityPackagesOnInvetory({
        to: inventory.subsidiary.officeEmail,
        cc: `${inventory.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`,
        //cc: 'javier.rappaz@gmail.com'
        htmlContent
      });
  
      this.logger.debug('Correo enviado correctamente:', result);
  
      return { ...inventory, shipments, chargeShipments };
  }

  async sendByEmail(file: Express.Multer.File, excelFile: Express.Multer.File, subsidiaryName: string, inventoryId: string) {
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

    this.logger.debug(`Inventario encontrado: ${inventory.id}`);

    try {
      await this.getPriorityPackages(inventory);
    } catch (err) {
      this.logger.error(`Error al enviar correo de prioridades para inventario: ${inventory.id}`, err);
      throw err;
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

      // 2️⃣ PROCESAR SHIPMENTS DEL INVENTARIO
      const { shipmentsWithout67, totalShipments } = 
        await this.processInventoryShipments(latestInventory);
      
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
        },
        details: shipmentsWithout67
      };

    } catch (error) {
      this.logger.error(`❌ Error: ${error.message}`, error.stack);
      throw error;
    }
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
  private async processInventoryShipments(inventory: Inventory): Promise<{
    shipmentsWithout67: ShipmentWithout67[];
    totalShipments: number;
  }> {
    if (!inventory.shipments || inventory.shipments.length === 0) {
      return { shipmentsWithout67: [], totalShipments: 0 };
    }

    const shipmentsWithout67: ShipmentWithout67[] = [];
    const totalShipments = inventory.shipments.length;

    // Procesar en batches para mejor rendimiento
    const BATCH_SIZE = 100;
    
    for (let i = 0; i < totalShipments; i += BATCH_SIZE) {
      const batch = inventory.shipments.slice(i, Math.min(i + BATCH_SIZE, totalShipments));
      
      for (const shipment of batch) {
        try {
          const result = this.processSingleShipment(shipment);
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
  private processSingleShipment(shipment: any): ShipmentWithout67 | null {
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
        // Verificar código 67
        if (status.exceptionCode === '67') {
          hasCode67 = true;
          break; // Salir temprano si encontramos código 67
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
      comment: historyCount === 0 
        ? 'Sin historial de estados' 
        : 'No tiene exceptionCode 67',
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

  // ============ GENERADOR DE EXCEL CORREGIDO ============

  /**
   * Genera reporte Excel optimizado
   */
  async generateExcelReport(subsidiaryId: string): Promise<Buffer> {
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

}
