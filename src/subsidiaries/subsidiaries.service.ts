import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subsidiary } from 'src/entities';
import { Repository } from 'typeorm';

@Injectable()
export class SubsidiariesService {
  constructor(
    @InjectRepository(Subsidiary)
    private subsidiaryRepository: Repository<Subsidiary>
  ){}

  async create(subsidiary: Subsidiary){
    return await this.subsidiaryRepository.save(subsidiary);
  }

  async findAll(){
    return await this.subsidiaryRepository.find({
      order: {
        name: "ASC"
      }
    });
  } 

  async findById(id: string): Promise<Subsidiary>{
    return await this.subsidiaryRepository.findOneBy({id});
  }

  async getByName(name: string){
    const city = await this.subsidiaryRepository.findOne({ where: { name } })
    return city;
  }

}
