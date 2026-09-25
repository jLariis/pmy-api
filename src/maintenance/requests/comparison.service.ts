import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsUUID, ValidateIf, ValidateNested } from 'class-validator';
import { MaintenanceRequest } from 'src/entities/maintenance-request.entity';
import { MaintenanceQuote } from 'src/entities/maintenance-quote.entity';
import { PurchaseOrder } from 'src/entities/purchase-order.entity';
import { PurchaseOrderItem } from 'src/entities/purchase-order-item.entity';
import { RequestItem } from 'src/entities/request-item.entity';
import { RequestNeed } from 'src/entities/request-need.entity';
import { FolioService } from '../folio.service';
import { ScopeUser } from '../maintenance-scope.util';
import { isPurchaser } from '../maintenance.permissions';
import { totals } from '../utils/money.util';
import { compareByItem, Comparison, CmpQuote, groupSelectionBySupplier } from '../utils/comparison.util';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { RequestsService } from './requests.service';

export class SelectionItemDto {
  @IsUUID('all', { message: 'Renglón no reconocido' })
  requestItemId: string;

  /** null = este renglón no se compra. */
  @IsOptional() @ValidateIf((o) => o.quoteItemId !== null) @IsUUID('all', { message: 'Partida no reconocida' })
  quoteItemId: string | null;
}

export class SelectionDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SelectionItemDto)
  selections: SelectionItemDto[];
}

/** Comparativo por partida y generación de órdenes (una por proveedor ganador). */
@Injectable()
export class ComparisonService {
  constructor(
    @InjectRepository(MaintenanceRequest) private readonly requests: Repository<MaintenanceRequest>,
    @InjectRepository(MaintenanceQuote) private readonly quotes: Repository<MaintenanceQuote>,
    private readonly dataSource: DataSource,
    private readonly folios: FolioService,
    private readonly orders: PurchaseOrdersService,
    private readonly requestsService: RequestsService,
  ) {}

