import { Injectable } from '@nestjs/common';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Route, Subsidiary } from 'src/entities';
import { Repository } from 'typeorm';

@Injectable()
export class RoutesService {
  constructor(
    @InjectRepository(Route)
    private readonly routeRepository: Repository<Route>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
  ) {}
  async create(createRouteDto: CreateRouteDto) {
    const subsidiaryObj = await this.subsidiaryRepository.findOneBy({ id: createRouteDto.subsidiary.id });

    if(!subsidiaryObj) {
      throw new Error('Subsidiary not found');  
    }

    const newRoute = await this.routeRepository.create({
      ...createRouteDto,
      subsidiary: { id: subsidiaryObj.id }
    });
    return await this.routeRepository.save(newRoute);
  }

  async findAll() {
    return await this.routeRepository.find({
      relations: ['subsidiary']
    });
  }

  async findOne(id: string) {
    return await this.routeRepository.findOne({ where: { id } });
  }

  async update(id: string, updateRouteDto: UpdateRouteDto) {
    return await this.routeRepository.update(id, updateRouteDto);
  }

  async remove(id: string) {
    return await this.routeRepository.delete(id);
  }
}
