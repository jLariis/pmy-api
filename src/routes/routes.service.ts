import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Route, Subsidiary } from 'src/entities';
import { Not, Repository } from 'typeorm';
import { StatusEnum } from 'src/common/enums/status.enum';

@Injectable()
export class RoutesService {
  constructor(
    @InjectRepository(Route)
    private readonly routeRepository: Repository<Route>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
  ) {}

  async create(createRouteDto: CreateRouteDto, userId?: string) {
    if (!createRouteDto.subsidiary?.id) {
      throw new BadRequestException('La sucursal es obligatoria.');
    }
    const subsidiaryObj = await this.subsidiaryRepository.findOneBy({ id: createRouteDto.subsidiary.id });
    if (!subsidiaryObj) {
      throw new NotFoundException('Sucursal no encontrada.');
    }

    const newRoute = this.routeRepository.create({
      ...createRouteDto,
      subsidiary: { id: subsidiaryObj.id },
      createdById: userId ?? null,
    });
    return await this.routeRepository.save(newRoute);
  }

  async findAll() {
    return await this.routeRepository.find({
      where: { status: Not(StatusEnum.INACTIVE) },
      relations: ['subsidiary'],
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string) {
    return await this.routeRepository.findOne({ where: { id }, relations: ['subsidiary'] });
  }

  async findBySubsidiary(subsidiaryId: string) {
    return await this.routeRepository.find({
      where: { subsidiary: { id: subsidiaryId }, status: Not(StatusEnum.INACTIVE) },
      relations: ['subsidiary'],
      order: { name: 'ASC' },
    });
  }

  async update(id: string, updateRouteDto: UpdateRouteDto) {
    const route = await this.routeRepository.findOne({ where: { id } });
    if (!route) throw new NotFoundException('Ruta no encontrada.');

    const { subsidiary, ...rest } = updateRouteDto;
    this.routeRepository.merge(route, rest);
    if (subsidiary?.id) route.subsidiary = { id: subsidiary.id } as Subsidiary;

    return await this.routeRepository.save(route);
  }

  /** Borrado lógico: marca INACTIVA (preserva trazabilidad). */
  async remove(id: string) {
    const route = await this.routeRepository.findOne({ where: { id } });
    if (!route) throw new NotFoundException('Ruta no encontrada.');
    route.status = StatusEnum.INACTIVE;
    return await this.routeRepository.save(route);
  }
}
