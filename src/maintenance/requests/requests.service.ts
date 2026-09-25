import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { MaintenanceRequest, TYPES_REQUIRING_VEHICLE } from 'src/entities/maintenance-request.entity';
import { RequestItem } from 'src/entities/request-item.entity';
import { PurchaseOrder } from 'src/entities/purchase-order.entity';
import { Vehicle } from 'src/entities/vehicle.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { FolioService } from '../folio.service';
import { VehicleKmsService } from '../vehicle-kms.service';
import { ScopeUser, userDisplayName } from '../maintenance-scope.util';
import { allowedSubsidiaryIds, isAuthorizer, isPurchaser, MTTO } from '../maintenance.permissions';
import { expedienteStage } from '../utils/expediente-stage.util';
import { CreateRequestDto, RequestItemDto, UpdateRequestDto } from './dto/request.dto';

export const requestLink = (id: string) => `/compras/solicitud?id=${id}`;
const TYPE_LABEL: Record<string, string> = { mantenimiento: 'Mantenimiento', servicio: 'Servicio', reparacion: 'Reparación', compra: 'Compra' };

export interface BoardFilter {
  subsidiaryId?: string;
  type?: string;
  /** Solo las solicitudes que levantó este usuario ("Mis solicitudes"). */
  mineUserId?: string;
}

/**
 * Solicitudes de compra (expediente). Cualquier usuario las levanta; Compras (Gerardo) las revisa, cotiza
 * y genera órdenes; el autorizador (Edgardo) autoriza cada orden.
 */
