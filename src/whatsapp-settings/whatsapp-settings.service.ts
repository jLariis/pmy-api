import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappSettings } from 'src/entities';
import { DEFAULT_DRIVER_PHONE, DEFAULT_MESSAGE_TEMPLATE } from './whatsapp-defaults';

@Injectable()
export class WhatsappSettingsService {
  constructor(
    @InjectRepository(WhatsappSettings)
    private readonly repo: Repository<WhatsappSettings>,
  ) {}

  /** Singleton: devuelve la fila o crea una con los valores por defecto la primera vez. */
  async get(): Promise<WhatsappSettings> {
    let row = await this.repo.findOne({ where: {}, order: { id: 'ASC' } });
    if (!row) {
      row = await this.repo.save(
        this.repo.create({
          enabled: true,
          driverPhone: DEFAULT_DRIVER_PHONE,
          messageTemplate: DEFAULT_MESSAGE_TEMPLATE,
        }),
      );
    }
    return row;
  }

  async update(dto: Partial<WhatsappSettings>): Promise<WhatsappSettings> {
    const row = await this.get();
    const { id, ...rest } = dto as any;
    // El número se guarda solo con dígitos (wa.me no acepta "+" ni espacios).
    if (typeof rest.driverPhone === 'string') rest.driverPhone = rest.driverPhone.replace(/\D/g, '');
    Object.assign(row, rest);
    row.updatedAt = new Date();
    return await this.repo.save(row);
  }
}
