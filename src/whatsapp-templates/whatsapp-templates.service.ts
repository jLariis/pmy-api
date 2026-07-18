import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappTemplate } from 'src/entities';

@Injectable()
export class WhatsappTemplatesService {
  constructor(
    @InjectRepository(WhatsappTemplate) private readonly repo: Repository<WhatsappTemplate>,
  ) {}

  list() {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  getByKey(key: string) {
    return this.repo.findOne({ where: { key } });
  }

  create(dto: Partial<WhatsappTemplate>) {
    return this.repo.save(this.repo.create({ ...dto, updatedAt: new Date() }));
  }

  async update(id: string, dto: Partial<WhatsappTemplate>) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Plantilla no encontrada.');
    const { id: _omit, ...rest } = dto as any;
    Object.assign(row, rest);
    row.updatedAt = new Date();
    return this.repo.save(row);
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