@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    @InjectRepository(MaintenanceRequest) private readonly requests: Repository<MaintenanceRequest>,
    @InjectRepository(PurchaseOrder) private readonly orders: Repository<PurchaseOrder>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly dataSource: DataSource,
    private readonly folios: FolioService,
    private readonly vehicleKms: VehicleKmsService,
    private readonly notifier: NotificationsService,
  ) {}

  // ---------------- Visibilidad ----------------

  /** Quien la levantó, Compras, el autorizador y los admins de esa sucursal pueden verla. */
  private canView(r: MaintenanceRequest, user?: ScopeUser): boolean {
    if (!user) return false;
    if (r.createdById && r.createdById === user.userId) return true;
    if (isPurchaser(user) || isAuthorizer(user)) return true;
    const allowed = allowedSubsidiaryIds(user);
    return (allowed === null || allowed.includes(r.subsidiaryId)) && (user.permissions ?? []).some((p) => p.startsWith('mttoVehiculos.'));
  }

  // ---------------- Tablero / listas ----------------

  /**
   * Tarjetas del tablero. Compras ve todas las sucursales (o filtra una); "Mis solicitudes" filtra por quien la
   * levantó. Terminadas/rechazadas/canceladas se limitan a los últimos 60 días.
   */
  async board(filter: BoardFilter, user: ScopeUser) {
    if (!filter.mineUserId && !isPurchaser(user) && !isAuthorizer(user)) {
      const allowed = allowedSubsidiaryIds(user);
      if (!filter.subsidiaryId) throw new ForbiddenException('Elige una sucursal.');
      if (allowed && !allowed.includes(filter.subsidiaryId)) throw new ForbiddenException('Solo puedes consultar datos de tus sucursales asignadas.');
    }
    const since = new Date(Date.now() - 60 * 86_400_000);
    const qb = this.requests
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.vehicle', 'vehicle')
      .leftJoinAndSelect('r.subsidiary', 'subsidiary')
      .leftJoinAndSelect('r.items', 'item')
      .leftJoin('r.quotes', 'quote')
      .addSelect(['quote.id', 'quote.total'])
      .leftJoin('r.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.name', 'createdBy.lastName'])
      .where("(r.status NOT IN ('completada','cancelada','rechazada') OR COALESCE(r.updatedAt, r.createdAt) >= :since)", { since })
      .orderBy('r.createdAt', 'DESC');
    if (filter.subsidiaryId) qb.andWhere('r.subsidiaryId = :sid', { sid: filter.subsidiaryId });
    if (filter.type) qb.andWhere('r.type = :type', { type: filter.type });
    if (filter.mineUserId) qb.andWhere('r.createdById = :uid', { uid: filter.mineUserId });
    const list = await qb.getMany();

    const orders = await this.ordersByRequest(list.map((r) => r.id));
    return list.map((r) => {
      const pos = orders.get(r.id) ?? [];
      const quotes = r.quotes ?? [];
      return {
        id: r.id,
        folio: r.folio,
        type: r.type,
        vehicle: r.vehicle,
        subsidiary: r.subsidiary ? { id: r.subsidiary.id, name: r.subsidiary.name } : null,
        description: r.description,
        priority: r.priority,
        status: r.status,
        itemsCount: r.items?.length ?? 0,
        createdAt: r.createdAt,
        updatedAt: pos.reduce<Date>((acc, p) => (p.updatedAt && p.updatedAt > acc ? p.updatedAt : acc), r.updatedAt ?? r.createdAt),
        createdByName: r.createdBy ? userDisplayName(r.createdBy) : null,
        quotesCount: quotes.length,
        bestTotal: quotes.length ? Math.min(...quotes.map((q) => Number(q.total))) : null,
        orders: pos.map((p) => ({ id: p.id, folio: p.folio, status: p.status, total: Number(p.finalAmount ?? p.total), supplierName: p.supplier?.name ?? null })),
        ...expedienteStage({ requestStatus: r.status, quotesCount: quotes.length, orders: pos }),
      };
    });
  }

  async findOne(id: string, user?: ScopeUser) {
    const r = await this.requests
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.vehicle', 'vehicle')
      .leftJoinAndSelect('r.subsidiary', 'subsidiary')
      .leftJoinAndSelect('r.items', 'reqItem')
      .leftJoinAndSelect('reqItem.product', 'reqProduct')
      .leftJoinAndSelect('reqItem.category', 'reqCategory')
      .leftJoinAndSelect('reqItem.unit', 'reqUnit')
      .leftJoinAndSelect('r.quotes', 'quote')
      .leftJoinAndSelect('quote.items', 'item')
      .leftJoinAndSelect('item.product', 'product')
      .leftJoinAndSelect('quote.supplier', 'supplier')
      .leftJoinAndSelect('supplier.contacts', 'contact')
      .leftJoin('r.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.name', 'createdBy.lastName'])
      .leftJoin('r.reviewedBy', 'reviewedBy')
      .addSelect(['reviewedBy.id', 'reviewedBy.name', 'reviewedBy.lastName'])
      .where('r.id = :id', { id })
      .orderBy('reqItem.sortOrder', 'ASC')
      .addOrderBy('quote.total', 'ASC')
      .getOne();
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    if (!this.canView(r, user)) throw new ForbiddenException('No tienes acceso a esta solicitud.');
    const pos = (await this.ordersByRequest([r.id])).get(r.id) ?? [];
    return {
      ...r,
      orders: pos.map((p) => ({ id: p.id, folio: p.folio, status: p.status, total: Number(p.finalAmount ?? p.total), supplierName: p.supplier?.name ?? null, rejectionReason: p.rejectionReason })),
      /** Compat: la primera orden activa (las pantallas viejas leen `purchaseOrder`). */
      purchaseOrder: pos.find((p) => p.status !== 'cancelada') ?? null,
      ...expedienteStage({ requestStatus: r.status, quotesCount: r.quotes?.length ?? 0, orders: pos }),
    };
  }

  // ---------------- Alta / edición ----------------

  private buildItems(items: RequestItemDto[], requestId?: string) {
    return items.map((i, idx) => this.dataSource.manager.create(RequestItem, {
      ...(i.id ? { id: i.id } : {}),
      ...(requestId ? { requestId } : {}),
      productId: i.productId ?? null,
      categoryId: i.categoryId ?? null,
      description: i.description.trim(),
      quantity: Math.round(Number(i.quantity) * 100) / 100,
      unitId: i.unitId ?? null,
      notes: i.notes?.trim() || null,
      sortOrder: idx,
    }));
  }

  /** Valida sucursal (asignada al usuario) y unidad (obligatoria según el tipo; de esa sucursal). */
  private async validateScope(type: string, subsidiaryId: string, vehicleId: string | null | undefined, user: ScopeUser) {
    const allowed = allowedSubsidiaryIds(user);
    if (allowed && !allowed.includes(subsidiaryId) && !isPurchaser(user)) {
      throw new ForbiddenException('Solo puedes pedir para tus sucursales asignadas.');
    }
    if (TYPES_REQUIRING_VEHICLE.includes(type as any) && !vehicleId) {
      throw new BadRequestException(`Para ${TYPE_LABEL[type]?.toLowerCase() ?? 'este tipo'} elige la unidad.`);
    }
    if (vehicleId) {
      const v = await this.vehicles.findOne({ where: { id: vehicleId }, relations: ['subsidiary'] });
      if (!v) throw new BadRequestException('La unidad no existe.');
      if (v.subsidiary?.id && v.subsidiary.id !== subsidiaryId) throw new BadRequestException('La unidad no pertenece a la sucursal elegida.');
    }
  }

  async create(dto: CreateRequestDto, user: ScopeUser) {
    await this.validateScope(dto.type, dto.subsidiaryId, dto.vehicleId, user);
    const saved = await this.dataSource.transaction(async (m) => {
      const folio = await this.folios.next(m, 'SOL');
      return m.save(MaintenanceRequest, m.create(MaintenanceRequest, {
        folio,
        type: dto.type,
        subsidiaryId: dto.subsidiaryId,
        vehicleId: dto.vehicleId ?? null,
        kmsAtRequest: dto.kmsAtRequest ?? null,
        description: dto.description.trim(),
        priority: dto.priority,
        status: 'por_revisar',
        createdById: user?.userId ?? null,
        items: this.buildItems(dto.items),
      }));
    });
    if (dto.vehicleId && dto.kmsAtRequest) await this.vehicleKms.bump(dto.vehicleId, dto.kmsAtRequest, 'request');
    await this.notifyPurchasers(saved, user);
    return saved;
  }

  /** Quien la levantó edita mientras está por revisar; Compras mientras no haya órdenes. */
  async update(id: string, dto: UpdateRequestDto, user: ScopeUser) {
    const r = await this.loadEditable(id, user);
    const type = dto.type ?? r.type;
    const vehicleId = dto.vehicleId !== undefined ? dto.vehicleId : r.vehicleId;
    await this.validateScope(type, r.subsidiaryId, vehicleId, { ...user, role: isPurchaser(user) ? 'superadmin' : user.role });
    Object.assign(r, {
      type,
      vehicleId,
      ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.kmsAtRequest !== undefined ? { kmsAtRequest: dto.kmsAtRequest } : {}),
      updatedAt: new Date(),
    });
    if (dto.items) r.items = this.buildItems(dto.items, r.id);
    await this.requests.save(r);
    return this.findOne(id, user);
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
    await this.requests.save(r);
    return this.findOne(id, user);
  }

  async loadEditable(id: string, user?: ScopeUser) {
    const r = await this.requests.findOne({ where: { id }, relations: ['items'] });
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    const purchaser = isPurchaser(user);
    const owner = !!user?.userId && r.createdById === user.userId;
    if (!purchaser && !(owner && r.status === 'por_revisar')) {
      throw new ForbiddenException(owner ? 'Compras ya la revisó; ya no puedes modificarla.' : 'No puedes modificar esta solicitud.');
    }
    if (await this.orders.exist({ where: { requestId: id } })) {
      throw new BadRequestException('La solicitud ya tiene órdenes de compra; ya no se puede modificar.');
    }
    if (['cancelada', 'completada', 'rechazada'].includes(r.status)) throw new BadRequestException('La solicitud ya está cerrada.');
    return r;
  }

  // ---------------- Revisión (Compras) ----------------

  async approve(id: string, user: ScopeUser) {
    if (!isPurchaser(user)) throw new ForbiddenException('Solo Compras puede autorizar solicitudes.');
    const r = await this.requests.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    if (r.status !== 'por_revisar') throw new BadRequestException('La solicitud ya fue revisada.');
    await this.requests.update(id, { status: 'abierta', reviewedById: user.userId ?? null, reviewedAt: new Date(), rejectionReason: null, updatedAt: new Date() });
    await this.notifyRequester(r, 'compras.solicitud_autorizada', `Tu solicitud ${r.folio} fue autorizada`, 'Compras ya está cotizando lo que pediste.', user);
    return this.findOne(id, user);
  }

  async reject(id: string, reason: string, user: ScopeUser) {
    if (!isPurchaser(user)) throw new ForbiddenException('Solo Compras puede rechazar solicitudes.');
    const r = await this.requests.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    if (r.status !== 'por_revisar') throw new BadRequestException('La solicitud ya fue revisada.');
    await this.requests.update(id, { status: 'rechazada', reviewedById: user.userId ?? null, reviewedAt: new Date(), rejectionReason: reason.trim(), updatedAt: new Date() });
    await this.notifyRequester(r, 'compras.solicitud_rechazada', `Tu solicitud ${r.folio} fue rechazada`, reason.trim(), user);
    return this.findOne(id, user);
  }

  // ---------------- Avisos ----------------

  private async purchaserIds(): Promise<string[]> {
    const rows: Array<{ userId: string }> = await this.dataSource.query(
      `SELECT up.userId FROM user_permission up JOIN permission p ON p.id = up.permissionId WHERE p.code = ? AND up.effect = 'allow'`,
      [MTTO.revisar],
    );
    return rows.map((x) => x.userId);
  }

  private async notifyPurchasers(r: MaintenanceRequest, user: ScopeUser) {
    try {
      const ids = await this.purchaserIds();
      await this.notifier.emit({
        type: 'compras.solicitud_nueva',
        audience: ids.length ? { userIds: ids } : { role: 'superadmin' },
        title: `Nueva solicitud ${r.folio} · ${TYPE_LABEL[r.type] ?? ''}`,
        body: r.description.slice(0, 180),
        link: requestLink(r.id),
        entityId: r.id,
        subsidiaryId: r.subsidiaryId,
        actor: { id: user?.userId, name: userDisplayName(user) },
      });
    } catch (e: any) {
      this.logger.warn(`no se pudo avisar a Compras de ${r.folio}: ${e?.message}`);
    }
  }

  async notifyRequester(r: Pick<MaintenanceRequest, 'id' | 'folio' | 'createdById' | 'subsidiaryId'>, type: string, title: string, body: string, user?: ScopeUser) {
    if (!r.createdById || r.createdById === user?.userId) return;
    try {
      await this.notifier.emit({
        type, audience: { userId: r.createdById }, title, body, link: requestLink(r.id), entityId: r.id,
        subsidiaryId: r.subsidiaryId, actor: { id: user?.userId, name: userDisplayName(user) },
      });
    } catch (e: any) {
      this.logger.warn(`no se pudo avisar al solicitante de ${r.folio}: ${e?.message}`);
    }
  }

  // ---------------- Apoyo ----------------

  private async ordersByRequest(requestIds: string[]) {
    const map = new Map<string, PurchaseOrder[]>();
    if (!requestIds.length) return map;
    const list = await this.orders.find({
      where: { requestId: In(requestIds) },
      select: ['id', 'folio', 'status', 'total', 'finalAmount', 'rejectionReason', 'requestId', 'updatedAt', 'supplierId', 'createdAt'],
      relations: ['supplier'],
      order: { createdAt: 'ASC' },
    });
    for (const o of list) map.set(o.requestId, [...(map.get(o.requestId) ?? []), o]);
    return map;
  }
}
