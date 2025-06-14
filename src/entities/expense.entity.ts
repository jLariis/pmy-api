import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Subsidiary } from './subsidiary.entity';
import { ExpenseCategory } from './expense-category.entity';

@Entity('expense')
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ nullable: true })
  subsidiaryId: string;

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
