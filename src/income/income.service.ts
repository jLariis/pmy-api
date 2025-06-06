import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Shipment } from 'src/entities';
import { Repository } from 'typeorm';

@Injectable()
export class IncomeService {
  
  constructor(
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>){}

  async getIncomesBySubsidiaryAndWeek(subsiary: string) {
    const incomes = this.shipmentRepository.find({
      where: {
        subsidiary: {
          id: subsiary
        }
      }
    });
  }


}
