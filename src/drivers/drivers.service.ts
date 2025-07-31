import { Injectable } from '@nestjs/common';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Driver, Subsidiary } from 'src/entities';
import { Repository } from 'typeorm';

@Injectable()
export class DriversService {

  constructor(
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
  ) {}

  async create(createDriverDto: CreateDriverDto) {
    console.log("🚀 ~ DriversService ~ create ~ createDriverDto:", createDriverDto)
    
    const subsidiaryObj = await this.subsidiaryRepository.findOneBy({ id: createDriverDto.subsidiary.id });

    if(!subsidiaryObj) {
      throw new Error('Subsidiary not found');  
    }

    const newDriver = await this.driverRepository.create({      
      ...createDriverDto,
      subsidiary: { id: subsidiaryObj.id }
    });

    return await this.driverRepository.save(newDriver);
  }

  async findAll() {
    return await this.driverRepository.find({
      relations: ['subsidiary']
    });
  }

  async findOne(id: string) {
    return await this.driverRepository.findOne({ where: { id } });
  }

  async update(id: string, updateDriverDto: UpdateDriverDto) {
    return await this.driverRepository.update(id, updateDriverDto);
  }

  async remove(id: string) {
    return await this.driverRepository.delete(id);
  }
}
