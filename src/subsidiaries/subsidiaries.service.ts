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

  async getByName(name: string){
    const city = await this.subsidiaryRepository.findOne({ where: { name } })
    return city;
  }

}
