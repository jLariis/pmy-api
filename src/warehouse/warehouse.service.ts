import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import {
  ChargeShipment,
  PackageDispatch,
  PackageDispatchHistory,
  Shipment,
  ShipmentRemittance,
  ShipmentStatus,
  Subsidiary,
  WarehouseOutbound,
  WarehouseReceiving,
} from 'src/entities';
import { Between, DataSource, In, QueryRunner, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ScannedShipment } from './dto/scanned-shipment.dto';
import { PaymentTypeEnum } from 'src/common/enums/payment-type.enum';
import { ShipmentStatusType } from 'src/common/enums';
import { PaginatedResult, parsePagination, resolveDateRange } from 'src/common/pagination.util';
import { CreateOutboundDto } from './dto/create-outbound.dto';
import { assertOutboundConsistency } from './warehouse.validation';
import { splitShipmentIds } from './warehouse.helpers';
import { MailService } from 'src/mail/mail.service';
import { format, toZonedTime } from 'date-fns-tz';
import axios from 'axios';
import { PostalCodeResponse } from './dto/postal-code-response';

import * as ExcelJS from 'exceljs';
const pdfMake = require('pdfmake');
import { TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';

@Injectable()
export class WarehouseService {
  private readonly logger = new Logger(WarehouseService.name);
  private readonly timeZone = 'America/Hermosillo';

   private static readonly STANDARD_FONTS = new Set<string>([
    'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
    'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
    'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
    'Symbol', 'ZapfDingbats',
  ]);

  private fonts = {
    Helvetica: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique',
    },
  };

  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(WarehouseReceiving)
    private readonly warehouseReceivingRepository: Repository<WarehouseReceiving>,
    @InjectRepository(ShipmentRemittance)
    private readonly shipmentRemittanceRepository: Repository<ShipmentRemittance>,
    @InjectRepository(WarehouseOutbound)
    private readonly warehouseOutboundRepository: Repository<WarehouseOutbound>,
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
  ) {
     // Configuración de pdfmake 0.3.x (API unificada por instancia)
    pdfMake.addFonts(this.fonts);
    // No usamos recursos remotos: denegamos descargas externas (y evita el warning).
    pdfMake.setUrlAccessPolicy(() => false);
    // Permite SOLO los nombres de fuentes estándar; deniega cualquier otra lectura local.
    pdfMake.setLocalAccessPolicy((p: string) =>
      WarehouseService.STANDARD_FONTS.has(p),
    );
  }

  async create(createWarehouseDto: CreateWarehouseDto, userId?: string) {
    this.logger.log(
      `Creando entrada a bodega. Warehouse: ${createWarehouseDto.warehouse}, ` +
        `paquetes: ${createWarehouseDto.shipments?.length ?? 0}`,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Guardar la información de la entrada a bodega en bd
      const newReceiving = queryRunner.manager.create(WarehouseReceiving, {
        warehouseId: createWarehouseDto.warehouse,
        shipments: createWarehouseDto.shipments,
        vehicle: createWarehouseDto.vehicle
          ? ({ id: createWarehouseDto.vehicle } as any)
          : null,
        drivers:
          createWarehouseDto.drivers && createWarehouseDto.drivers.length > 0
            ? createWarehouseDto.drivers.map((driverId) => ({ id: driverId } as any))
            : [],
        createdBy: userId ? ({ id: userId } as any) : null,
      });

      const savedReceiving = await queryRunner.manager.save(WarehouseReceiving, newReceiving);

      // 2. (IDs extraídos vía splitShipmentIds más abajo, por tabla)

      // 3. Separar normales vs carga y ponerlos EN_BODEGA en su tabla correspondiente,
      //    creando historial de estado para trazabilidad.
      const { normalIds, chargeIds } = splitShipmentIds(createWarehouseDto.shipments);
      const now = new Date();

      const setInWarehouse = async (
        ids: string[],
        entity: any,
        relationKey: 'shipment' | 'chargeShipment',
      ) => {
        if (ids.length === 0) return;
        await queryRunner.manager.update(entity, { id: In(ids) }, {
          status: ShipmentStatusType.EN_BODEGA,
        });
        const history = ids.map((id) =>
          queryRunner.manager.create(ShipmentStatus, {
            status: ShipmentStatusType.EN_BODEGA,
            notes: `Entrada a bodega (Recepción: ${savedReceiving.id})`,
            timestamp: now,
            [relationKey]: { id },
          }),
        );
        await queryRunner.manager.save(ShipmentStatus, history);
      };

      await setInWarehouse(normalIds, Shipment, 'shipment');
      await setInWarehouse(chargeIds, ChargeShipment, 'chargeShipment');

      // 4. Extraer y guardar las remesas (piezas de DHL u otros)
      const remittancesData = createWarehouseDto.shipments.flatMap((shipment) =>
        (shipment.remittances || []).map((remittance) => ({
          pieceTrackingNumber: remittance.pieceTrackingNumber,
          shipmentId: remittance.shipmentId,
          status: ShipmentStatusType.EN_BODEGA,
          warehouseReceivingId: savedReceiving.id,
        })),
      );

      if (remittancesData.length > 0) {
        const newRemittances = queryRunner.manager.create(ShipmentRemittance, remittancesData);
        await queryRunner.manager.save(ShipmentRemittance, newRemittances);
      }

      await queryRunner.commitTransaction();
      return savedReceiving;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Error al procesar la entrada a bodega: ${error?.message}`,
        error?.stack,
      );
      throw new InternalServerErrorException(
        'No se pudo procesar la entrada a bodega, verifique los datos.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  async validateTrackingNumberResp1306(
    trackingNumber: string, // Recibe el código escaneado (Tracking o UniqueID)
    subsidiaryId?: string,
  ): Promise<
    ScannedShipment | { isValid: false; trackingNumber: string; reason: string }
  > {
    // 1. Buscamos en ambas tablas simultáneamente e incluimos la relación 'payment'
    const [shipment, chargeShipment] = await Promise.all([
      this.shipmentRepository.findOne({
        where: [
          { trackingNumber: trackingNumber },
          { dhlUniqueId: trackingNumber },
        ],
        select: {
          id: true,
          trackingNumber: true,
          shipmentType: true,
          recipientName: true,
          recipientAddress: true,
          recipientZip: true,
          recipientPhone: true,
          commitDateTime: true,
          isHighValue: true,
          priority: true,
          status: true,
          dhlUniqueId: true,
          subsidiary: { id: true, name: true },
          payment: { id: true, amount: true, type: true },
        },
        relations: ['subsidiary', 'payment'],
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
          recipientPhone: true,
          commitDateTime: true,
          isHighValue: true,
          priority: true,
          status: true,
          subsidiary: { id: true, name: true },
          payment: { id: true, amount: true, type: true },
        },
        relations: ['subsidiary', 'payment'],
      }),
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
     */
    // if (foundPackage.recipientZip) {
    //   const city = await this.getCityFromZipCode(foundPackage.recipientZip);
    // }

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
      recipientPhone: (foundPackage as any).recipientPhone,
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

  async validateTrackingNumber(
    trackingNumber: string, // Recibe el código escaneado (Tracking o UniqueID)
    subsidiaryId?: string,
    context?: 'inbound' | 'outbound',
  ): Promise<
    ScannedShipment | { isValid: false; trackingNumber: string; reason: string }
  > {

    // Generar tracking alternativo para casos borde de DHL (JJD vs JD)
    let alternateTrackingNumber: string | undefined;
    if (trackingNumber.startsWith('JJD')) {
      alternateTrackingNumber = trackingNumber.substring(1); // Se convierte en "JD..."
    } else if (trackingNumber.startsWith('JD')) {
      alternateTrackingNumber = 'J' + trackingNumber; // Se convierte en "JJD..."
    }

    // Construir dinámicamente las condiciones de búsqueda (OR)
    const shipmentWhereConditions: any[] = [
      { trackingNumber: trackingNumber },
      { dhlUniqueId: trackingNumber },
    ];

    const chargeWhereConditions: any[] = [
      { trackingNumber: trackingNumber }
    ];

    // Si existe una variante, la agregamos a las condiciones de búsqueda
    if (alternateTrackingNumber) {
      shipmentWhereConditions.push({ trackingNumber: alternateTrackingNumber });
      shipmentWhereConditions.push({ dhlUniqueId: alternateTrackingNumber });
      chargeWhereConditions.push({ trackingNumber: alternateTrackingNumber });
    }

    // 1. Buscamos en ambas tablas simultáneamente e incluimos la relación 'payment'
    const [shipment, chargeShipment] = await Promise.all([
      this.shipmentRepository.findOne({
        where: shipmentWhereConditions,
        select: {
          id: true,
          trackingNumber: true,
          shipmentType: true,
          recipientName: true,
          recipientAddress: true,
          recipientZip: true,
          recipientPhone: true,
          commitDateTime: true,
          isHighValue: true,
          priority: true,
          status: true,
          dhlUniqueId: true,
          subsidiary: { id: true, name: true },
          payment: { id: true, amount: true, type: true },
        },
        relations: ['subsidiary', 'payment'],
        // Con guías duplicadas, SIEMPRE el más reciente.
        order: { createdAt: 'DESC' },
      }),

      this.chargeShipmentRepository.findOne({
        where: chargeWhereConditions,
        select: {
          id: true,
          trackingNumber: true,
          shipmentType: true,
          recipientName: true,
          recipientAddress: true,
          recipientZip: true,
          recipientPhone: true,
          commitDateTime: true,
          isHighValue: true,
          priority: true,
          status: true,
          subsidiary: { id: true, name: true },
          payment: { id: true, amount: true, type: true },
        },
        relations: ['subsidiary', 'payment'],
        order: { createdAt: 'DESC' },
      }),
    ]);

    const foundPackage = shipment || chargeShipment;

    // 2. Si no existe en la base de datos (ni el original ni la variante), retornamos error
    if (!foundPackage) {
      return {
        trackingNumber,
        isValid: false,
        reason: 'El paquete no existe en el sistema local',
      };
    }

    /** Para cuando tengamos ya todo guardado en Bodega Obregon, los paquetes se puedan separar
     * por ciudad usando el código postal.
     */
    // if (foundPackage.recipientZip) {
    //   const city = await this.getCityFromZipCode(foundPackage.recipientZip);
    // }

    // 3. Evaluamos las reglas de negocio
    const isCharge = !!chargeShipment;
    const hasPayment = !!foundPackage.payment;

    // Asignamos valores por defecto seguros en caso de que no haya pago
    const paymentAmount = foundPackage.payment?.amount || 0;
    const paymentType = foundPackage.payment?.type as PaymentTypeEnum;

    // Piezas (remesas) ya registradas para esta guía maestra.
    const remittances = await this.shipmentRemittanceRepository.find({
      where: { shipmentId: foundPackage.id },
      select: { pieceTrackingNumber: true },
    });
    const existingPieces = remittances
      .map((r) => r.pieceTrackingNumber)
      .filter(Boolean);

    // Aviso (no bloqueante) si el estado no es apropiado para la operación.
    const statusWarning = this.getStatusWarning(String(foundPackage.status), context);

    // 4. Retorno del objeto asegurando los tipos
    // NOTA: Devolvemos foundPackage.trackingNumber para que el frontend
    // reciba exactamente el código con el que se guardó en BD.
    return {
      id: foundPackage.id,
      trackingNumber: foundPackage.trackingNumber,
      shipmentType: foundPackage.shipmentType,
      recipientName: foundPackage.recipientName,
      recipientAddress: foundPackage.recipientAddress,
      recipientZip: foundPackage.recipientZip,
      recipientPhone: (foundPackage as any).recipientPhone,
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
      existingPieces,
      statusWarning,
    };
  }

  /**
   * Devuelve un aviso si el estado del paquete no es el esperado para la
   * operación. No bloquea: el operador decide. (entrada: no debería venir ya
   * en ruta/entregado; salida: debería estar en bodega.)
   */
  private getStatusWarning(status: string, context?: 'inbound' | 'outbound'): string | undefined {
    if (!context) return undefined;
    const s = (status || '').toLowerCase();

    const goneStatuses = [
      ShipmentStatusType.EN_RUTA,
      ShipmentStatusType.ENTREGADO,
      ShipmentStatusType.ENTREGADO_EN_BODEGA,
      ShipmentStatusType.EN_TRANSITO,
    ].map((x) => String(x));

    if (context === 'inbound' && goneStatuses.includes(s)) {
      return `El paquete ya tiene estado "${status}" (no debería re-ingresar a bodega).`;
    }

    if (context === 'outbound') {
      const inWarehouse = [
        ShipmentStatusType.EN_BODEGA,
        ShipmentStatusType.RECIBIDO_EN_BODEGA,
        ShipmentStatusType.PENDIENTE,
        ShipmentStatusType.ES_OCURRE,
      ].map((x) => String(x));
      if (!inWarehouse.includes(s)) {
        return `El paquete no está en bodega (estado actual: "${status}").`;
      }
    }

    return undefined;
  }

  /** Historial paginado de ENTRADAS a bodega (filtro por semana). */
  async findInboundBySubsidiary(
    warehouseId: string,
    opts: { page?: string | number; limit?: string | number; from?: string; to?: string } = {},
  ): Promise<PaginatedResult<any>> {
    const { start, end } = resolveDateRange(opts.from, opts.to);
    const { page, limit, skip } = parsePagination(opts.page, opts.limit);

    const [rows, total] = await this.warehouseReceivingRepository.findAndCount({
      where: { warehouseId, createdAt: Between(start, end) },
      relations: ['warehouse', 'vehicle', 'drivers'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    const data = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      warehouseName: r.warehouse?.name ?? null,
      vehicleName: r.vehicle?.name ?? null,
      driverNames: (r.drivers || []).map((d) => d.name).join(', '),
      totalPackages: (r.shipments || []).length,
      totalPieces: (r.shipments || []).reduce((acc, s) => acc + 1 + (s.remittances?.length || 0), 0),
      shipments: r.shipments,
    }));

    return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** Historial paginado de SALIDAS de bodega (filtro por semana). */
  async findOutboundBySubsidiary(
    warehouseId: string,
    opts: { page?: string | number; limit?: string | number; from?: string; to?: string } = {},
  ): Promise<PaginatedResult<any>> {
    const { start, end } = resolveDateRange(opts.from, opts.to);
    const { page, limit, skip } = parsePagination(opts.page, opts.limit);

    const [rows, total] = await this.warehouseOutboundRepository.findAndCount({
      where: { warehouseId, createdAt: Between(start, end) },
      relations: ['warehouse', 'vehicle', 'drivers', 'routes'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    // Resolver nombres de sucursal destino (traspasos) en lote.
    const destinationIds = Array.from(new Set(rows.map((r) => r.destinationId).filter(Boolean)));
    const destMap = new Map<string, string>();
    if (destinationIds.length > 0) {
      const dests = await this.dataSource.getRepository(Subsidiary).find({
        where: { id: In(destinationIds) },
        select: { id: true, name: true },
      });
      dests.forEach((d) => destMap.set(d.id, d.name));
    }

    const data = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      type: r.type,
      warehouseName: r.warehouse?.name ?? null,
      destinationId: r.destinationId ?? null,
      destinationName: r.destinationId ? destMap.get(r.destinationId) ?? null : null,
      vehicleName: r.vehicle?.name ?? null,
      driverNames: (r.drivers || []).map((d) => d.name).join(', '),
      routeNames: (r.routes || []).map((rt) => rt.name).join(', '),
      kms: r.kms ?? null,
      totalPackages: (r.shipments || []).length,
      totalPieces: (r.shipments || []).reduce((acc, s) => acc + 1 + (s.remittances?.length || 0), 0),
      shipments: r.shipments,
    }));

    return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  async outbound(dto: CreateOutboundDto, userId?: string) {
    this.logger.log(`Iniciando outbound tipo: ${dto.type}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let savedOutboundId: string;
    let dispatchResult: PackageDispatch;

    try {
      assertOutboundConsistency(dto);

      // 1. Guardar el registro general
      const newOutbound = queryRunner.manager.create(WarehouseOutbound, {
        warehouseId: dto.warehouse,
        type: dto.type,
        shipments: dto.shipments,
        destinationId: dto.destinationId,
        kms: dto.kms,
        vehicle: dto.vehicle ? ({ id: dto.vehicle } as any) : null,
        drivers:
          dto.drivers && dto.drivers.length > 0
            ? dto.drivers.map((driverId: string) => ({ id: driverId } as any))
            : [],
        createdBy: userId ? ({ id: userId } as any) : null,
      });

      const savedOutbound = await queryRunner.manager.save(
        WarehouseOutbound,
        newOutbound,
      );
      savedOutboundId = savedOutbound.id;

      // 2. Ejecutar lógica según tipo
      if (dto.type === 'dispatch') {
        dispatchResult = await this.createDispatch(dto, queryRunner, userId);
      } else if (dto.type === 'transfer') {
        await this.createTransfer(dto, queryRunner);
      } else {
        throw new BadRequestException(
          `Tipo de salida '${dto.type}' no soportado.`,
        );
      }

      // 3. Procesar remesas
      await this.processRemittances(dto.shipments, queryRunner);

      // 4. Commit
      await queryRunner.commitTransaction();

      // --- NOTIFICACIÓN DESPUÉS DEL COMMIT (fire-and-forget) ---
      // Si el PDF/email falla NO debe afectar la transacción ya confirmada.
      if (dto.type === 'dispatch' && dispatchResult) {
        this.generateAndSendNotification(
          dispatchResult,
          dto.shipments,
          savedOutboundId,
        ).catch((err) =>
          this.logger.error(
            `Error en flujo asíncrono de notificación: ${err?.message}`,
            err?.stack,
          ),
        );
      }

      return {
        message: `Salida tipo ${dto.type} procesada exitosamente.`,
        outboundId: savedOutboundId,
        data: dispatchResult,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error en outbound: ${error?.message}`, error?.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Método auxiliar para separar la lógica de generación de archivos y envío.
   */
  private async generateAndSendNotification(
    dispatch: PackageDispatch,
    shipments: any[],
    outboundId: string,
  ) {
    const currentDate = new Date().toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    try {
      const fullDispatch = await this.dataSource
        .getRepository(PackageDispatch)
        .findOne({
          where: { id: dispatch.id },
          relations: ['routes', 'drivers', 'vehicle', 'subsidiary'],
        });

      if (!fullDispatch) {
        this.logger.warn(
          `No se encontró el despacho ${dispatch.id} para generar la notificación.`,
        );
        return;
      }

      this.logger.log('Iniciando generación de archivos...');

      console.log("🚀 ~ WarehouseService ~ generateAndSendNotification ~ shipments:", shipments)
      
      const excelBuf = await this.generateExcelBuffer(
        fullDispatch,
        shipments,
      ).catch((e) => {
        this.logger.error(`Error en ExcelJS: ${e?.message}`, e?.stack);
        throw e;
      });

      const pdfBuf = await this.generatePdfBuffer(
        fullDispatch,
        shipments,
      ).catch((e) => {
        this.logger.error(`Error en PDFMake: ${e?.message}`, e?.stack);
        throw e;
      });

      // Nombre seguro: usamos fullDispatch (con relaciones) y fallbacks.
      const driverName =
        fullDispatch.drivers?.[0]?.name?.toUpperCase() ?? 'SIN-CHOFER';
      const subsidiaryName = fullDispatch.subsidiary?.name ?? 'Sucursal';
      const safeDate = currentDate.replace(/\//g, '-');

      const pdfFileName = `${driverName}--${subsidiaryName}--Salida a Ruta--${safeDate}.pdf`;
      const excelFileName = `${driverName}--${subsidiaryName}--Salida a Ruta--${safeDate}.xlsx`;

      const pdfFile = this.createMockFile(
        pdfBuf,
        pdfFileName,
        'application/pdf',
      );

      const excelFile = this.createMockFile(
        excelBuf,
        excelFileName,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      await this.sendEmailNotification(
        pdfFile,
        excelFile,
        subsidiaryName,
        'outbound',
        outboundId,
      );
    } catch (error) {
      this.logger.error(
        `Error crítico en generateAndSendNotification: ${error?.message}`,
        error?.stack,
      );
    }
  }

  private createMockFile(
    buffer: Buffer,
    originalname: string,
    mimetype: string,
  ): Express.Multer.File {
    return {
      buffer,
      originalname,
      mimetype,
      fieldname: 'file',
      encoding: '7bit',
      size: buffer.length,
      stream: null as any,
      destination: '',
      filename: '',
      path: '',
    };
  }

  private async createTransfer(dto: any, queryRunner: QueryRunner) {
    // 1. Separar envíos normales y de carga
    const normalShipmentIds = dto.shipments
      .filter((pkg: any) => !pkg.isCharge)
      .map((pkg: any) => pkg.id);
    const chargeShipmentIds = dto.shipments
      .filter((pkg: any) => pkg.isCharge)
      .map((pkg: any) => pkg.id);

    // 2. Función de Actualización Forzada para Transferencias
    const processUpdates = async (
      ids: string[],
      entity: any,
      relationKey: 'shipment' | 'chargeShipment',
    ) => {
      if (ids.length === 0) return;

      // Actualizar el estado y cambiar la sucursal a la de destino
      await queryRunner.manager
        .createQueryBuilder()
        .update(entity)
        .set({
          status: ShipmentStatusType.EN_RUTA,
          subsidiary: { id: dto.destinationId }, // <-- nueva sucursal destino
        } as any)
        .whereInIds(ids)
        .execute();

      // Creación de Historial
      const now = new Date();
      const historyRecords = ids.map((id) =>
        queryRunner.manager.create(ShipmentStatus, {
          status: ShipmentStatusType.EN_RUTA,
          notes: `Transferencia en ruta hacia sucursal destino`,
          timestamp: now,
          [relationKey]: { id },
        }),
      );

      await queryRunner.manager.save(ShipmentStatus, historyRecords);
    };

    await processUpdates(normalShipmentIds, Shipment, 'shipment');
    await processUpdates(chargeShipmentIds, ChargeShipment, 'chargeShipment');

    return {
      transferredPackages: normalShipmentIds.length + chargeShipmentIds.length,
      destination: dto.destinationId,
    };
  }

  private async createDispatch(
    dto: any,
    queryRunner: QueryRunner,
    createdBy: string,
  ): Promise<PackageDispatch> {
    // 1. Separar envíos normales y envíos de carga
    const normalShipmentIds = dto.shipments
      .filter((pkg: any) => !pkg.isCharge)
      .map((pkg: any) => pkg.id);

    const chargeShipmentIds = dto.shipments
      .filter((pkg: any) => pkg.isCharge)
      .map((pkg: any) => pkg.id);

    // Generar trackingNumber único de 10 dígitos.
    const generatedTracking = await this.generateUniqueDispatchTracking(
      queryRunner,
    );

    // 2. Crear y Guardar el Despacho
    const newDispatch = queryRunner.manager.create(PackageDispatch, {
      trackingNumber: generatedTracking,
      routes: dto.routes?.map((id: string) => ({ id })) || [],
      drivers: dto.drivers?.map((id: string) => ({ id })) || [],
      vehicle: dto.vehicle ? { id: dto.vehicle } : null,
      subsidiary: { id: dto.warehouse },
      kms: dto.kms,
      createdBy: createdBy ? { id: createdBy } : null,
    });

    const savedDispatch = await queryRunner.manager.save(newDispatch);

    // 3. Función de Actualización Forzada (Write)
    const processUpdates = async (
      ids: string[],
      entity: any,
      relationKey: 'shipment' | 'chargeShipment',
    ) => {
      if (ids.length === 0) return;

      await queryRunner.manager
        .createQueryBuilder()
        .update(entity)
        .set({ status: ShipmentStatusType.EN_RUTA })
        .whereInIds(ids)
        .execute();

      // Creación de Historial
      const now = new Date();
      const historyRecords = ids.map((id) =>
        queryRunner.manager.create(ShipmentStatus, {
          status: ShipmentStatusType.EN_RUTA,
          exceptionCode: '',
          notes: `Salida a ruta (Folio Despacho: ${savedDispatch.trackingNumber})`,
          timestamp: now,
          [relationKey]: { id },
        }),
      );

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
      ...normalShipmentIds.map((id) =>
        queryRunner.manager.create(PackageDispatchHistory, {
          dispatch: { id: savedDispatch.id },
          shipment: { id },
        }),
      ),
      ...chargeShipmentIds.map((id) =>
        queryRunner.manager.create(PackageDispatchHistory, {
          dispatch: { id: savedDispatch.id },
          chargeShipment: { id },
        }),
      ),
    ];

    await queryRunner.manager.save(
      PackageDispatchHistory,
      dispatchHistoryRecords,
    );

    return savedDispatch;
  }

  /**
   * Genera un folio de 10 dígitos verificando que no exista ya en BD.
   * Reintenta un número acotado de veces para evitar colisiones de la
   * constraint única (Math.random NO garantiza unicidad por sí solo).
   */
  private async generateUniqueDispatchTracking(
    queryRunner: QueryRunner,
    maxAttempts = 5,
  ): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let tracking = '';
      for (let i = 0; i < 10; i++) {
        tracking += Math.floor(Math.random() * 10).toString();
      }

      const exists = await queryRunner.manager.findOne(PackageDispatch, {
        where: { trackingNumber: tracking },
        select: { id: true },
      });

      if (!exists) return tracking;
    }

    throw new InternalServerErrorException(
      'No se pudo generar un folio de despacho único, intente de nuevo.',
    );
  }

  private async processRemittances(shipments: any[], queryRunner: QueryRunner) {
    // Extraemos los tracking numbers de las piezas/remesas del DTO
    const pieceTrackingNumbers = shipments.flatMap((shipment) =>
      (shipment.remittances || []).map((rem: any) => rem.pieceTrackingNumber),
    );

    if (pieceTrackingNumbers.length > 0) {
      // Actualizamos masivamente el estado de esas remesas a EN_RUTA
      await queryRunner.manager
        .createQueryBuilder()
        .update(ShipmentRemittance)
        .set({ status: ShipmentStatusType.EN_RUTA })
        .where('pieceTrackingNumber IN (:...pieceTrackingNumbers)', {
          pieceTrackingNumbers,
        })
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
    const timeZone = this.timeZone;

    let info: WarehouseReceiving | WarehouseOutbound = null;

    if (!file || !excelFile) {
      this.logger.warn(
        `No se proporcionaron ambos archivos para la notificación de ${type} a bodega. ID: ${id}`,
      );
      return;
    }

    if (type === 'inbound') {
      info = await this.warehouseReceivingRepository.findOneBy({ id });
    } else {
      info = await this.warehouseOutboundRepository.findOneBy({ id });
    }

    if (!info) {
      this.logger.warn(
        `No se encontró la información de ${type} a bodega para el ID proporcionado: ${id}`,
      );
      return;
    }

    const warehouse = await this.dataSource
      .getRepository(Subsidiary)
      .findOneBy({ id: info.warehouseId });

    if (!warehouse) {
      this.logger.warn(
        `No se encontró la sucursal para el ID proporcionado en ${type} a bodega: ${info.warehouseId}`,
      );
      return;
    }

    const attachments = [
      { filename: file.originalname, content: file.buffer },
      { filename: excelFile.originalname, content: excelFile.buffer },
    ];

    const subject = `Notificación de ${
      type === 'inbound' ? 'Entrada' : 'Salida'
    } a Bodega - ${subsidiaryName}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
        <h2 style="border-bottom: 3px solid #3498db; padding-bottom: 8px;">
          📦 Notificación de ${type === 'inbound' ? 'Entrada' : 'Salida'} a Bodega
        </h2>

        <p>
          Se ha generado un nuevo reporte de <strong>${
            type === 'inbound' ? 'Entrada' : 'Salida'
          }</strong> para la sucursal <strong>${subsidiaryName}</strong>.
        </p>

        <p><strong>Fecha y hora:</strong> ${format(
          toZonedTime(info.createdAt, timeZone),
          'dd/MM/yyyy hh:mm aa',
        )}</p>

        <p style="margin-top: 20px;">
          Puede consultar más detalles en el sistema en la sección de ${
            type === 'inbound' ? 'Entradas' : 'Salidas'
          } a Bodega o descargar los archivos adjuntos.
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
        to: [warehouse.officeEmail, warehouse.officeEmailToCopy].filter(
          (email) => email,
        ),
        subject,
        htmlContent,
        attachments,
      });
    } catch (error) {
      this.logger.error(
        `Error al enviar correo de notificación para ${type} a bodega. ID: ${id}. ${error?.message}`,
        error?.stack,
      );
    }
  }

  private async getCityFromZipCode(zip: string): Promise<string | null> {
    const { data } = await axios.get<PostalCodeResponse>(
      `https://mexico-api.devaleff.com/api/codigo-postal/${zip}`,
    );

    const location = data.data.at(0);

    if (!location) {
      return null;
    }

    return location.d_ciudad.trim() || location.D_mnpio.trim();
  }

  /**
   * Las fuentes estándar de PDFKit (Helvetica) solo soportan WinAnsi (Latin-1).
   * Cualquier carácter fuera de ese rango (emojis, comillas tipográficas,
   * guiones largos, etc.) revienta el render. Sanitizamos preservando acentos
   * y signos comunes (rango Latin-1 imprimible) y descartando el resto.
   */
  private toPdfSafe(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value)
      // Normalizamos algunos caracteres "inteligentes" frecuentes.
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      // Eliminamos todo lo que no sea ASCII imprimible o Latin-1 imprimible.
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  }

  private async generateExcelBuffer(
    dispatch: PackageDispatch,
    packages: any[],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Despacho');

    // Título Principal (Excel sí soporta UTF-8, el emoji aquí es válido)
    const titleRow = sheet.addRow(['🚚 Salida a Ruta']);
    sheet.mergeCells(`A${titleRow.number}:I${titleRow.number}`);
    titleRow.font = { size: 16, bold: true, color: { argb: 'FFFFFF' } };
    titleRow.alignment = { vertical: 'middle', horizontal: 'center' };

    for (let col = 1; col <= 9; col++) {
      sheet.getCell(titleRow.number, col).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'ef883a' },
      };
    }

    sheet.addRow([]);

    const createdAt = format(
      toZonedTime(new Date(), this.timeZone),
      'yyyy-MM-dd HH:mm',
    );

    sheet.addRow([
      `Ruta: ${dispatch.routes?.map((r) => r.name).join(' -> ') || 'N/A'}`,
    ]);
    sheet.addRow([
      `Conductores: ${
        dispatch.drivers?.map((d) => d.name).join(' - ') || 'N/A'
      }`,
    ]);
    sheet.addRow([`Unidad: ${dispatch.vehicle?.name || 'N/A'}`]);
    sheet.addRow([`Fecha: ${createdAt}`]);
    sheet.addRow([`Paquetes: ${packages.length}`]);
    sheet.addRow([]);

    // Cabeceras de tabla
    const headerRow = sheet.addRow([
      'No.',
      'Guía',
      'Recibe',
      'Dirección',
      'CP',
      'Cobro',
      'Fecha',
      'Teléfono',
      'Firma',
    ]);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'ef883a' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Filas
    packages.forEach((pkg, index) => {
      const amount = pkg.payment?.amount ?? pkg.paymentAmount ?? 0;
      sheet.addRow([
        index + 1,
        pkg.trackingNumber || pkg.dhlUniqueId,
        pkg.recipientName,
        pkg.recipientAddress,
        pkg.recipientZip,
        pkg.isCharge ? amount : 'N/A',
        format(toZonedTime(new Date(), this.timeZone), 'dd/MM/yyyy'),
        pkg.recipientPhone || '',
        '',
      ]);
    });

    // Ajustar columnas
    sheet.columns.forEach((column) => {
      column.width = 18; // Ancho por defecto
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as ArrayBuffer);
  }

  private async generatePdfBuffer(
    dispatch: PackageDispatch,
    packages: any[],
  ): Promise<Buffer> {
    try {
      const currentDate = toZonedTime(new Date(), this.timeZone);
      const formattedDate = format(currentDate, 'yyyy-MM-dd');
      const formattedTime = format(currentDate, 'HH:mm:ss');

      const subsidiaryName = this.toPdfSafe(dispatch.subsidiary?.name);
      const isHermosillo = subsidiaryName.toLowerCase().includes('hermosillo');

      // Lógica de anchos de columna
      let tableWidths = [20, 65, 100, 140, 30, 50, 50, 40, 60, 80];
      let tableHeaders = [
        '[#]', 'NO. GUIA', 'NOMBRE', 'DIRECCIÓN', 'CP',
        'COBRO', 'FECHA', 'HORA', 'CELULAR', 'FIRMA',
      ];

      if (isHermosillo) {
        tableWidths = [20, 65, 120, 160, 30, 50, 50, 60, 85];
        tableHeaders = [
          '[#]', 'NO. GUIA', 'NOMBRE', 'DIRECCIÓN', 'CP',
          'COBRO', 'FECHA', 'CELULAR', 'FIRMA',
        ];
      }

      // 1. Construir las filas de la tabla
      const tableBody: TableCell[][] = [];

      // Cabecera
      tableBody.push(
        tableHeaders.map((text) => ({
          text,
          style: 'tableHeader',
          fillColor: '#8c5e4e',
          color: 'white',
        })),
      );

      // Filas de datos
      packages.forEach((pkg, index) => {
        const amount = pkg.payment?.amount ?? pkg.paymentAmount ?? null;
        const hasPayment = amount != null;
        const isExpiringToday = pkg.commitDateTime
          ? format(
              toZonedTime(new Date(pkg.commitDateTime), this.timeZone),
              'yyyy-MM-dd',
            ) === formattedDate
          : false;

        let fillColor = index % 2 === 0 ? '#f8f9fa' : '#ffffff';
        if (hasPayment) fillColor = '#fff2cc';
        if (isExpiringToday) fillColor = '#ffe6e6';

        const commitDate = pkg.commitDateTime
          ? format(
              toZonedTime(new Date(pkg.commitDateTime), this.timeZone),
              'yyyy-MM-dd',
            )
          : '';
        const commitTime = pkg.commitDateTime
          ? format(
              toZonedTime(new Date(pkg.commitDateTime), this.timeZone),
              'HH:mm:ss',
            )
          : '';
        const paymentText = hasPayment ? `$${amount}` : 'N/A';

        const rowData: TableCell[] = [
          { text: `${index + 1}`, color: '#cc0000', bold: true },
          { text: this.toPdfSafe(pkg.trackingNumber), color: '#cc0000', bold: true },
          { text: this.toPdfSafe(pkg.recipientName) },
          { text: this.toPdfSafe(pkg.recipientAddress) },
          { text: this.toPdfSafe(pkg.recipientZip) },
          { text: paymentText, bold: hasPayment },
          { text: commitDate },
        ];

        if (!isHermosillo) {
          rowData.push({ text: commitTime });
        }

        rowData.push({ text: this.toPdfSafe(pkg.recipientPhone) });
        rowData.push({ text: '' }); // Firma vacía

        const formattedRow = rowData.map((cell) => {
          if (typeof cell === 'object') return { ...cell, fillColor, margin: [2, 4] };
          return { text: cell, fillColor, margin: [2, 4] };
        });

        tableBody.push(formattedRow as TableCell[]);
      });

      // 2. Definición del documento
      const docDefinition: TDocumentDefinitions = {
        pageSize: 'LETTER',
        pageOrientation: 'landscape',
        pageMargins: [20, 20, 20, 20],
        defaultStyle: { font: 'Helvetica', fontSize: 8 },
        styles: {
          headerText: { fontSize: 16, bold: true, color: '#8c5e4e' },
          tableHeader: { bold: true, fontSize: 8, alignment: 'center', margin: [0, 4] },
          gridLabel: { bold: true, color: '#8c5e4e', fontSize: 7 },
          gridValue: { color: '#212529', fontSize: 9 },
        },
        content: [
          {
            columns: [
              { text: 'SALIDA A RUTA', style: 'headerText', width: '*' },
              {
                text: `Fecha: ${formattedDate}\nHora: ${formattedTime}`,
                alignment: 'right',
                width: 100,
              },
            ],
            columnGap: 10,
            margin: [0, 0, 0, 10],
          },
          {
            table: {
              widths: ['*', '*', '*', '*'],
              body: [
                [
                  { stack: [{ text: 'SUCURSAL', style: 'gridLabel' }, { text: subsidiaryName, style: 'gridValue' }], fillColor: '#f8f9fa', border: [true, true, true, true] },
                  { stack: [{ text: 'VEHÍCULO', style: 'gridLabel' }, { text: this.toPdfSafe(dispatch.vehicle?.name) || 'N/A', style: 'gridValue' }], fillColor: '#f8f9fa', border: [true, true, true, true] },
                  { stack: [{ text: 'TOTAL PAQUETES', style: 'gridLabel' }, { text: `${packages.length}`, style: 'gridValue' }], fillColor: '#f8f9fa', border: [true, true, true, true] },
                  { stack: [{ text: 'SEGUIMIENTO', style: 'gridLabel' }, { text: this.toPdfSafe(dispatch.trackingNumber), style: 'gridValue' }], fillColor: '#f8f9fa', border: [true, true, true, true] },
                ],
              ],
            },
            margin: [0, 0, 0, 10],
          },
          {
            text: 'SIMBOLOGÍA: [C] CARGA/F2/31.5 - [$] PAGO - [H] VALOR ALTO - [A] AÉREO',
            alignment: 'center',
            bold: true,
            color: '#8c5e4e',
            fontSize: 7,
            margin: [0, 0, 0, 5],
          },
          {
            table: { headerRows: 1, widths: tableWidths, body: tableBody },
            layout: {
              hLineWidth: () => 0.5,
              vLineWidth: () => 0.5,
              hLineColor: () => '#000000',
              vLineColor: () => '#000000',
            },
          },
        ],
      };

      // 3. Render con la API 0.3.x: createPdf(...).getBuffer()
      const pdf = pdfMake.createPdf(docDefinition);
      return await pdf.getBuffer();
    } catch (error) {
      this.logger.error(
        `Error generating PDF with pdfmake: ${error?.message}`,
        error?.stack,
      );
      throw error;
    }
  }
}