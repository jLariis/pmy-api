import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Driver, Subsidiary } from 'src/entities';
import { Not, Repository } from 'typeorm';
import { StatusEnum } from 'src/common/enums/status.enum';

@Injectable()
export class DriversService {

  constructor(
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
  ) {}

  async create(createDriverDto: CreateDriverDto, userId?: string) {
    if (!createDriverDto.subsidiary?.id) {
      throw new BadRequestException('La sucursal es obligatoria.');
    }
    const subsidiaryObj = await this.subsidiaryRepository.findOneBy({ id: createDriverDto.subsidiary.id });
    if (!subsidiaryObj) {
      throw new NotFoundException('Sucursal no encontrada.');
    }

    const newDriver = this.driverRepository.create({
      ...createDriverDto,
      subsidiary: { id: subsidiaryObj.id },
      createdById: userId ?? null,
    });

    return await this.driverRepository.save(newDriver);
  }

  async findAll() {
    return await this.driverRepository.find({
      where: { status: Not(StatusEnum.INACTIVE) },
      relations: ['subsidiary'],
      order: { name: 'ASC' },
    });
  }

  async findBySubsidiary(subsidiaryId: string) {
    return await this.driverRepository.find({
      where: {
        subsidiary: { id: subsidiaryId },
        status: Not(StatusEnum.INACTIVE),
      },
      relations: ['subsidiary'],
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string) {
    return await this.driverRepository.findOne({ where: { id }, relations: ['subsidiary'] });
  }

  async update(id: string, updateDriverDto: UpdateDriverDto) {
    const driver = await this.driverRepository.findOne({ where: { id } });
    if (!driver) throw new NotFoundException('Chofer no encontrado.');

    const { subsidiary, ...rest } = updateDriverDto;
    this.driverRepository.merge(driver, rest);
    if (subsidiary?.id) driver.subsidiary = { id: subsidiary.id } as Subsidiary;

    return await this.driverRepository.save(driver);
  }

  /** Borrado lógico: marca INACTIVO (preserva trazabilidad con salidas a ruta, etc.). */
  async remove(id: string) {
    const driver = await this.driverRepository.findOne({ where: { id } });
    if (!driver) throw new NotFoundException('Chofer no encontrado.');
    driver.status = StatusEnum.INACTIVE;
    return await this.driverRepository.save(driver);
  }
}
