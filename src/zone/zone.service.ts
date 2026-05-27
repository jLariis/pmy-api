import { Injectable, Logger } from '@nestjs/common';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Zone } from 'src/entities';
import { Repository } from 'typeorm';

@Injectable()
export class ZoneService {
  private readonly logger = new Logger(ZoneService.name);

  constructor(
    @InjectRepository(Zone)
    private readonly zoneRepository: Repository<Zone>,
  ) {}

  async create(createZoneDto: CreateZoneDto) {
    const zone = this.zoneRepository.create(createZoneDto);
    return await this.zoneRepository.save(zone);
  }

  async findAll() {
    return await this.zoneRepository.find();
  }

  async findOne(id: string) {
    return await this.zoneRepository.findOne({ where: { id } });
  }

  async update(id: string, updateZoneDto: UpdateZoneDto) {
    const zone = await this.zoneRepository.findOne({ where: { id } });
    Object.assign(zone, updateZoneDto);
    return await this.zoneRepository.save(zone);
  }

  async remove(id: string) {
    const zone = await this.zoneRepository.findOne({ where: { id } });
    return await this.zoneRepository.remove(zone);
  }

  async assingToSubsidiary(zoneId: string, subsidiaryId: string) {
    const zone = await this.zoneRepository.findOne({ where: { id: zoneId } });
  }
}
