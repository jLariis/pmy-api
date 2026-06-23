import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanySettings } from 'src/entities';

@Injectable()
export class CompanySettingsService {
  constructor(
    @InjectRepository(CompanySettings)
    private readonly repo: Repository<CompanySettings>,
  ) {}

  /** Singleton: devuelve la fila o crea una vacía la primera vez. */
  async get(): Promise<CompanySettings> {
    let row = await this.repo.findOne({ where: {}, order: { id: 'ASC' } });
    if (!row) {
      row = await this.repo.save(this.repo.create({}));
    }
    return row;
  }

  async update(dto: Partial<CompanySettings>): Promise<CompanySettings> {
    const row = await this.get();
    const { id, ...rest } = dto as any;
    Object.assign(row, rest);
    row.updatedAt = new Date();
    return await this.repo.save(row);
  }
}
