import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Holiday } from 'src/entities';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import type { ExtraHoliday } from 'src/shipments/sunday-holiday.util';

@Injectable()
export class HolidaysService {
  constructor(
    @InjectRepository(Holiday)
    private readonly holidayRepository: Repository<Holiday>,
  ) {}

  /** Lista los festivos adicionales (los más recientes primero). */
  getAll(): Promise<Holiday[]> {
    return this.holidayRepository.find({ order: { date: 'ASC' } });
  }

  async create(dto: CreateHolidayDto, userId?: string): Promise<Holiday> {
    const holiday = this.holidayRepository.create({
      name: dto.name.trim(),
      date: dto.date.slice(0, 10),
      recurring: dto.recurring ?? false,
      createdById: userId ?? null,
    });
    return this.holidayRepository.save(holiday);
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const res = await this.holidayRepository.delete(id);
    if (!res.affected) throw new NotFoundException(`Holiday ${id} no existe`);
    return { deleted: true };
  }

  /**
   * Festivos adicionales en el formato que consume `isSundayOrMexHoliday`.
   * Se usa al cobrar cargas F2/1.5 ton para decidir el sobreprecio de domingo/festivo.
   */
  async getHolidayInputs(): Promise<ExtraHoliday[]> {
    const rows = await this.holidayRepository.find();
    return rows.map((h) => ({ date: String(h.date).slice(0, 10), recurring: !!h.recurring }));
  }
}
