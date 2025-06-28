import { Injectable } from '@nestjs/common';
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

  async create(createExpenseDto: Expense) {
    const newExpense = await this.expenseRepository.create(createExpenseDto);
    return await this.expenseRepository.save(newExpense);
  }

  async findAll() {
    return await this.expenseRepository.find({order: {date: 'ASC'}});
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
      }
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
