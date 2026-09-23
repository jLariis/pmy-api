import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from 'src/entities/supplier.entity';
import { SupplierContact } from 'src/entities/supplier-contact.entity';
import { SupplierDto } from './dto/supplier.dto';
import { normalizeContacts } from './supplier-contacts.util';

/** Proveedores de mantenimiento con sus contactos y medio predeterminado. */
@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
    @InjectRepository(SupplierContact) private readonly contacts: Repository<SupplierContact>,
  ) {}

  list(q?: string, includeInactive = false) {
    const qb = this.suppliers.createQueryBuilder('s').leftJoinAndSelect('s.contacts', 'contact');
    if (!includeInactive) qb.andWhere('s.active = 1');
    if (q) qb.andWhere('(s.name LIKE :q OR s.rfc LIKE :q)', { q: `%${q}%` });
    return qb.orderBy('s.name', 'ASC').addOrderBy('contact.isDefault', 'DESC').getMany();
  }

  async findOne(id: string) {
    const s = await this.suppliers.findOne({ where: { id }, relations: ['contacts'] });
    if (!s) throw new NotFoundException('Proveedor no encontrado');
    return s;
  }

  async create(dto: SupplierDto) {
    const contacts = normalizeContacts(dto.contacts);
    const entity = this.suppliers.create({
      name: dto.name.trim(), rfc: dto.rfc?.trim().toUpperCase() || null, address: dto.address ?? null,
      notes: dto.notes ?? null, active: dto.active ?? true,
      contacts: contacts.map(({ id: _id, ...c }) => this.contacts.create(c)),
    });
    return this.suppliers.save(entity);
  }

  /** Reemplaza la lista de contactos: los que no vienen se eliminan (orphanedRowAction). */
  async update(id: string, dto: SupplierDto) {
    const s = await this.findOne(id);
    const contacts = normalizeContacts(dto.contacts);
    Object.assign(s, {
      name: dto.name.trim(), rfc: dto.rfc?.trim().toUpperCase() || null, address: dto.address ?? null,
      notes: dto.notes ?? null, active: dto.active ?? s.active, updatedAt: new Date(),
    });
    s.contacts = contacts.map((c) => this.contacts.create({ ...c, supplierId: s.id }));
    return this.suppliers.save(s);
  }

  async remove(id: string) {
    const res = await this.suppliers.softDelete(id);
    if (!res.affected) throw new NotFoundException('Proveedor no encontrado');
    return { ok: true };
  }
}
