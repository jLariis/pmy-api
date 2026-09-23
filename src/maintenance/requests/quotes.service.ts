import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { MaintenanceQuote } from 'src/entities/maintenance-quote.entity';
import { MaintenanceQuoteItem } from 'src/entities/maintenance-quote-item.entity';
import { MaintenanceRequest } from 'src/entities/maintenance-request.entity';
import { MaintenanceService } from 'src/entities/maintenance-service.entity';
import { PurchaseOrder } from 'src/entities/purchase-order.entity';
import { PurchaseOrderItem } from 'src/entities/purchase-order-item.entity';
import { Supplier } from 'src/entities/supplier.entity';
import { FolioService } from '../folio.service';
import { ScopeUser } from '../maintenance-scope.util';
import { totals } from '../utils/money.util';
import { RequestsService } from './requests.service';
import { QuoteDto } from './dto/request.dto';
import { buildQuoteItems } from './quote-items.util';

export const QUOTE_ATTACHMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const QUOTE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Cotizaciones de una solicitud, su adjunto y la conversión de la ganadora en orden de compra. */
@Injectable()
export class QuotesService {
  constructor(
    @InjectRepository(MaintenanceQuote) private readonly quotes: Repository<MaintenanceQuote>,
    @InjectRepository(MaintenanceService) private readonly services: Repository<MaintenanceService>,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    private readonly requests: RequestsService,
    private readonly dataSource: DataSource,
    private readonly folios: FolioService,
  ) {}

  private async referencePrices(serviceIds: Array<string | null | undefined>) {
    const ids = [...new Set(serviceIds.filter(Boolean))] as string[];
    const map = new Map<string, number>();
    if (!ids.length) return map;
    const list = await this.services.find({ where: { id: In(ids) }, withDeleted: true, select: ['id', 'referencePrice'] });
    for (const s of list) map.set(s.id, Number(s.referencePrice));
    return map;
  }

  private async assertSupplier(id: string) {
    if (!(await this.suppliers.exist({ where: { id } }))) throw new BadRequestException('El proveedor no existe');
  }

  async create(requestId: string, dto: QuoteDto, user: ScopeUser) {
    const request = await this.requests.loadEditable(requestId, user);
    await this.assertSupplier(dto.supplierId);
    const built = buildQuoteItems(dto.items, await this.referencePrices(dto.items.map((i) => i.serviceId)));
    return this.dataSource.transaction(async (m) => {
      const quote = await m.save(MaintenanceQuote, m.create(MaintenanceQuote, {
        requestId,
        supplierId: dto.supplierId,
        quoteDate: dto.quoteDate.slice(0, 10),
        validUntil: dto.validUntil?.slice(0, 10) ?? null,
        notes: dto.notes ?? null,
        subtotal: built.subtotal,
        tax: built.tax,
        total: built.total,
        status: 'capturada',
        createdById: user?.userId ?? null,
        items: built.items.map((i) => m.create(MaintenanceQuoteItem, i)),
      }));
      if (request.status === 'abierta') await m.update(MaintenanceRequest, requestId, { status: 'en_cotizacion', updatedAt: new Date() });
      return quote;
    });
  }

  async update(quoteId: string, dto: QuoteDto, user: ScopeUser) {
    const quote = await this.quotes.findOne({ where: { id: quoteId }, relations: ['items'] });
    if (!quote) throw new NotFoundException('Cotización no encontrada');
    await this.requests.loadEditable(quote.requestId, user);
    await this.assertSupplier(dto.supplierId);
    const built = buildQuoteItems(dto.items, await this.referencePrices(dto.items.map((i) => i.serviceId)));
    Object.assign(quote, {
      supplierId: dto.supplierId,
      quoteDate: dto.quoteDate.slice(0, 10),
      validUntil: dto.validUntil?.slice(0, 10) ?? null,
      notes: dto.notes ?? null,
      subtotal: built.subtotal,
      tax: built.tax,
      total: built.total,
      updatedAt: new Date(),
    });
    quote.items = built.items.map((i) => this.quotes.manager.create(MaintenanceQuoteItem, { ...i, quoteId }));
    return this.quotes.save(quote);
  }

