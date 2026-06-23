import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CatalogItem } from 'src/entities';
import { CATALOG_DEFS, CATALOG_USAGE } from './catalog-definition';
import { CreateCatalogItemDto, UpdateCatalogItemDto } from './dto/catalog.dto';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(CatalogItem) private readonly repo: Repository<CatalogItem>,
    private readonly dataSource: DataSource,
  ) {}

  /** Todos los catálogos agrupados por type (para la UI). */
  async getAll() {
    const items = await this.repo.find({ order: { type: 'ASC', sortOrder: 'ASC' } });
    const groups = CATALOG_DEFS.map((d) => ({
      type: d.type,
      label: d.label,
      items: items.filter((i) => i.type === d.type),
    }));
    return { groups };
  }

  getByType(type: string) {
    return this.repo.find({ where: { type }, order: { sortOrder: 'ASC' } });
  }

  /** Solo valores ACTIVOS, para alimentar dropdowns de la app. */
  getOptions(type: string) {
    return this.repo.find({ where: { type, active: true }, order: { sortOrder: 'ASC' } });
  }

  async create(dto: CreateCatalogItemDto) {
    if (!CATALOG_DEFS.some((d) => d.type === dto.type)) {
      throw new BadRequestException('Tipo de catálogo desconocido.');
    }
    const key = dto.key.trim();
    if (!key) throw new BadRequestException('La clave es obligatoria.');
    const exists = await this.repo.findOne({ where: { type: dto.type, key } });
    if (exists) throw new ConflictException('Ya existe ese valor en el catálogo.');

    const last = await this.repo.find({ where: { type: dto.type }, order: { sortOrder: 'DESC' }, take: 1 });
    const item = this.repo.create({
      type: dto.type,
      key,
      label: dto.label,
      sortOrder: dto.sortOrder ?? ((last[0]?.sortOrder ?? -1) + 1),
      active: true,
      isSystem: false,
    });
    return this.repo.save(item);
  }

  async update(id: string, dto: UpdateCatalogItemDto) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Valor no encontrado.');
    // NO se permite cambiar `key`/`type`/`isSystem` (contratos del código).
    if (dto.label !== undefined) item.label = dto.label;
    if (dto.sortOrder !== undefined) item.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) item.active = dto.active;
    return this.repo.save(item);
  }

  /** Cuenta referencias en BD del valor (para el aviso/guard de borrado). */
  private async countUsage(type: string, key: string) {
    const maps = CATALOG_USAGE[type] || [];
    const out: { table: string; column: string; count: number }[] = [];
    for (const m of maps) {
      try {
        const rows = await this.dataSource.query(
          `SELECT COUNT(*) AS c FROM \`${m.table}\` WHERE \`${m.column}\` = ?`,
          [key],
        );
        const c = Number(rows?.[0]?.c ?? 0);
        if (c > 0) out.push({ table: m.table, column: m.column, count: c });
      } catch {
        // Si la tabla/columna no existe, se ignora (no bloquea por algo inexistente).
      }
    }
    return out;
  }

  async usage(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Valor no encontrado.');
    return { item, usedIn: await this.countUsage(item.type, item.key) };
  }

  /**
   * Borrado BLINDADO: los valores del sistema no se eliminan (el código depende de
   * la key); los del usuario solo si NO están en uso en la BD.
   */
  async remove(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Valor no encontrado.');
    if (item.isSystem) {
      throw new ConflictException('Es un valor del sistema: el código depende de él, no se puede eliminar. Puedes desactivarlo.');
    }
    const used = await this.countUsage(item.type, item.key);
    if (used.length) {
      const detail = used.map((u) => `${u.count} en ${u.table}`).join(', ');
      throw new ConflictException(`No se puede eliminar: el valor está en uso (${detail}). Desactívalo en su lugar.`);
    }
    await this.repo.remove(item);
    return { deleted: true };
  }
}
