import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PurchaseOrder } from 'src/entities/purchase-order.entity';
import { PurchaseOrderItem } from 'src/entities/purchase-order-item.entity';
import { MaintenanceRequest } from 'src/entities/maintenance-request.entity';
import { MaintenanceQuote } from 'src/entities/maintenance-quote.entity';
import { SupplierContact } from 'src/entities/supplier-contact.entity';
import { Vehicle } from 'src/entities/vehicle.entity';
import { Expense } from 'src/entities/expense.entity';
import { ExpenseCategory } from 'src/entities/expense-category.entity';
import { nextVehicleKms } from '../utils/vehicle-kms.util';
import { NotificationsService } from 'src/notifications/notifications.service';
import { assertTransition, canDelete, canEditItems, PoStatus } from '../utils/po-state.util';
import { DEFAULT_TAX_RATE, itemAmount, round2, totals } from '../utils/money.util';
import { isAuthorizer, MTTO } from '../maintenance.permissions';
import { assertSubsidiaryScope, ScopeUser, userDisplayName } from '../maintenance-scope.util';
import { AuthorizeDto, CompleteDto, UpdatePurchaseOrderDto } from './dto/purchase-order.dto';

/** Categoría de gastos existente (grupo "Vehículos y Operación") donde caen los servicios. */
export const MAINTENANCE_EXPENSE_CATEGORY = 'Mantenimiento';

/** Las notificaciones abren el expediente (la orden vive dentro). */
export const poLink = (po: { requestId: string }) => `/mtto/expediente?id=${po.requestId}`;

