import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Subsidiary } from './subsidiary.entity';
import { ExpenseCategory } from './expense-category.entity';

@Entity('expense')
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Subsidiary, subsidiary => subsidiary.expenses)
  subsidiary: Subsidiary;

  @ManyToOne(() => ExpenseCategory, category => category.expenses)
  category: ExpenseCategory;

  @Column()
  date: Date;

  @Column('decimal')
  amount: number;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  paymentMethod?: string;

  @Column({ nullable: true })
  responsible?: string;

  @Column({ nullable: true })
  notes?: string;

  @Column({ nullable: true })
  receiptUrl?: string;
}
