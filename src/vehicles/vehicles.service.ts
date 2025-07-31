import { Injectable } from '@nestjs/common';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Subsidiary, Vehicle } from 'src/entities';
import { Repository } from 'typeorm';

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicleRepository: Repository<Vehicle>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
  ) {}

  async create(createVehicleDto: CreateVehicleDto) {
    const subsidiaryObj = await this.subsidiaryRepository.findOneBy({ id: createVehicleDto.subsidiary.id });

    if(!subsidiaryObj) {
      throw new Error('Subsidiary not found');  
    }

    const newVehicle = this.vehicleRepository.create({
      ...createVehicleDto,
      subsidiary: {
        id: subsidiaryObj.id
      },
    });
    
    return await this.vehicleRepository.save(newVehicle);
  }

  async findAll() {
    return await this.vehicleRepository.find();
  }

  async findOne(id: string) {
    return await this.vehicleRepository.findOne({ where: { id } });
  }

  async update(id: string, updateVehicleDto: UpdateVehicleDto) {
    return await this.vehicleRepository.update(id, updateVehicleDto);
  }

  async remove(id: string) {
    return await this.vehicleRepository.delete(id);
  }
}
