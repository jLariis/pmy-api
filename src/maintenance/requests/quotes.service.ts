import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { MaintenanceQuote } from 'src/entities/maintenance-quote.entity';
import { MaintenanceQuoteItem } from 'src/entities/maintenance-quote-item.entity';
import { MaintenanceRequest } from 'src/entities/maintenance-request.entity';
import { ProductOffer } from 'src/entities/product-offer.entity';
import { Product } from 'src/entities/product.entity';
import { RequestItem } from 'src/entities/request-item.entity';
import { RequestNeed } from 'src/entities/request-need.entity';
import { Supplier } from 'src/entities/supplier.entity';
import { PurchaseOrder } from 'src/entities/purchase-order.entity';
import { ScopeUser } from '../maintenance-scope.util';
import { isPurchaser } from '../maintenance.permissions';
import { RequestsService } from './requests.service';
import { QuoteDto } from './dto/request.dto';
import { buildQuoteItems, BuiltQuoteItem } from './quote-items.util';

export const QUOTE_ATTACHMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const QUOTE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Cotizaciones de una solicitud (una por proveedor, con partidas por renglón) y su archivo adjunto. */
@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    @InjectRepository(MaintenanceQuote) private readonly quotes: Repository<MaintenanceQuote>,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    @InjectRepository(ProductOffer) private readonly offers: Repository<ProductOffer>,
    private readonly requests: RequestsService,
    private readonly dataSource: DataSource,
  ) {}

  /** Mejor precio conocido por producto (referencia para la desviación). */
  private async referencePrices(productIds: Array<string | null | undefined>) {
    const ids = [...new Set(productIds.filter(Boolean))] as string[];
    const map = new Map<string, number>();
    if (!ids.length) return map;
    const rows: Array<{ productId: string; price: string }> = await this.dataSource.query(
      `SELECT productId, MIN(price) AS price FROM product_offer WHERE productId IN (${ids.map(() => '?').join(',')}) AND price > 0 GROUP BY productId`,
      ids,
    );
    for (const r of rows) map.set(r.productId, Number(r.price));
    return map;
  }

  /** Solo Compras cotiza, con la solicitud autorizada y sin órdenes generadas. */
  async loadQuotable(requestId: string, user: ScopeUser) {
    if (!isPurchaser(user)) throw new ForbiddenException('Solo Compras captura cotizaciones.');
    const r = await this.dataSource.getRepository(MaintenanceRequest).findOne({ where: { id: requestId } });
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    if (r.status === 'por_revisar') throw new BadRequestException('Primero autoriza la solicitud para poder cotizar.');
    if (!['abierta', 'en_cotizacion'].includes(r.status)) throw new BadRequestException('La solicitud ya no está en cotización.');
    if (await this.dataSource.getRepository(PurchaseOrder).exist({ where: { requestId } })) {
      throw new BadRequestException('Ya se generaron órdenes; para cambiar cotizaciones primero elimina o cancela las órdenes.');
    }
    return r;
  }

  private async assertSupplier(id: string) {
    if (!(await this.suppliers.exist({ where: { id } }))) throw new BadRequestException('El proveedor no existe');
  }

  /** Actualiza el catálogo: precio y calidad de cada producto con este proveedor (y su presentación). */
  private async upsertOffers(m: EntityManager, supplierId: string, items: BuiltQuoteItem[]) {
    const withProduct = items.filter((i) => i.productId);
    if (!withProduct.length) return;
    const reqItemIds = withProduct.map((i) => i.requestItemId).filter(Boolean) as string[];
    const reqItems = reqItemIds.length ? await m.find(RequestItem, { where: { id: In(reqItemIds) }, select: ['id', 'unitId'] }) : [];
    const products = await m.find(Product, { where: { id: In(withProduct.map((i) => i.productId!)) }, select: ['id', 'unitId'] });
    for (const i of withProduct) {
      const unitId = reqItems.find((r) => r.id === i.requestItemId)?.unitId ?? products.find((p) => p.id === i.productId)?.unitId ?? null;
      const existing = await m.createQueryBuilder(ProductOffer, 'o')
        .where('o.productId = :p AND o.supplierId = :s AND o.unitId <=> :u', { p: i.productId, s: supplierId, u: unitId })
        .getOne();
      const patch = { price: i.unitPrice, lastQuotedAt: new Date(), updatedAt: new Date(), ...(i.quality ? { quality: i.quality } : {}) };
      if (existing) await m.update(ProductOffer, existing.id, patch);
      else await m.save(ProductOffer, m.create(ProductOffer, { productId: i.productId!, supplierId, unitId, quality: i.quality ?? null, ...patch }));
    }
  }

  async create(requestId: string, dto: QuoteDto, user: ScopeUser) {
    const request = await this.loadQuotable(requestId, user);
    await this.assertSupplier(dto.supplierId);
    const built = buildQuoteItems(dto.items, await this.referencePrices(dto.items.map((i) => i.productId)));
    return this.dataSource.transaction(async (m) => {
      const quote = await m.save(MaintenanceQuote, m.create(MaintenanceQuote, {
        requestId,
        supplierId: dto.supplierId,
        quoteDate: dto.quoteDate.slice(0, 10),
        validUntil: dto.validUntil?.slice(0, 10) ?? null,
        notes: dto.notes ?? null,
        subtotal: built.subtotal,
        ieps: built.ieps,
        tax: built.tax,
        total: built.total,
        status: 'capturada',
        createdById: user?.userId ?? null,
        items: built.items.map((i) => m.create(MaintenanceQuoteItem, i)),
      }));
      await this.upsertOffers(m, dto.supplierId, built.items);
      if (request.status === 'abierta') await m.update(MaintenanceRequest, requestId, { status: 'en_cotizacion', updatedAt: new Date() });
      return quote;
    });
  }

  async update(quoteId: string, dto: QuoteDto, user: ScopeUser) {
    const quote = await this.quotes.findOne({ where: { id: quoteId }, relations: ['items'] });
    if (!quote) throw new NotFoundException('Cotización no encontrada');
    await this.loadQuotable(quote.requestId, user);
    await this.assertSupplier(dto.supplierId);
    const built = buildQuoteItems(dto.items, await this.referencePrices(dto.items.map((i) => i.productId)));
    return this.dataSource.transaction(async (m) => {
      Object.assign(quote, {
        supplierId: dto.supplierId,
        quoteDate: dto.quoteDate.slice(0, 10),
        validUntil: dto.validUntil?.slice(0, 10) ?? null,
        notes: dto.notes ?? null,
        subtotal: built.subtotal,
        ieps: built.ieps,
        tax: built.tax,
        total: built.total,
        updatedAt: new Date(),
      });
      // Las elecciones del comparativo que apuntaban a partidas de esta cotización se limpian (las partidas cambian).
      const oldIds = quote.items.map((i) => i.id);
      await this.clearSelections(m, oldIds);
      // Capturada/revisada a mano: ya no es "precio del catálogo por confirmar".
      quote.fromCatalog = false;
      quote.items = built.items.map((i) => m.create(MaintenanceQuoteItem, { ...i, quoteId }));
      const saved = await m.save(MaintenanceQuote, quote);
      await this.upsertOffers(m, dto.supplierId, built.items);
      return saved;
    });
  }

  async remove(quoteId: string, user: ScopeUser) {
    const quote = await this.quotes.findOne({ where: { id: quoteId }, relations: ['items'] });
    if (!quote) throw new NotFoundException('Cotización no encontrada');
    const request = await this.loadQuotable(quote.requestId, user);
    await this.dataSource.transaction(async (m) => {
      await this.clearSelections(m, quote.items.map((i) => i.id));
      await m.softDelete(MaintenanceQuote, quoteId);
      const remaining = await m.count(MaintenanceQuote, { where: { requestId: request.id } });
      if (remaining === 0 && request.status === 'en_cotizacion') await m.update(MaintenanceRequest, request.id, { status: 'abierta', updatedAt: new Date() });
    });
    return { ok: true };
  }

  /** Quita las elecciones del comparativo (renglones y necesidades) que apuntaban a estas partidas. */
  async clearSelections(m: EntityManager, quoteItemIds: string[]) {
    if (!quoteItemIds.length) return;
    await m.update(RequestItem, { selectedQuoteItemId: In(quoteItemIds) }, { selectedQuoteItemId: null });
    await m.update(RequestNeed, { selectedQuoteItemId: In(quoteItemIds) }, { selectedQuoteItemId: null });
  }

  async findQuote(id: string) {
    const q = await this.quotes.findOne({ where: { id } });
    if (!q) throw new NotFoundException('Cotización no encontrada');
    return q;
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
    await this.loadQuotable(quote.requestId, user);

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
}
