import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { MaintenanceRequest } from 'src/entities/maintenance-request.entity';
import { PurchaseOrder } from 'src/entities/purchase-order.entity';
import { Vehicle } from 'src/entities/vehicle.entity';
import { FolioService } from '../folio.service';
import { VehicleKmsService } from '../vehicle-kms.service';
import { assertSubsidiaryScope, ScopeUser } from '../maintenance-scope.util';
import { CreateRequestDto, UpdateRequestDto } from './dto/request.dto';

/** Solicitudes de mantenimiento (contenedor de cotizaciones comparables). */
@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(MaintenanceRequest) private readonly requests: Repository<MaintenanceRequest>,
    @InjectRepository(PurchaseOrder) private readonly orders: Repository<PurchaseOrder>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly dataSource: DataSource,
    private readonly folios: FolioService,
    private readonly vehicleKms: VehicleKmsService,
  ) {}

  /** Lista con resumen: # cotizaciones, mejor total y orden (si existe). */
  async listBySubsidiary(subsidiaryId: string, status?: string) {
    const qb = this.requests
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.vehicle', 'vehicle')
      .leftJoinAndSelect('r.quotes', 'quote')
      .leftJoin('r.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.name', 'createdBy.lastName'])
      .where('r.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .orderBy('r.createdAt', 'DESC');
    if (status) qb.andWhere('r.status IN (:...status)', { status: status.split(',') });
    const list = await qb.getMany();
    const orders = await this.ordersByRequest(list.map((r) => r.id));
    return list.map(({ quotes, ...r }) => ({
      ...r,
      quotesCount: quotes?.length ?? 0,
      minTotal: quotes?.length ? Math.min(...quotes.map((q) => Number(q.total))) : null,
      purchaseOrder: orders.get(r.id) ?? null,
    }));
  }

  /** Bandeja: solicitudes en cotización con ≥1 cotización, con partidas para comparar. */
  async inbox(subsidiaryId: string) {
    const list = await this.requests
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.quotes', 'quote')
      .leftJoinAndSelect('quote.items', 'item')
      .leftJoinAndSelect('quote.supplier', 'supplier')
      .leftJoinAndSelect('r.vehicle', 'vehicle')
      .where('r.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere("r.status = 'en_cotizacion'")
      .orderBy('r.createdAt', 'ASC')
      .addOrderBy('quote.total', 'ASC')
      .getMany();
    return list;
  }

  async findOne(id: string, user?: ScopeUser) {
    const r = await this.requests
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.vehicle', 'vehicle')
      .leftJoinAndSelect('r.quotes', 'quote')
      .leftJoinAndSelect('quote.items', 'item')
      .leftJoinAndSelect('item.service', 'service')
      .leftJoinAndSelect('quote.supplier', 'supplier')
      .leftJoinAndSelect('supplier.contacts', 'contact')
      .leftJoin('r.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.name', 'createdBy.lastName'])
      .where('r.id = :id', { id })
      .orderBy('quote.total', 'ASC')
      .getOne();
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    assertSubsidiaryScope(user, r.subsidiaryId);
    const orders = await this.ordersByRequest([r.id]);
    return { ...r, purchaseOrder: orders.get(r.id) ?? null };
  }

  async create(dto: CreateRequestDto, user: ScopeUser) {
    const vehicle = await this.vehicles.findOne({ where: { id: dto.vehicleId }, relations: ['subsidiary'] });
    if (!vehicle) throw new BadRequestException('El vehículo no existe');
    if (!vehicle.subsidiary?.id) throw new BadRequestException('El vehículo no tiene sucursal asignada');
    assertSubsidiaryScope(user, vehicle.subsidiary.id);

    const saved = await this.dataSource.transaction(async (m) => {
      const folio = await this.folios.next(m, 'SM');
      return m.save(MaintenanceRequest, m.create(MaintenanceRequest, {
        folio,
        vehicleId: vehicle.id,
        subsidiaryId: vehicle.subsidiary.id,
        kmsAtRequest: dto.kmsAtRequest ?? null,
        description: dto.description.trim(),
        priority: dto.priority,
        status: 'abierta',
        createdById: user?.userId ?? null,
      }));
    });
    if (dto.kmsAtRequest) await this.vehicleKms.bump(vehicle.id, dto.kmsAtRequest, 'request');
    return saved;
  }

  async update(id: string, dto: UpdateRequestDto, user: ScopeUser) {
    const r = await this.loadEditable(id, user);
    Object.assign(r, {
      ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.kmsAtRequest !== undefined ? { kmsAtRequest: dto.kmsAtRequest } : {}),
      updatedAt: new Date(),
    });
    return this.requests.save(r);
  }

  async remove(id: string, user: ScopeUser) {
    await this.loadEditable(id, user);
    await this.requests.softDelete(id);
    return { ok: true };
  }

  async cancel(id: string, user: ScopeUser) {
    const r = await this.loadEditable(id, user);
    r.status = 'cancelada';
    r.updatedAt = new Date();
    return this.requests.save(r);
  }

  /** Editable/eliminable solo mientras no tenga orden de compra. */
  async loadEditable(id: string, user?: ScopeUser) {
    const r = await this.requests.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    assertSubsidiaryScope(user, r.subsidiaryId);
    if (await this.orders.exist({ where: { requestId: id } })) {
      throw new BadRequestException('La solicitud ya tiene orden de compra; ya no se puede modificar.');
    }
    if (r.status === 'cancelada' || r.status === 'completada') {
      throw new BadRequestException('La solicitud ya está cerrada.');
    }
    return r;
  }

  private async ordersByRequest(requestIds: string[]) {
    const map = new Map<string, { id: string; folio: string; status: string }>();
    if (!requestIds.length) return map;
    const list = await this.orders.find({ where: { requestId: In(requestIds) }, select: ['id', 'folio', 'status', 'requestId'] });
    for (const o of list) map.set(o.requestId, { id: o.id, folio: o.folio, status: o.status });
    return map;
  }
}