  async remove(quoteId: string, user: ScopeUser) {
    const quote = await this.quotes.findOne({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException('Cotización no encontrada');
    const request = await this.requests.loadEditable(quote.requestId, user);
    await this.quotes.softDelete(quoteId);
    const remaining = await this.quotes.count({ where: { requestId: request.id } });
    if (remaining === 0 && request.status === 'en_cotizacion') {
      await this.dataSource.getRepository(MaintenanceRequest).update(request.id, { status: 'abierta', updatedAt: new Date() });
    }
    return { ok: true };
  }

  // ---------------- Adjunto (PDF/foto original del proveedor) ----------------

  private relDir(quoteId: string) {
    return join('uploads', 'maintenance', 'quotes', quoteId);
  }

  async saveAttachment(quoteId: string, file: Express.Multer.File | undefined, user: ScopeUser) {
    if (!file) throw new BadRequestException('No se recibió archivo');
    if (!QUOTE_ATTACHMENT_MIMES.includes(file.mimetype)) throw new BadRequestException('Solo se aceptan PDF o imágenes (JPG, PNG, WEBP).');
    if (file.size > QUOTE_ATTACHMENT_MAX_BYTES) throw new BadRequestException('El archivo excede 10 MB.');
    const quote = await this.quotes.findOne({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException('Cotización no encontrada');
    await this.requests.loadEditable(quote.requestId, user);

    const safeName = file.originalname.replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]+/g, '_').slice(0, 150) || 'cotizacion';
    const dir = this.relDir(quoteId);
    await fs.rm(join(process.cwd(), dir), { recursive: true, force: true });
    await fs.mkdir(join(process.cwd(), dir), { recursive: true });
    const rel = join(dir, safeName);
    await fs.writeFile(join(process.cwd(), rel), file.buffer);
    await this.quotes.update(quoteId, { attachmentPath: rel, attachmentName: safeName, attachmentMime: file.mimetype, updatedAt: new Date() });
    return { ok: true, attachmentName: safeName };
  }

  async readAttachment(quoteId: string, user: ScopeUser) {
    const quote = await this.quotes.findOne({ where: { id: quoteId }, withDeleted: true });
    if (!quote?.attachmentPath) throw new NotFoundException('La cotización no tiene archivo adjunto');
    await this.requests.findOne(quote.requestId, user);
    const buffer = await fs.readFile(join(process.cwd(), quote.attachmentPath)).catch(() => {
      throw new NotFoundException('No se encontró el archivo en el servidor');
    });
    return { buffer, name: quote.attachmentName ?? 'cotizacion', mime: quote.attachmentMime ?? 'application/octet-stream' };
  }

  // ---------------- Convertir ganadora → orden de compra ----------------

  async convert(quoteId: string, user: ScopeUser) {
    const quote = await this.quotes.findOne({ where: { id: quoteId }, relations: ['items', 'supplier', 'supplier.contacts'] });
    if (!quote) throw new NotFoundException('Cotización no encontrada');
    const request = await this.requests.findOne(quote.requestId, user);
    if (request.purchaseOrder) throw new ConflictException(`La solicitud ya tiene la orden ${request.purchaseOrder.folio}.`);
    if (request.status === 'cancelada' || request.status === 'completada') throw new BadRequestException('La solicitud ya está cerrada.');

    const contact = quote.supplier?.contacts?.find((c) => c.isDefault) ?? quote.supplier?.contacts?.[0] ?? null;
    const items = quote.items.map((i) => ({
      serviceId: i.serviceId, description: i.description, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice),
      taxRate: Number(i.taxRate), amount: Number(i.amount), approved: true,
    }));
    const t = totals(items, true);

    return this.dataSource.transaction(async (m) => {
      const folio = await this.folios.next(m, 'OC');
      const po = await m.save(PurchaseOrder, m.create(PurchaseOrder, {
        folio,
        requestId: request.id,
        quoteId: quote.id,
        supplierId: quote.supplierId,
        contactId: contact?.id ?? null,
        vehicleId: request.vehicleId,
        subsidiaryId: request.subsidiaryId,
        status: 'borrador',
        notes: quote.notes ?? null,
        ...t,
        createdById: user?.userId ?? null,
        items: items.map((i) => m.create(PurchaseOrderItem, i)),
      }));
      await m.update(MaintenanceQuote, { id: quote.id }, { status: 'ganadora' });
      await m.update(MaintenanceQuote, { requestId: request.id, id: Not(quote.id) }, { status: 'descartada' });
      await m.update(MaintenanceRequest, request.id, { status: 'orden_generada', updatedAt: new Date() });
      return po;
    });
  }
}
