import { Injectable } from '@nestjs/common';
import { CreateRouteclosureDto } from './dto/create-routeclosure.dto';
import { UpdateRouteclosureDto } from './dto/update-routeclosure.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { Repository } from 'typeorm';

@Injectable()
export class RouteclosureService {
  constructor(
    @InjectRepository(RouteClosure)
    private readonly routeClouseRepository: Repository<RouteClosure>
  ) {}

  async create(createRouteclosureDto: CreateRouteclosureDto) {
    const newRouteClosure = this.routeClouseRepository.create(createRouteclosureDto);
    return await this.routeClouseRepository.save(newRouteClosure);
  }

  async findAll(subsidiaryId: string) {
    return await this.routeClouseRepository.find({
      where: {
        subsidiary: {
          id: subsidiaryId
        }
      }
    });
  }

  async findOne(id: string) {
    return await this.routeClouseRepository.findOne({
      where: {
        id
      }
    });
  }

  async validate(id: string){
    
  }

  async remove(id: string) {
    return await this.routeClouseRepository.delete(id);
  }
}
