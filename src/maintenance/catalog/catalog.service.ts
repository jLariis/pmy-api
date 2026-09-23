import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { MaintenanceServiceCategory } from 'src/entities/maintenance-service-category.entity';
import { MaintenanceService } from 'src/entities/maintenance-service.entity';
import { CategoryDto, ServiceDto, UpdateCategoryDto, UpdateServiceDto } from './dto/catalog.dto';

export interface ServiceQuery {
  categoryId?: string;
  vehicleType?: string;
  q?: string;
  includeInactive?: boolean;
}

/** Catálogo de mantenimiento: categorías y servicios con precio de referencia. */
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(MaintenanceServiceCategory) private readonly categories: Repository<MaintenanceServiceCategory>,
    @InjectRepository(MaintenanceService) private readonly services: Repository<MaintenanceService>,
  ) {}

  listCategories() {
    return this.categories.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  async createCategory(dto: CategoryDto) {
    await this.assertCategoryNameFree(dto.name);
    return this.categories.save(this.categories.create({ name: dto.name.trim(), sortOrder: dto.sortOrder ?? 99, active: dto.active ?? true }));
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const cat = await this.categories.findOne({ where: { id } });
    if (!cat) throw new NotFoundException('Categoría no encontrada');
    if (dto.name && dto.name.trim().toLowerCase() !== cat.name.toLowerCase()) await this.assertCategoryNameFree(dto.name, id);
    Object.assign(cat, { ...dto, ...(dto.name ? { name: dto.name.trim() } : {}) });
    return this.categories.save(cat);
  }

  private async assertCategoryNameFree(name: string, exceptId?: string) {
    const found = await this.categories
      .createQueryBuilder('c')
      .where('LOWER(c.name) = :n', { n: name.trim().toLowerCase() })
      .getOne();
    if (found && found.id !== exceptId) throw new ConflictException(`Ya existe la categoría "${name.trim()}"`);
  }

  listServices(query: ServiceQuery = {}) {
    const qb = this.services.createQueryBuilder('s').leftJoinAndSelect('s.category', 'category');
    if (!query.includeInactive) qb.andWhere('s.active = 1');
    if (query.categoryId) qb.andWhere('s.categoryId = :categoryId', { categoryId: query.categoryId });
    if (query.vehicleType) {
      qb.andWhere(new Brackets((w) => w.where('s.vehicleType IS NULL').orWhere('s.vehicleType = :vt', { vt: query.vehicleType })));
    }
    if (query.q) qb.andWhere('s.name LIKE :q', { q: `%${query.q}%` });
    return qb.orderBy('category.sortOrder', 'ASC').addOrderBy('s.name', 'ASC').getMany();
  }

  async createService(dto: ServiceDto) {
    await this.assertCategory(dto.categoryId);
    return this.services.save(this.services.create({ ...dto, name: dto.name.trim(), vehicleType: dto.vehicleType ?? null }));
  }

  async updateService(id: string, dto: UpdateServiceDto) {
    const svc = await this.services.findOne({ where: { id } });
    if (!svc) throw new NotFoundException('Servicio no encontrado');
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    Object.assign(svc, dto, { updatedAt: new Date() });
    return this.services.save(svc);
  }

  async removeService(id: string) {
    const res = await this.services.softDelete(id);
    if (!res.affected) throw new NotFoundException('Servicio no encontrado');
    return { ok: true };
  }

  private async assertCategory(id: string) {
    if (!(await this.categories.exist({ where: { id } }))) throw new BadRequestException('La categoría no existe');
  }
}
