import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ServiceTemplate } from 'src/entities/service-template.entity';
import { ServiceTemplateItem } from 'src/entities/service-template-item.entity';
import { ProductCategory } from 'src/entities/product-category.entity';
import { RequestSelectedService } from 'src/entities/request-service.entity';
import { cleanKeywords } from '../utils/needs.util';
import { ServiceTemplateDto } from './dto/service-templates.dto';

/** Catálogo de servicios predefinidos de mantenimiento (con receta opcional de piezas/insumos). */
@Injectable()
export class ServiceTemplatesService {
  constructor(
    @InjectRepository(ServiceTemplate) private readonly templates: Repository<ServiceTemplate>,
    private readonly dataSource: DataSource,
  ) {}

  list(includeInactive = false) {
    const qb = this.templates.createQueryBuilder('s')
      .leftJoinAndSelect('s.items', 'item')
      .leftJoinAndSelect('item.category', 'category')
      .leftJoinAndSelect('item.unit', 'unit')
      .orderBy('s.name', 'ASC')
      .addOrderBy('item.sortOrder', 'ASC');
    if (!includeInactive) qb.where('s.active = 1');
    return qb.getMany();
  }

  async findOne(id: string) {
    const s = await this.templates.findOne({ where: { id }, relations: ['items', 'items.category', 'items.unit'] });
    if (!s) throw new NotFoundException('No se encontró el servicio');
    return s;
  }

  async save(dto: ServiceTemplateDto, id?: string) {
    const name = dto.name.trim();
    const dup = await this.templates.createQueryBuilder('s').where('LOWER(s.name) = :n', { n: name.toLowerCase() }).getOne();
    if (dup && dup.id !== id) throw new ConflictException(`Ya existe un servicio llamado "${name}"`);

    const items = dto.items ?? [];
    const catIds = [...new Set(items.map((i) => i.categoryId))];
    if (catIds.length !== items.length) throw new BadRequestException('Una pieza o insumo está repetido en la receta.');
    if (catIds.length) {
      const cats = await this.dataSource.getRepository(ProductCategory).find({ where: { id: In(catIds) } });
      if (cats.length !== catIds.length) throw new BadRequestException('Una pieza o insumo de la receta ya no existe.');
      const wrong = cats.find((c) => c.kind !== 'pieza' && c.kind !== 'insumo');
      if (wrong) throw new BadRequestException(`"${wrong.name}" no es pieza ni insumo; la receta solo lleva piezas e insumos.`);
    }

    return this.dataSource.transaction(async (m) => {
      const entity = id ? await m.findOne(ServiceTemplate, { where: { id } }) : m.create(ServiceTemplate);
      if (!entity) throw new NotFoundException('No se encontró el servicio');
      Object.assign(entity, {
        name,
        description: dto.description?.trim() || null,
        vehicleType: dto.vehicleType?.trim() || null,
        keywords: cleanKeywords(dto.keywords),
        active: dto.active ?? entity.active ?? true,
        updatedAt: id ? new Date() : null,
      });
      const saved = await m.save(ServiceTemplate, entity);
      if (id) await m.delete(ServiceTemplateItem, { serviceTemplateId: saved.id });
      if (items.length) {
        await m.save(ServiceTemplateItem, items.map((i, idx) => m.create(ServiceTemplateItem, {
          serviceTemplateId: saved.id, categoryId: i.categoryId, quantity: Math.round(Number(i.quantity) * 100) / 100,
          unitId: i.unitId ?? null, sortOrder: idx,
        })));
      }
      return saved;
    }).then((s) => this.findOne(s.id));
  }

  /** Si ya se usó en alguna solicitud solo se desactiva (para no perder el historial); si no, se borra. */
  async remove(id: string) {
    await this.findOne(id);
    const used = await this.dataSource.getRepository(RequestSelectedService).exist({ where: { serviceTemplateId: id } });
    if (used) {
      await this.templates.update(id, { active: false, updatedAt: new Date() });
      return { ok: true, deactivated: true };
    }
    await this.dataSource.transaction(async (m) => {
      await m.delete(ServiceTemplateItem, { serviceTemplateId: id });
      await m.delete(ServiceTemplate, id);
    });
    return { ok: true, deactivated: false };
  }
}
