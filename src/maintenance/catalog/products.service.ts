import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UnitOfMeasure } from 'src/entities/unit-of-measure.entity';
import { ProductCategory, ProductKind } from 'src/entities/product-category.entity';
import { Product } from 'src/entities/product.entity';
import { ProductOffer } from 'src/entities/product-offer.entity';
import { cleanKeywords } from '../utils/needs.util';
import { OfferDto, ProductCategoryDto, ProductDto, UnitDto } from './dto/products.dto';

export interface ProductQuery {
  q?: string;
  kind?: ProductKind;
  categoryId?: string;
  includeInactive?: boolean;
}

/** Evita dos precios del mismo proveedor para la misma presentación en un producto. */
export function assertUniqueOffers(offers: OfferDto[]): void {
  const seen = new Set<string>();
  for (const o of offers) {
    const key = `${o.supplierId}|${o.unitId ?? ''}`;
    if (seen.has(key)) throw new BadRequestException('Hay un proveedor repetido con la misma presentación; deja solo un precio por proveedor y presentación.');
    seen.add(key);
  }
}

/** Catálogos de Compras: presentaciones, categorías (piezas/insumos/servicios/equipo) y productos con precios por proveedor. */
@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(UnitOfMeasure) private readonly units: Repository<UnitOfMeasure>,
    @InjectRepository(ProductCategory) private readonly categories: Repository<ProductCategory>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(ProductOffer) private readonly offers: Repository<ProductOffer>,
  ) {}

  // ---------------- Presentaciones ----------------
  listUnits() {
    return this.units.find({ order: { name: 'ASC' } });
  }

  async saveUnit(dto: UnitDto, id?: string) {
    const name = dto.name.trim();
    const dup = await this.units.createQueryBuilder('u').where('LOWER(u.name) = :n', { n: name.toLowerCase() }).getOne();
    if (dup && dup.id !== id) throw new ConflictException(`Ya existe la presentación "${name}"`);
    const entity = id ? await this.units.findOne({ where: { id } }) : this.units.create();
    if (!entity) throw new NotFoundException('Presentación no encontrada');
    Object.assign(entity, { name, abbreviation: dto.abbreviation?.trim() || null, active: dto.active ?? entity.active ?? true });
    return this.units.save(entity);
  }

  // ---------------- Categorías (piezas, insumos, servicios, equipo) ----------------
  listCategories(kind?: ProductKind) {
    return this.categories.find({ where: kind ? { kind } : {}, order: { kind: 'ASC', sortOrder: 'ASC', name: 'ASC' } });
  }

  async saveCategory(dto: ProductCategoryDto, id?: string) {
    const name = dto.name.trim();
    const dup = await this.categories.createQueryBuilder('c')
      .where('c.kind = :kind AND LOWER(c.name) = :n', { kind: dto.kind, n: name.toLowerCase() }).getOne();
    if (dup && dup.id !== id) throw new ConflictException(`Ya existe "${name}" en el catálogo`);
    const entity = id ? await this.categories.findOne({ where: { id } }) : this.categories.create();
    if (!entity) throw new NotFoundException('No se encontró el registro');
    Object.assign(entity, {
      name,
      kind: dto.kind,
      keywords: dto.keywords === undefined ? entity.keywords ?? null : cleanKeywords(dto.keywords),
      sortOrder: dto.sortOrder ?? entity.sortOrder ?? 999,
      active: dto.active ?? entity.active ?? true,
    });
    return this.categories.save(entity);
  }

  // ---------------- Productos ----------------
  list(query: ProductQuery = {}) {
    const qb = this.products.createQueryBuilder('p')
      .leftJoinAndSelect('p.category', 'category')
      .leftJoinAndSelect('p.unit', 'unit')
      .leftJoinAndSelect('p.offers', 'offer')
      .leftJoinAndSelect('offer.supplier', 'supplier')
      .leftJoinAndSelect('offer.unit', 'offerUnit');
    if (!query.includeInactive) qb.andWhere('p.active = 1');
    if (query.kind) qb.andWhere('category.kind = :kind', { kind: query.kind });
    if (query.categoryId) qb.andWhere('p.categoryId = :categoryId', { categoryId: query.categoryId });
    if (query.q) qb.andWhere('(p.name LIKE :q OR p.partNumber LIKE :q OR p.brand LIKE :q)', { q: `%${query.q}%` });
    return qb.orderBy('p.name', 'ASC').addOrderBy('offer.price', 'ASC').getMany();
  }

  async findOne(id: string) {
    const p = await this.products.findOne({ where: { id }, relations: ['category', 'unit', 'offers', 'offers.supplier', 'offers.unit'] });
    if (!p) throw new NotFoundException('Producto no encontrado');
    return p;
  }

  async save(dto: ProductDto, id?: string) {
    if (dto.offers) assertUniqueOffers(dto.offers);
    const entity = id ? await this.findOne(id) : this.products.create();
    Object.assign(entity, {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      categoryId: dto.categoryId ?? null,
      brand: dto.brand?.trim() || null,
      partNumber: dto.partNumber?.trim() || null,
      unitId: dto.unitId ?? null,
      active: dto.active ?? entity.active ?? true,
      ...(id ? { updatedAt: new Date() } : {}),
    });
    if (dto.offers) {
      const prev = new Map((entity.offers ?? []).map((o) => [o.id, o]));
      entity.offers = dto.offers.map((o) => {
        const before = o.id ? prev.get(o.id) : undefined;
        const priceChanged = !before || Number(before.price) !== Number(o.price);
        return this.offers.create({
          ...(o.id ? { id: o.id } : {}),
          productId: entity.id,
          supplierId: o.supplierId,
          unitId: o.unitId ?? null,
          price: o.price,
          quality: o.quality ?? null,
          lastQuotedAt: priceChanged ? new Date() : before?.lastQuotedAt ?? null,
          updatedAt: new Date(),
        });
      });
    }
    const saved = await this.products.save(entity);
    return this.findOne(saved.id);
  }

  async remove(id: string) {
    const res = await this.products.softDelete(id);
    if (!res.affected) throw new NotFoundException('Producto no encontrado');
    return { ok: true };
  }
}
