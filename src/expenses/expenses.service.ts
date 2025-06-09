import { Injectable } from '@nestjs/common';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Expense } from 'src/entities';
import { Between, Repository } from 'typeorm';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private expenseRepository: Repository<Expense>
  ){}

  async create(createExpenseDto: CreateExpenseDto) {
    return await this.expenseRepository.create(createExpenseDto);
  }

  async findAll() {
    return await this.expenseRepository.find();
  }

  async findOne(id: string) {
    return await this.expenseRepository.findOneBy({id});
  }

  async findBySubsidiary(subsidiaryId: string) {
    const expenses = await this.expenseRepository.find({
      where: {
        subsidiary: {
          id: subsidiaryId
        }
      }, 
      relations: ['category']
    });

    return expenses;
  }

  async findBySubsidiaryAndDates(subsidiaryId: string, firstDay: Date, lastDay: Date) {
    return await this.expenseRepository.find({
      where: {
        subsidiary: {
          id: subsidiaryId
        },
        date: Between(firstDay, lastDay)
      }
    });
  }


  async update(id: string, updateExpenseDto: UpdateExpenseDto) {
    return `This action updates a #${id} expense`;
  }

  async remove(id: string) {
    return `This action removes a #${id} expense`;
  }
}