/** Órdenes de compra: edición, envío a autorización, autorización exclusiva, rechazo, cancelación y baja. */
@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    @InjectRepository(PurchaseOrder) private readonly orders: Repository<PurchaseOrder>,
    @InjectRepository(SupplierContact) private readonly contacts: Repository<SupplierContact>,
    private readonly dataSource: DataSource,
    private readonly notifier: NotificationsService,
  ) {}

  private listQuery() {
    return this.orders
      .createQueryBuilder('po')
      .leftJoinAndSelect('po.vehicle', 'vehicle')
      .leftJoinAndSelect('po.supplier', 'supplier')
      .leftJoinAndSelect('po.subsidiary', 'subsidiary')
      .leftJoin('po.authorizedBy', 'authorizedBy')
      .addSelect(['authorizedBy.id', 'authorizedBy.name', 'authorizedBy.lastName'])
      .orderBy('po.createdAt', 'DESC');
  }

  listBySubsidiary(subsidiaryId: string, status?: string) {
    const qb = this.listQuery().where('po.subsidiaryId = :subsidiaryId', { subsidiaryId });
    if (status) qb.andWhere('po.status IN (:...status)', { status: status.split(',') });
    return qb.getMany();
  }

  /** Bandeja del autorizador: todas las sucursales. */
  pending() {
    return this.listQuery().where("po.status = 'pendiente'").getMany();
  }

  async findOne(id: string, user?: ScopeUser) {
    const po = await this.orders
      .createQueryBuilder('po')
      .leftJoinAndSelect('po.items', 'item')
      .leftJoinAndSelect('po.supplier', 'supplier')
      .leftJoinAndSelect('supplier.contacts', 'supplierContact')
      .leftJoinAndSelect('po.contact', 'contact')
      .leftJoinAndSelect('po.vehicle', 'vehicle')
      .leftJoinAndSelect('po.subsidiary', 'subsidiary')
      .leftJoinAndSelect('po.request', 'request')
      .leftJoinAndSelect('po.dispatches', 'dispatch')
      .leftJoin('po.authorizedBy', 'authorizedBy')
      .addSelect(['authorizedBy.id', 'authorizedBy.name', 'authorizedBy.lastName'])
      .leftJoin('po.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.name', 'createdBy.lastName'])
      .where('po.id = :id', { id })
      .orderBy('dispatch.sentAt', 'DESC')
      .getOne();
    if (!po) throw new NotFoundException('Orden de compra no encontrada');
    assertSubsidiaryScope(user, po.subsidiaryId);
    return po;
  }

  /** Recalcula importes y totales (solo partidas aprobadas cuentan para el total). */
  private recompute(po: PurchaseOrder) {
    for (const i of po.items) i.amount = itemAmount(i);
    Object.assign(po, totals(po.items, true));
  }

  async update(id: string, dto: UpdatePurchaseOrderDto, user: ScopeUser) {
    const po = await this.findOne(id, user);
    const authorizer = isAuthorizer(user);
    if (!canEditItems(po.status, authorizer)) {
      throw new ForbiddenException(
        po.status === 'pendiente' || po.status === 'autorizada'
          ? 'Solo quien autoriza puede modificar esta orden.'
          : 'La orden ya no se puede modificar.',
      );
    }
    if (dto.supplierId && dto.supplierId !== po.supplierId) {
      po.supplierId = dto.supplierId;
      po.contactId = null;
    }
    if (dto.contactId !== undefined) {
      if (dto.contactId && !(await this.contacts.exist({ where: { id: dto.contactId, supplierId: po.supplierId } }))) {
        throw new BadRequestException('El contacto no pertenece al proveedor de la orden.');
      }
      po.contactId = dto.contactId;
    }
    if (dto.notes !== undefined) po.notes = dto.notes;
    if (dto.items) {
      po.items = dto.items.map((i) => this.orders.manager.create(PurchaseOrderItem, {
        ...(i.id ? { id: i.id } : {}),
        purchaseOrderId: po.id,
        serviceId: i.serviceId ?? null,
        description: i.description.trim(),
        quantity: round2(i.quantity),
        unitPrice: round2(i.unitPrice),
        taxRate: i.taxRate ?? DEFAULT_TAX_RATE,
        approved: i.approved ?? true,
        amount: 0,
      }));
    }
    this.recompute(po);
    if (po.status === 'autorizada' && po.items.every((i) => !i.approved)) {
      throw new BadRequestException('Aprueba al menos una partida.');
    }
    po.updatedAt = new Date();
    // Evita que TypeORM intente re-guardar relaciones cargadas de solo lectura.
    const { supplier: _s, contact: _c, vehicle: _v, subsidiary: _sub, request: _r, dispatches: _d, authorizedBy: _a, createdBy: _cb, ...plain } = po as any;
    await this.orders.save(plain);
    return this.findOne(id, user);
  }

  async submit(id: string, user: ScopeUser) {
    const po = await this.findOne(id, user);
    assertTransition(po.status, 'pendiente');
    if (!po.items.some((i) => i.approved)) throw new BadRequestException('La orden no tiene partidas.');
    await this.orders.update(id, { status: 'pendiente', rejectionReason: null, updatedAt: new Date() });
    await this.notifyAuthorizers(po, user);
    return this.findOne(id, user);
  }

  async authorize(id: string, dto: AuthorizeDto, user: ScopeUser) {
    if (!isAuthorizer(user)) throw new ForbiddenException('No tienes permiso para autorizar órdenes de compra.');
    const po = await this.findOne(id, user);
    assertTransition(po.status, 'autorizada');
    for (const change of dto.items ?? []) {
      const item = po.items.find((i) => i.id === change.id);
      if (!item) continue;
      item.approved = change.approved;
      if (change.quantity !== undefined) item.quantity = round2(change.quantity);
      if (change.unitPrice !== undefined) item.unitPrice = round2(change.unitPrice);
    }
    if (!po.items.some((i) => i.approved)) throw new BadRequestException('Aprueba al menos una partida.');
    this.recompute(po);
    await this.dataSource.transaction(async (m) => {
      await m.save(PurchaseOrderItem, po.items);
      await m.update(PurchaseOrder, id, {
        status: 'autorizada', subtotal: po.subtotal, tax: po.tax, total: po.total,
        authorizedById: user?.userId ?? null, authorizedAt: new Date(), rejectionReason: null, updatedAt: new Date(),
      });
    });
    await this.notifyCreator(po, 'mtto.oc_autorizada', `Orden ${po.folio} autorizada`, 'Ya puedes enviarla al proveedor.', user);
    return this.findOne(id, user);
  }

  /** Rechazo: regresa a borrador con el motivo, para que quien la capturó la corrija. */
  async reject(id: string, reason: string, user: ScopeUser) {
    if (!isAuthorizer(user)) throw new ForbiddenException('No tienes permiso para rechazar órdenes de compra.');
    const po = await this.findOne(id, user);
    assertTransition(po.status, 'rechazada');
    assertTransition('rechazada', 'borrador');
    await this.orders.update(id, { status: 'borrador', rejectionReason: reason.trim(), updatedAt: new Date() });
    await this.notifyCreator(po, 'mtto.oc_rechazada', `Orden ${po.folio} rechazada`, reason.trim(), user);
    return this.findOne(id, user);
  }

  /** Marca cancelada. El aviso al proveedor lo hace PoDispatchService (quien llama decide). */
  async cancel(id: string, reason: string, user: ScopeUser) {
    const po = await this.findOne(id, user);
    assertTransition(po.status, 'cancelada');
    await this.orders.update(id, { status: 'cancelada', cancelReason: reason.trim(), updatedAt: new Date() });
    return { previousStatus: po.status as PoStatus, order: await this.findOne(id, user) };
  }

  /** Baja lógica (solo nunca autorizadas); la solicitud vuelve a cotización. */
  async remove(id: string, user: ScopeUser) {
    const po = await this.findOne(id, user);
    if (!canDelete(po.status)) throw new BadRequestException('Solo se eliminan órdenes en borrador o rechazadas; las demás se cancelan.');
    await this.dataSource.transaction(async (m) => {
      await m.softDelete(PurchaseOrder, id);
      await m.update(MaintenanceQuote, { requestId: po.requestId }, { status: 'capturada' });
      await m.update(MaintenanceRequest, po.requestId, { status: 'en_cotizacion', updatedAt: new Date() });
    });
    return { ok: true };
  }

  /**
   * Cierre: el servicio se realizó. Actualiza la unidad (último mtto fecha/km, km vivo, próximo),
   * cierra la solicitud y registra el Gasto de la sucursal con el monto final.
   */
  async complete(id: string, dto: CompleteDto, user: ScopeUser) {
    const po = await this.findOne(id, user);
    assertTransition(po.status, 'completada');
    const day = dto.completedAt.slice(0, 10);
    const dayInstant = new Date(`${day}T07:00:00.000Z`);
    const amount = round2(dto.finalAmount ?? Number(po.total));

    await this.dataSource.transaction(async (m) => {
      const vehicle = await m.findOne(Vehicle, { where: { id: po.vehicleId } });
      const vehiclePatch: Partial<Vehicle> = { lastMaintenanceDate: dayInstant, lastMaintenanceKms: dto.completedKms };
      const kms = nextVehicleKms(vehicle?.kms, dto.completedKms);
      if (kms.changed) vehiclePatch.kms = kms.kms!;
      if (dto.nextMaintenanceDate !== undefined) {
        vehiclePatch.nextMaintenanceDate = dto.nextMaintenanceDate ? new Date(`${dto.nextMaintenanceDate.slice(0, 10)}T07:00:00.000Z`) : (null as any);
      }
      await m.update(Vehicle, po.vehicleId, vehiclePatch);

      let category = await m.findOne(ExpenseCategory, { where: { name: MAINTENANCE_EXPENSE_CATEGORY } });
      if (!category) category = await m.save(ExpenseCategory, m.create(ExpenseCategory, { name: MAINTENANCE_EXPENSE_CATEGORY, active: true }));
      const unit = po.vehicle?.name || po.vehicle?.code || po.vehicle?.plateNumber || 'unidad';
      const expense = await m.save(Expense, m.create(Expense, {
        subsidiaryId: po.subsidiaryId,
        categoryId: category.id,
        vehicleId: po.vehicleId,
        date: day,
        amount,
        description: `Mantenimiento ${unit} — ${po.folio} (${po.supplier?.name ?? 'proveedor'})`.slice(0, 255),
        responsible: userDisplayName(user),
        notes: 'Generado desde orden de compra de mantenimiento',
        createdById: user?.userId ?? undefined,
      }));

      await m.update(PurchaseOrder, id, {
        status: 'completada', completedAt: dayInstant, completedKms: dto.completedKms, finalAmount: amount,
        expenseId: expense.id, updatedAt: new Date(),
      });
      await m.update(MaintenanceRequest, po.requestId, { status: 'completada', updatedAt: new Date() });
    });
    return this.findOne(id, user);
  }

  // ---------------- Notificaciones ----------------

  private async authorizerIds(): Promise<string[]> {
    const rows: Array<{ userId: string }> = await this.dataSource.query(
      `SELECT up.userId FROM user_permission up
       JOIN permission p ON p.id = up.permissionId
       WHERE p.code = ? AND up.effect = 'allow'`,
      [MTTO.autorizar],
    );
    return rows.map((r) => r.userId);
  }

  private async notifyAuthorizers(po: PurchaseOrder, user: ScopeUser) {
    try {
      const ids = await this.authorizerIds();
      await this.notifier.emit({
        type: 'mtto.oc_por_autorizar',
        audience: ids.length ? { userIds: ids } : { role: 'superadmin' },
        title: `Orden por autorizar: ${po.folio}`,
        body: `${po.vehicle?.name || po.vehicle?.plateNumber || 'Unidad'} · ${po.supplier?.name ?? ''} · $${Number(po.total).toFixed(2)}`,
        link: poLink(po),
        entityId: po.id,
        subsidiaryId: po.subsidiaryId,
        actor: { id: user?.userId, name: userDisplayName(user) },
      });
    } catch (e: any) {
      this.logger.warn(`no se pudo notificar la OC ${po.folio}: ${e?.message}`);
    }
  }

  private async notifyCreator(po: PurchaseOrder, type: string, title: string, body: string, user: ScopeUser) {
    if (!po.createdById) return;
    try {
      await this.notifier.emit({
        type, audience: { userId: po.createdById }, title, body, link: poLink(po), entityId: po.id,
        subsidiaryId: po.subsidiaryId, actor: { id: user?.userId, name: userDisplayName(user) },
      });
    } catch (e: any) {
      this.logger.warn(`no se pudo notificar al creador de ${po.folio}: ${e?.message}`);
    }
  }
}