  private async load(requestId: string) {
    const r = await this.requests.findOne({ where: { id: requestId }, relations: ['items', 'items.unit'] });
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    const quotes = await this.quotes.find({ where: { requestId }, relations: ['items', 'supplier', 'supplier.contacts'], order: { total: 'ASC' } });
    const cmpQuotes: CmpQuote[] = quotes.map((q) => ({ id: q.id, supplierId: q.supplierId, supplierName: q.supplier?.name ?? 'Proveedor', items: q.items as any }));
    const items = [...(r.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const needs = await this.dataSource.getRepository(RequestNeed).find({
      where: { requestId, dismissed: false }, relations: ['category', 'unit'], order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    // Filas: renglones de la solicitud + "Lo que se necesita" (necesidades no descartadas).
    const rows = [
      ...items.map((i) => ({ id: i.id, kind: 'item' as const, description: i.description, productId: i.productId, quantity: i.quantity, selectedQuoteItemId: i.selectedQuoteItemId })),
      ...needs.map((n) => ({ id: n.id, kind: 'need' as const, description: n.category?.name ?? 'Pieza/insumo', productId: n.productId, quantity: n.quantity, selectedQuoteItemId: n.selectedQuoteItemId })),
    ];
    const units: Record<string, string | null> = Object.fromEntries([
      ...items.map((i) => [i.id, i.unit?.abbreviation ?? i.unit?.name ?? null]),
      ...needs.map((n) => [n.id, n.unit?.abbreviation ?? n.unit?.name ?? null]),
    ]);
    return { request: r, items, needs, units, quotes, cmpQuotes, comparison: compareByItem(rows, cmpQuotes) };
  }

  async get(requestId: string, user: ScopeUser): Promise<Comparison & { units: Record<string, string | null> }> {
    await this.requestsService.findOne(requestId, user); // valida acceso
    const { units, comparison } = await this.load(requestId);
    return { ...comparison, units };
  }

  async saveSelection(requestId: string, dto: SelectionDto, user: ScopeUser) {
    if (!isPurchaser(user)) throw new ForbiddenException('Solo Compras elige proveedores.');
    const { items, needs, quotes } = await this.load(requestId);
    const validQuoteItems = new Set(quotes.flatMap((q) => q.items.map((i) => i.id)));
    await this.dataSource.transaction(async (m) => {
      for (const s of dto.selections) {
        const isItem = items.some((i) => i.id === s.requestItemId);
        const isNeed = needs.some((n) => n.id === s.requestItemId);
        if (!isItem && !isNeed) throw new BadRequestException('Renglón no pertenece a la solicitud.');
        if (s.quoteItemId && !validQuoteItems.has(s.quoteItemId)) throw new BadRequestException('Esa partida no es de una cotización de esta solicitud.');
        await m.update(isItem ? RequestItem : RequestNeed, s.requestItemId, { selectedQuoteItemId: s.quoteItemId });
      }
    });
    return this.get(requestId, user);
  }

  /**
   * Genera una orden por proveedor con los renglones elegidos (o, si no se eligió, la propuesta del
   * comparativo) y las manda a autorización. `onlyQuoteId`: usar solo esa cotización para todo lo que cubre.
   */
  async generateOrders(requestId: string, user: ScopeUser, onlyQuoteId?: string) {
    if (!isPurchaser(user)) throw new ForbiddenException('Solo Compras genera órdenes.');
    const { request, quotes, cmpQuotes, comparison } = await this.load(requestId);
    if (!['abierta', 'en_cotizacion'].includes(request.status)) throw new BadRequestException('La solicitud no está en cotización.');
    if (await this.dataSource.getRepository(PurchaseOrder).exist({ where: { requestId, status: Not('cancelada') } })) {
      throw new BadRequestException('Esta solicitud ya tiene órdenes generadas.');
    }
    if (onlyQuoteId) {
      for (const r of comparison.rows) r.selectedQuoteItemId = r.cells[onlyQuoteId]?.quoteItemId ?? null;
    }
    const groups = groupSelectionBySupplier(comparison, cmpQuotes);
    if (!groups.length) throw new BadRequestException('Elige al menos un proveedor en el comparativo.');

    const created = await this.dataSource.transaction(async (m) => {
      const out: PurchaseOrder[] = [];
      for (const g of groups) {
        const quote = quotes.find((q) => q.id === g.quoteId)!;
        const chosen = quote.items.filter((i) => g.quoteItemIds.includes(i.id));
        const items = chosen.map((i) => m.create(PurchaseOrderItem, {
          requestItemId: i.requestItemId ?? null, productId: i.productId ?? null, serviceId: null, description: i.description,
          quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), ivaEnabled: i.ivaEnabled, iepsEnabled: i.iepsEnabled,
          iepsRate: Number(i.iepsRate ?? 0), taxRate: i.ivaEnabled ? 0.16 : 0, amount: Number(i.amount), approved: true,
        }));
        const t = totals(items, true);
        const contact = quote.supplier?.contacts?.find((c) => c.isDefault) ?? quote.supplier?.contacts?.[0] ?? null;
        const folio = await this.folios.next(m, 'OC');
        out.push(await m.save(PurchaseOrder, m.create(PurchaseOrder, {
          folio, requestId, quoteId: quote.id, supplierId: quote.supplierId, contactId: contact?.id ?? null,
          vehicleId: request.vehicleId, subsidiaryId: request.subsidiaryId, status: 'borrador', notes: quote.notes ?? null,
          ...t, createdById: user?.userId ?? null, items,
        })));
        // Deja constancia de lo elegido (si fue la propuesta automática).
        for (const qi of chosen) {
          if (qi.requestItemId) await m.update(RequestItem, qi.requestItemId, { selectedQuoteItemId: qi.id });
          if (qi.requestNeedId) await m.update(RequestNeed, qi.requestNeedId, { selectedQuoteItemId: qi.id });
        }
      }
      const winners = groups.map((g) => g.quoteId);
      await m.update(MaintenanceQuote, { requestId, id: In(winners) }, { status: 'ganadora' });
      await m.update(MaintenanceQuote, { requestId, id: Not(In(winners)) }, { status: 'descartada' });
      await m.update(MaintenanceRequest, requestId, { status: 'orden_generada', updatedAt: new Date() });
      return out;
    });

    for (const po of created) await this.orders.submit(po.id, user); // cada orden a autorización (avisa a Edgardo)
    return created.map((p) => ({ id: p.id, folio: p.folio, supplierId: p.supplierId, total: p.total }));
  }
}
