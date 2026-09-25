import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { MaintenanceRequest } from 'src/entities/maintenance-request.entity';
import { MaintenanceQuote } from 'src/entities/maintenance-quote.entity';
import { MaintenanceQuoteItem } from 'src/entities/maintenance-quote-item.entity';
import { ProductCategory } from 'src/entities/product-category.entity';
import { ProductOffer } from 'src/entities/product-offer.entity';
import { Product } from 'src/entities/product.entity';
import { Supplier } from 'src/entities/supplier.entity';
import { RequestNeed } from 'src/entities/request-need.entity';
import { ServiceTemplate } from 'src/entities/service-template.entity';
import { VehicleSpecItem } from 'src/entities/vehicle-spec-item.entity';
import { ScopeUser } from '../maintenance-scope.util';
import { isAuthorizer, isPurchaser } from '../maintenance.permissions';
import { lineTaxes, totals } from '../utils/money.util';
import { buildNeeds, NeedDraft, RecipeService } from '../utils/needs.util';
import { OfferCandidate, RankedOffer, rankOffers } from '../utils/rank-offers.util';
import { QuotesService } from './quotes.service';

export class AddNeedDto {
  @IsUUID('all', { message: 'Elige la pieza o insumo' })
  categoryId: string;

  @IsNumber({}, { message: 'La cantidad debe ser un número' }) @Min(0.01, { message: 'La cantidad debe ser mayor a 0' })
  quantity: number;

  @IsOptional() @ValidateIf((o) => o.unitId !== null) @IsUUID('all', { message: 'Presentación no válida' })
  unitId?: string | null;
}

export class PickOfferDto {
  @IsUUID('all', { message: 'Sugerencia no reconocida' })
  offerId: string;
}

export class CaptureNeedPriceDto {
  @IsUUID('all', { message: 'Elige el proveedor' })
  supplierId: string;

  @IsString({ message: 'Escribe qué producto te cotizó' })
  @MinLength(2, { message: 'Escribe qué producto te cotizó' })
  @MaxLength(200, { message: 'El nombre es demasiado largo' })
  description: string;

  @IsOptional() @ValidateIf((o) => o.brand !== null) @IsString() @MaxLength(80, { message: 'La marca es demasiado larga' })
  brand?: string | null;

  @IsNumber({}, { message: 'El precio debe ser un número' }) @Min(0, { message: 'El precio no puede ser negativo' })
  unitPrice: number;

  @IsOptional() @ValidateIf((o) => o.quality !== null) @IsInt() @Min(1, { message: 'La calidad va de 1 a 5 estrellas' }) @Max(5, { message: 'La calidad va de 1 a 5 estrellas' })
  quality?: number | null;
}

export class SaveToCatalogDto {
  @IsArray() @ArrayMinSize(1, { message: 'Elige al menos un concepto' }) @IsUUID('all', { each: true, message: 'Concepto no reconocido' })
  quoteItemIds: string[];
}

export interface NeedView {
  id: string;
  category: { id: string; name: string; kind: string };
  product: { id: string; name: string; brand: string | null } | null;
  quantity: number;
  unit: { id: string; name: string; abbreviation: string | null } | null;
  source: string;
  sourceLabel: string;
  suggestions: RankedOffer[];
  inQuote: { quoteId: string; quoteItemId: string; supplierId: string; supplierName: string; offerProductId: string | null } | null;
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Hermosillo' });
const CATALOG_NOTE = 'Armada desde el catálogo: confirma precio y existencia con el proveedor.';

/** "Lo que se necesita" de una solicitud, sus 4 sugerencias y armar la cotización con un clic. */
@Injectable()
export class NeedsService {
  constructor(
    @InjectRepository(RequestNeed) private readonly needs: Repository<RequestNeed>,
    @InjectRepository(MaintenanceRequest) private readonly requests: Repository<MaintenanceRequest>,
    private readonly quotes: QuotesService,
    private readonly dataSource: DataSource,
  ) {}

