import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expense, ExpenseCategory, ExpenseCategoryGroup } from 'src/entities';
import {
  CreateExpenseCategoryDto, UpdateExpenseCategoryDto,
  CreateExpenseGroupDto, UpdateExpenseGroupDto,
} from './dto/expense-category.dto';

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    @InjectRepository(ExpenseCategory) private readonly catRepo: Repository<ExpenseCategory>,
    @InjectRepository(ExpenseCategoryGroup) private readonly groupRepo: Repository<ExpenseCategoryGroup>,
    @InjectRepository(Expense) private readonly expenseRepo: Repository<Expense>,
  ) {}

  /** Payload agrupado para el formulario de gastos. */
  async getGrouped(includeInactive = false) {
    const groups = await this.groupRepo.find({ order: { sortOrder: 'ASC' } });
    const cats = await this.catRepo.find({ order: { sortOrder: 'ASC' } });
    const visible = (x: { active: boolean }) => includeInactive || x.active;
    return groups.filter(visible).map((g) => ({
      group: { id: g.id, name: g.name, icon: g.icon, sortOrder: g.sortOrder, isSystem: g.isSystem, active: g.active },
      categories: cats
        .filter((c) => c.groupId === g.id && visible(c))
        .map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder, isSystem: c.isSystem, active: c.active })),
    }));
  }

  // --- Categorías ---
  async createCategory(dto: CreateExpenseCategoryDto) {
    const item = this.catRepo.create({
      name: dto.name,
      groupId: dto.groupId,
      sortOrder: dto.sortOrder ?? 0,
      description: dto.description,
      isSystem: false,
      active: true,
    });
    return this.catRepo.save(item);
  }

  async updateCategory(id: string, dto: UpdateExpenseCategoryDto) {
    const item = await this.catRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Categoría no encontrada.');
    if (dto.name !== undefined) item.name = dto.name;
    if (dto.groupId !== undefined) item.groupId = dto.groupId;
    if (dto.sortOrder !== undefined) item.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) item.active = dto.active;
    if (dto.description !== undefined) item.description = dto.description;
    return this.catRepo.save(item);
  }

  async removeCategory(id: string) {
    const item = await this.catRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Categoría no encontrada.');
    if (item.isSystem) {
      throw new ConflictException('Es una categoría del sistema: no se puede eliminar. Puedes desactivarla.');
    }
    const inUse = await this.expenseRepo.count({ where: { categoryId: id } });
    if (inUse > 0) {
      throw new ConflictException(`No se puede eliminar: ${inUse} gasto(s) usan esta categoría. Desactívala en su lugar.`);
    }
    await this.catRepo.remove(item);
    return { deleted: true };
  }

  // --- Grupos ---
  listGroups() {
    return this.groupRepo.find({ order: { sortOrder: 'ASC' } });
  }

  async createGroup(dto: CreateExpenseGroupDto) {
    const g = this.groupRepo.create({
      name: dto.name, icon: dto.icon, sortOrder: dto.sortOrder ?? 0, isSystem: false, active: true,
    });
    return this.groupRepo.save(g);
  }

  async updateGroup(id: string, dto: UpdateExpenseGroupDto) {
    const g = await this.groupRepo.findOne({ where: { id } });
    if (!g) throw new NotFoundException('Grupo no encontrado.');
    if (dto.name !== undefined) g.name = dto.name;
    if (dto.icon !== undefined) g.icon = dto.icon;
    if (dto.sortOrder !== undefined) g.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) g.active = dto.active;
    return this.groupRepo.save(g);
  }

  async removeGroup(id: string) {
    const g = await this.groupRepo.findOne({ where: { id } });
    if (!g) throw new NotFoundException('Grupo no encontrado.');
    if (g.isSystem) {
      throw new ConflictException('Es un grupo del sistema: no se puede eliminar. Puedes desactivarlo.');
    }
    const count = await this.catRepo.count({ where: { groupId: id } });
    if (count > 0) {
      throw new ConflictException(`No se puede eliminar: el grupo tiene ${count} categoría(s). Reasígnalas primero.`);
    }
    await this.groupRepo.remove(g);
    return { deleted: true };
  }
}
