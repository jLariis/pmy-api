import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, Like, Repository } from 'typeorm';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { Shipment, ShipmentStatus } from 'src/entities';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { WarehouseDelivery } from 'src/entities/warehouse-delivery.entity';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { TrackingInfoDto } from './dto/tracking-info.dto';
import { SavePickUpDto } from './dto/save-pick-up.dto';
import { PaginatedResult, parsePagination, resolveDateRange } from 'src/common/pagination.util';

/** Tipos de registro que maneja este módulo y su estatus destino. */
const TYPE_TO_STATUS: Record<string, ShipmentStatusType> = {
  ocurre: ShipmentStatusType.ES_OCURRE,
  entrega_bodega: ShipmentStatusType.ENTREGADO_EN_BODEGA,
};

@Injectable()
export class PickUpService {
  constructor(
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(ForPickUp)
    private forPickUpRepository: Repository<ForPickUp>,
    @InjectRepository(WarehouseDelivery)
    private warehouseDeliveryRepository: Repository<WarehouseDelivery>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Registra paquetes como "Ocurre" o "Entregado en bodega":
   *  - Actualiza el estatus del shipment/chargeShipment.
   *  - Escribe historial de estatus.
   *  - Guarda el registro en `for-pick-up` (con sucursal y usuario).
   * Todo en una transacción.
   */
  async create(dto: SavePickUpDto, userId?: string) {
    const { subsidiaryId, items } = dto;

    if (!subsidiaryId) throw new BadRequestException('Falta la sucursal.');
    if (!items?.length) throw new BadRequestException('No se recibieron paquetes para registrar.');

    const noteFor = (type: string) =>
      type === 'ocurre'
        ? 'Registrado como Ocurre en bodega'
        : 'Entregado en bodega (entrega en sucursal)';

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const now = new Date();
      const saved: any[] = [];

      for (const item of items) {
        const trackingNumber = (item.trackingNumber || '').trim();
        if (!trackingNumber) continue;

        // El tipo viene POR PAQUETE (permite guardar ocurre + entrega juntos).
        const type = item.type;
        const status = TYPE_TO_STATUS[type];
        if (!status) {
          throw new BadRequestException(`Tipo de registro inválido para ${trackingNumber}: ${type}`);
        }
        const note = noteFor(type);

        // Resolver shipment / chargeShipment (por id si vino, si no por trackingNumber).
        let shipmentId = item.shipmentId || null;
        let chargeShipmentId = item.chargeShipmentId || null;

        if (!shipmentId && !chargeShipmentId) {
          const shipment = await queryRunner.manager.findOne(Shipment, {
            where: { trackingNumber },
            select: ['id'],
            order: { createdAt: 'DESC' },
          });
          if (shipment) {
            shipmentId = shipment.id;
          } else {
            const charge = await queryRunner.manager.findOne(ChargeShipment, {
              where: { trackingNumber },
              select: ['id'],
              order: { createdAt: 'DESC' },
            });
            if (charge) chargeShipmentId = charge.id;
          }
        }

        if (!shipmentId && !chargeShipmentId) {
          throw new BadRequestException(`No se encontró el paquete ${trackingNumber} en la base de datos.`);
        }

        // 1. Actualizar estatus + 2. historial.
        if (shipmentId) {
          await queryRunner.manager.update(Shipment, { id: shipmentId }, { status });
          await queryRunner.manager.save(
            ShipmentStatus,
            queryRunner.manager.create(ShipmentStatus, {
              status,
              notes: note,
              timestamp: now,
              shipment: { id: shipmentId } as Shipment,
            }),
          );
        } else {
          await queryRunner.manager.update(ChargeShipment, { id: chargeShipmentId }, { status });
          await queryRunner.manager.save(
            ShipmentStatus,
            queryRunner.manager.create(ShipmentStatus, {
              status,
              notes: note,
              timestamp: now,
              chargeShipment: { id: chargeShipmentId } as ChargeShipment,
            }),
          );
        }

        // 3. Registro en la tabla correspondiente al tipo:
        //    - ocurre  -> for-pick-up (paquetes en espera de ser recogidos)
        //    - entrega -> warehouse_delivery (entregas completadas en bodega)
        const Target = type === 'ocurre' ? ForPickUp : WarehouseDelivery;
        const record = queryRunner.manager.create(Target, {
          trackingNumber,
          date: now,
          createdById: userId || null,
          subsidiary: { id: subsidiaryId } as any,
          shipmentId,
          chargeShipmentId,
        });
        saved.push(await queryRunner.manager.save(Target, record));
      }

      await queryRunner.commitTransaction();
      return { success: true, count: saved.length };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Historial paginado por sucursal (semana por defecto + búsqueda por guía).
   * Une ambas tablas: `for-pick-up` (ocurre) y `warehouse_delivery` (entrega).
   * Al estar acotado a la semana, mezclamos y paginamos en memoria.
   */
  async findBySubsidiary(
    subsidiaryId: string,
    opts: { page?: string | number; limit?: string | number; from?: string; to?: string; search?: string; type?: string } = {},
  ): Promise<PaginatedResult<any>> {
    const { start, end } = resolveDateRange(opts.from, opts.to);
    const { page, limit, skip } = parsePagination(opts.page, opts.limit);
    const search = (opts.search || '').trim();
    const type = opts.type && opts.type !== 'all' ? opts.type : undefined;

    const where: any = {
      subsidiary: { id: subsidiaryId },
      date: Between(start, end),
    };
    if (search) where.trackingNumber = Like(`%${search}%`);

    const findOpts = {
      where,
      relations: ['shipment', 'chargeShipment'],
      order: { date: 'DESC' as const },
    };

    // El tipo decide qué tabla(s) consultar (cada tabla es de un solo tipo).
    const [pickUps, deliveries] = await Promise.all([
      type === 'entrega_bodega' ? Promise.resolve([] as ForPickUp[]) : this.forPickUpRepository.find(findOpts),
      type === 'ocurre' ? Promise.resolve([] as WarehouseDelivery[]) : this.warehouseDeliveryRepository.find(findOpts),
    ]);

    const mapRow = (r: ForPickUp | WarehouseDelivery, type: 'ocurre' | 'entrega_bodega') => {
      const entity = r.shipment || r.chargeShipment;
      return {
        id: r.id,
        trackingNumber: r.trackingNumber,
        date: r.date,
        isCharge: !!r.chargeShipmentId,
        type,
        status: entity?.status ?? null,
        recipientName: entity?.recipientName ?? null,
        recipientCity: entity?.recipientCity ?? null,
        recipientZip: entity?.recipientZip ?? null,
        shipmentType: entity?.shipmentType ?? null,
      };
    };

    const merged = [
      ...pickUps.map((r) => mapRow(r, 'ocurre')),
      ...deliveries.map((r) => mapRow(r, 'entrega_bodega')),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const total = merged.length;
    const data = merged.slice(skip, skip + limit);

    return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** Info de un paquete por número de guía (para el panel de detalle al escanear). */
  async findByTrackingNumber(trackingNumber: string) {
    const shipmentData = await this.shipmentRepository.findOne({
      where: { trackingNumber },
      order: { createdAt: 'DESC' },
    });

    const chargeShipmentData = !shipmentData
      ? await this.chargeShipmentRepository.findOne({
          where: { trackingNumber },
          order: { createdAt: 'DESC' },
        })
      : null;

    if (!shipmentData && !chargeShipmentData) {
      throw new NotFoundException('Tracking number not found');
    }

    const entity = shipmentData || chargeShipmentData;
    const isCharge = !shipmentData;

    const pickUpData: TrackingInfoDto = {
      id: entity.id,
      trackingNumber: entity.trackingNumber,
      carrierCode: entity.carrierCode,
      fedexUniqueId: entity.fedexUniqueId,
      consNumber: entity.consNumber,
      consolidatedId: entity.consolidatedId,
      commitDateTime: entity.commitDateTime,
      isHighValue: entity.isHighValue,
      priority: entity.priority,
      receivedByName: entity.receivedByName,
      recipientAddress: entity.recipientAddress,
      recipientCity: entity.recipientCity,
      recipientName: entity.recipientName,
      recipientPhone: entity.recipientPhone,
      recipientZip: entity.recipientZip,
      shipmentType: entity.shipmentType,
      status: entity.status,
      isCharge,
    };

    return pickUpData;
  }
}
