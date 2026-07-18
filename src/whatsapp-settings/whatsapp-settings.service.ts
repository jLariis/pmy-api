import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappSettings } from 'src/entities';

@Injectable()
export class WhatsappSettingsService {
  constructor(
    @InjectRepository(WhatsappSettings)
    private readonly repo: Repository<WhatsappSettings>,
  ) {}

  /** Singleton: devuelve la fila o crea una la primera vez. */
  async get(): Promise<WhatsappSettings> {
    let row = await this.repo.findOne({ where: {}, order: { id: 'ASC' } });
    if (!row) {
      row = await this.repo.save(this.repo.create({ enabled: true }));
    }
    return row;
  }

  async update(dto: Partial<WhatsappSettings>): Promise<WhatsappSettings> {
    const row = await this.get();
    const { id, ...rest } = dto as any;
    Object.assign(row, rest);
    row.updatedAt = new Date();
    return await this.repo.save(row);
  }
}