  private assertCanSee(user: ScopeUser) {
    if (!isPurchaser(user) && !isAuthorizer(user)) throw new ForbiddenException('Solo Compras ve lo que se necesita.');
  }

  private assertPurchaser(user: ScopeUser) {
    if (!isPurchaser(user)) throw new ForbiddenException('Solo Compras arma las cotizaciones.');
  }

  private async loadRequest(id: string) {
    const r = await this.requests.findOne({
      where: { id },
      relations: ['items', 'services', 'services.serviceTemplate', 'services.serviceTemplate.items'],
    });
    if (!r) throw new NotFoundException('Solicitud no encontrada');
    return r;
  }

  // ---------------- Generar ----------------

  /** Calcula las necesidades (receta de servicios + palabras clave + ficha de la unidad). */
  private async draft(r: MaintenanceRequest): Promise<NeedDraft[]> {
    const toRecipe = (s: ServiceTemplate): RecipeService => ({
      id: s.id, name: s.name, keywords: s.keywords,
      items: [...(s.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => ({ categoryId: i.categoryId, quantity: Number(i.quantity), unitId: i.unitId })),
    });
    const chosen = [...(r.services ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map((x) => x.serviceTemplate).filter(Boolean).map(toRecipe);
    const catalog = (await this.dataSource.getRepository(ServiceTemplate).find({ where: { active: true }, relations: ['items'] })).map(toRecipe);
    const categories = await this.dataSource.getRepository(ProductCategory).find({ where: { active: true, kind: In(['pieza', 'insumo']) } });
    const spec = r.vehicleId ? await this.dataSource.getRepository(VehicleSpecItem).find({ where: { vehicleId: r.vehicleId } }) : [];
    const text = [r.description, ...(r.items ?? []).map((i) => i.description)].filter(Boolean).join('. ');
    return buildNeeds({
      chosen, text, serviceCatalog: catalog,
      categories: categories.map((c) => ({ id: c.id, name: c.name, keywords: c.keywords })),
      spec: spec.map((s) => ({ categoryId: s.categoryId, productId: s.productId, quantity: Number(s.quantity), unitId: s.unitId })),
    });
  }

  private async generate(r: MaintenanceRequest, skipCategoryIds: Set<string> = new Set()) {
    const drafts = (await this.draft(r)).filter((d) => !skipCategoryIds.has(d.categoryId));
    if (!drafts.length) return;
    const base = skipCategoryIds.size;
    await this.needs.save(drafts.map((d, idx) => this.needs.create({ ...d, requestId: r.id, sortOrder: base + idx })));
  }

  // ---------------- Consultar ----------------

  async list(requestId: string, user: ScopeUser): Promise<{ needs: NeedView[] }> {
    this.assertCanSee(user);
    const r = await this.loadRequest(requestId);
    if ((await this.needs.count({ where: { requestId } })) === 0 && !['por_revisar', 'rechazada', 'cancelada'].includes(r.status)) {
      await this.generate(r);
    }
    const list = await this.needs.find({
      where: { requestId, dismissed: false }, relations: ['category', 'product', 'unit'], order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    if (!list.length) return { needs: [] };

    const candidates = await this.candidates(list.map((n) => n.categoryId));
    const quoteItems: Array<{ id: string; quoteId: string; requestNeedId: string; productId: string | null; supplierId: string; supplierName: string }> = await this.dataSource.query(
      `SELECT qi.id, qi.quoteId, qi.requestNeedId, qi.productId, q.supplierId, s.name AS supplierName
         FROM maintenance_quote_item qi
         JOIN maintenance_quote q ON q.id = qi.quoteId AND q.deletedAt IS NULL
         JOIN supplier s ON s.id = q.supplierId
        WHERE q.requestId = ? AND qi.requestNeedId IS NOT NULL`,
      [requestId],
    );

    return {
      needs: list.map((n) => {
        const qi = quoteItems.find((x) => x.requestNeedId === n.id);
        return {
          id: n.id,
          category: { id: n.category?.id ?? n.categoryId, name: n.category?.name ?? 'Pieza/insumo', kind: n.category?.kind ?? 'pieza' },
          product: n.product ? { id: n.product.id, name: n.product.name, brand: n.product.brand } : null,
          quantity: Number(n.quantity),
          unit: n.unit ? { id: n.unit.id, name: n.unit.name, abbreviation: n.unit.abbreviation } : null,
          source: n.source,
          sourceLabel: n.sourceLabel,
          suggestions: rankOffers(candidates.get(n.categoryId) ?? [], { preferredProductId: n.productId }),
          inQuote: qi ? { quoteId: qi.quoteId, quoteItemId: qi.id, supplierId: qi.supplierId, supplierName: qi.supplierName, offerProductId: qi.productId } : null,
        };
      }),
    };
  }

  /** Ofertas del catálogo por categoría, con cuántas veces se le ha comprado ese producto a ese proveedor. */
  private async candidates(categoryIds: string[]): Promise<Map<string, OfferCandidate[]>> {
    const map = new Map<string, OfferCandidate[]>();
    const ids = [...new Set(categoryIds)];
    if (!ids.length) return map;
    const offers = await this.dataSource.getRepository(ProductOffer).createQueryBuilder('o')
      .innerJoinAndSelect('o.product', 'p', 'p.active = 1 AND p.deletedAt IS NULL')
      .innerJoinAndSelect('o.supplier', 's', 's.active = 1')
      .leftJoinAndSelect('o.unit', 'u')
      .where('p.categoryId IN (:...ids)', { ids })
      .getMany();
    const bought: Array<{ productId: string; supplierId: string; n: string }> = offers.length
      ? await this.dataSource.query(
        `SELECT poi.productId, po.supplierId, COUNT(*) AS n
           FROM purchase_order_item poi
           JOIN purchase_order po ON po.id = poi.purchaseOrderId AND po.deletedAt IS NULL
          WHERE po.status IN ('enviada','completada') AND poi.productId IN (${[...new Set(offers.map((o) => o.productId))].map(() => '?').join(',')})
          GROUP BY poi.productId, po.supplierId`,
        [...new Set(offers.map((o) => o.productId))],
      )
      : [];
    for (const o of offers) {
      const catId = o.product.categoryId!;
      const list = map.get(catId) ?? [];
      list.push({
        offerId: o.id, productId: o.productId, productName: o.product.name, brand: o.product.brand ?? null,
        supplierId: o.supplierId, supplierName: o.supplier.name, unitName: o.unit?.abbreviation || o.unit?.name || null,
        price: Number(o.price), quality: o.quality ?? null,
        purchases: Number(bought.find((b) => b.productId === o.productId && b.supplierId === o.supplierId)?.n ?? 0),
      });
      map.set(catId, list);
    }
    return map;
  }

  // ---------------- Editar la lista ----------------

  async add(requestId: string, dto: AddNeedDto, user: ScopeUser) {
    this.assertPurchaser(user);
    await this.quotes.loadQuotable(requestId, user);
    const cat = await this.dataSource.getRepository(ProductCategory).findOne({ where: { id: dto.categoryId } });
    if (!cat || (cat.kind !== 'pieza' && cat.kind !== 'insumo')) throw new BadRequestException('Elige una pieza o insumo del catálogo.');
    const existing = await this.needs.findOne({ where: { requestId, categoryId: dto.categoryId } });
    if (existing && !existing.dismissed) throw new BadRequestException(`"${cat.name}" ya está en la lista.`);
    if (existing) {
      await this.needs.update(existing.id, { dismissed: false, quantity: dto.quantity, unitId: dto.unitId ?? existing.unitId });
    } else {
      const count = await this.needs.count({ where: { requestId } });
      await this.needs.save(this.needs.create({
        requestId, categoryId: dto.categoryId, quantity: Math.round(Number(dto.quantity) * 100) / 100, unitId: dto.unitId ?? null,
        source: 'manual', sourceLabel: 'Agregada por Compras', sortOrder: count,
      }));
    }
    return this.list(requestId, user);
  }

  /** Quitar de la lista: también sale de las cotizaciones donde estaba. */
  async dismiss(needId: string, user: ScopeUser) {
    this.assertPurchaser(user);
    const n = await this.needs.findOne({ where: { id: needId } });
    if (!n) throw new NotFoundException('No se encontró ese renglón');
    await this.quotes.loadQuotable(n.requestId, user);
    await this.dataSource.transaction(async (m) => {
      await this.removeFromQuotes(m, n.requestId, n.id);
      await m.update(RequestNeed, n.id, { dismissed: true, selectedQuoteItemId: null });
    });
    return { ok: true };
  }

  /** Vuelve a calcular: se conservan las agregadas a mano y las que ya están en alguna cotización. */
  async recalculate(requestId: string, user: ScopeUser) {
    this.assertPurchaser(user);
    await this.quotes.loadQuotable(requestId, user);
    const r = await this.loadRequest(requestId);
    const current = await this.needs.find({ where: { requestId } });
    const quoted: Array<{ requestNeedId: string }> = await this.dataSource.query(
      `SELECT DISTINCT qi.requestNeedId FROM maintenance_quote_item qi JOIN maintenance_quote q ON q.id = qi.quoteId AND q.deletedAt IS NULL
        WHERE q.requestId = ? AND qi.requestNeedId IS NOT NULL`, [requestId],
    );
    const keep = new Set(quoted.map((x) => x.requestNeedId));
    const drop = current.filter((n) => n.source !== 'manual' && !keep.has(n.id));
    if (drop.length) await this.needs.delete({ id: In(drop.map((n) => n.id)) });
    await this.generate(r, new Set(current.filter((n) => !drop.includes(n)).map((n) => n.categoryId)));
    return this.list(requestId, user);
  }

  // ---------------- Elegir sugerencia ----------------

  /**
   * Pone la pieza/insumo en la cotización del proveedor de la oferta (la crea si no existe, marcada
   * "precio del catálogo") y la quita de cualquier otra cotización de la solicitud.
   */
  async pick(needId: string, dto: PickOfferDto, user: ScopeUser) {
    this.assertPurchaser(user);
    const { n, request } = await this.loadNeedQuotable(needId, user);
    const offer = await this.dataSource.getRepository(ProductOffer).findOne({ where: { id: dto.offerId }, relations: ['product', 'supplier'] });
    if (!offer) throw new BadRequestException('Esa sugerencia ya no existe; vuelve a cargar la pantalla.');
    if (offer.product?.categoryId !== n.categoryId) throw new BadRequestException('Ese producto no corresponde a esta pieza o insumo.');
    const quoteId = await this.placeInQuote(n, request, offer.supplierId, {
      productId: offer.productId,
      description: [offer.product.name, offer.product.brand].filter(Boolean).join(' · '),
      unitPrice: Number(offer.price),
      quality: offer.quality ?? null,
    }, true, user);
    return { quoteId };
  }

  /**
   * "Capturar precio": lo que dijo el proveedor para esta pieza/insumo, sin que exista en el catálogo.
   * Entra a la cotización de ese proveedor; al generar órdenes se pregunta si se guarda en el catálogo.
   */
  async captureManual(needId: string, dto: CaptureNeedPriceDto, user: ScopeUser) {
    this.assertPurchaser(user);
    const { n, request } = await this.loadNeedQuotable(needId, user);
    if (!(await this.dataSource.getRepository(Supplier).exist({ where: { id: dto.supplierId } }))) {
      throw new BadRequestException('El proveedor no existe.');
    }
    const quoteId = await this.placeInQuote(n, request, dto.supplierId, {
      productId: null,
      description: [dto.description.trim(), dto.brand?.trim()].filter(Boolean).join(' · '),
      unitPrice: Math.round(Number(dto.unitPrice) * 100) / 100,
      quality: dto.quality ?? null,
    }, false, user);
    return { quoteId };
  }

  private async loadNeedQuotable(needId: string, user: ScopeUser) {
    const n = await this.needs.findOne({ where: { id: needId } });
    if (!n || n.dismissed) throw new NotFoundException('No se encontró ese renglón');
    const request = await this.quotes.loadQuotable(n.requestId, user);
    return { n, request };
  }

  /** Pone la necesidad en la cotización del proveedor (la crea si no existe) y la quita de las demás. */
  private async placeInQuote(
    n: RequestNeed,
    request: MaintenanceRequest,
    supplierId: string,
    p: { productId: string | null; description: string; unitPrice: number; quality: number | null },
    fromCatalog: boolean,
    user: ScopeUser,
  ) {
    return this.dataSource.transaction(async (m) => {
      await this.removeFromQuotes(m, n.requestId, n.id);
      let quote = await m.findOne(MaintenanceQuote, { where: { requestId: n.requestId, supplierId } });
      if (!quote) {
        quote = await m.save(MaintenanceQuote, m.create(MaintenanceQuote, {
          requestId: n.requestId, supplierId, quoteDate: today(), validUntil: null, notes: fromCatalog ? CATALOG_NOTE : null,
          subtotal: 0, ieps: 0, tax: 0, total: 0, status: 'capturada', fromCatalog, createdById: user?.userId ?? null, items: [],
        }));
      }
      const item = {
        requestItemId: null, requestNeedId: n.id, productId: p.productId, serviceId: null, description: p.description.slice(0, 300),
        quantity: Number(n.quantity), unitPrice: p.unitPrice, availability: 'si' as const, leadTimeDays: null,
        ivaEnabled: true, iepsEnabled: false, iepsRate: 0, taxRate: 0.16, quality: p.quality, referencePrice: null, deviationPct: null,
      };
      await m.save(MaintenanceQuoteItem, m.create(MaintenanceQuoteItem, { ...item, quoteId: quote.id, amount: lineTaxes(item).amount }));
      await this.recomputeTotals(m, quote.id);
      if (request.status === 'abierta') await m.update(MaintenanceRequest, n.requestId, { status: 'en_cotizacion', updatedAt: new Date() });
      return quote.id;
    });
  }

  // ---------------- Guardar en el catálogo ----------------

  /**
   * Conceptos cotizados que no están en el catálogo pero sí se sabe de qué pieza/insumo son (vienen de
   * "Lo que se necesita" o de un renglón con categoría). Se ofrecen para guardar al generar órdenes.
   */
  async uncataloged(requestId: string, user: ScopeUser) {
    this.assertPurchaser(user);
    const rows: Array<{ quoteItemId: string; description: string; unitPrice: string; quality: number | null; supplierId: string; supplierName: string; categoryId: string; categoryName: string }> =
      await this.dataSource.query(
        `SELECT qi.id AS quoteItemId, qi.description, qi.unitPrice, qi.quality, q.supplierId, s.name AS supplierName,
                COALESCE(rn.categoryId, ri.categoryId) AS categoryId, c.name AS categoryName
           FROM maintenance_quote_item qi
           JOIN maintenance_quote q ON q.id = qi.quoteId AND q.deletedAt IS NULL
           JOIN supplier s ON s.id = q.supplierId
           LEFT JOIN request_need rn ON rn.id = qi.requestNeedId
           LEFT JOIN request_item ri ON ri.id = qi.requestItemId
           JOIN product_category c ON c.id = COALESCE(rn.categoryId, ri.categoryId)
          WHERE q.requestId = ? AND qi.productId IS NULL
          ORDER BY c.name, s.name`,
        [requestId],
      );
    return rows.map((r) => ({ ...r, unitPrice: Number(r.unitPrice) }));
  }

  /**
   * Guarda en el catálogo los conceptos elegidos: producto dentro de su pieza/insumo ("Nombre · Marca") y el
   * precio/calidad de ese proveedor. Si ya existe un producto con ese nombre en la categoría, se reutiliza.
   */
  async saveToCatalog(requestId: string, dto: SaveToCatalogDto, user: ScopeUser) {
    const candidates = await this.uncataloged(requestId, user);
    const chosen = candidates.filter((c) => dto.quoteItemIds.includes(c.quoteItemId));
    if (!chosen.length) return { saved: 0 };
    await this.dataSource.transaction(async (m) => {
      for (const c of chosen) {
        const [rawName, ...brandParts] = c.description.split(' · ');
        const name = rawName.trim().slice(0, 200);
        const brand = brandParts.join(' · ').trim() || null;
        let product = await m.createQueryBuilder(Product, 'p')
          .where('p.categoryId = :cat AND LOWER(p.name) = :n AND p.deletedAt IS NULL', { cat: c.categoryId, n: name.toLowerCase() })
          .getOne();
        if (!product) {
          product = await m.save(Product, m.create(Product, { name, brand, categoryId: c.categoryId, active: true }));
        }
        const offer = await m.findOne(ProductOffer, { where: { productId: product.id, supplierId: c.supplierId } });
        const patch = { price: c.unitPrice, lastQuotedAt: new Date(), updatedAt: new Date(), ...(c.quality ? { quality: c.quality } : {}) };
        if (offer) await m.update(ProductOffer, offer.id, patch);
        else await m.save(ProductOffer, m.create(ProductOffer, { productId: product.id, supplierId: c.supplierId, unitId: null, quality: c.quality ?? null, ...patch }));
        await m.update(MaintenanceQuoteItem, c.quoteItemId, { productId: product.id });
      }
    });
    return { saved: chosen.length };
  }

  /** Quita las partidas de esta necesidad de las cotizaciones; si una cotización del catálogo queda vacía, se borra. */
  private async removeFromQuotes(m: EntityManager, requestId: string, needId: string) {
    const items = await m.createQueryBuilder(MaintenanceQuoteItem, 'qi')
      .innerJoin('qi.quote', 'q', 'q.requestId = :requestId AND q.deletedAt IS NULL', { requestId })
      .where('qi.requestNeedId = :needId', { needId })
      .getMany();
    if (!items.length) return;
    await this.quotes.clearSelections(m, items.map((i) => i.id));
    await m.delete(MaintenanceQuoteItem, { id: In(items.map((i) => i.id)) });
    for (const quoteId of new Set(items.map((i) => i.quoteId))) {
      const left = await m.count(MaintenanceQuoteItem, { where: { quoteId } });
      const q = await m.findOne(MaintenanceQuote, { where: { id: quoteId } });
      if (!left && q?.fromCatalog) await m.softDelete(MaintenanceQuote, quoteId);
      else await this.recomputeTotals(m, quoteId);
    }
  }

  private async recomputeTotals(m: EntityManager, quoteId: string) {
    const items = await m.find(MaintenanceQuoteItem, { where: { quoteId } });
    const t = totals(items.map((i) => ({
      quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), ivaEnabled: i.ivaEnabled, iepsEnabled: i.iepsEnabled, iepsRate: Number(i.iepsRate ?? 0), taxRate: Number(i.taxRate),
    })));
    await m.update(MaintenanceQuote, quoteId, { subtotal: t.subtotal, ieps: t.ieps, tax: t.tax, total: t.total, updatedAt: new Date() });
  }
}
