import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Subsidiary } from './subsidiary.entity';
import { ExpenseCategory } from 'src/common/enums/category-enum';

@Entity('expense')
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ nullable: true })
  subsidiaryId: string;

  @Column({
    type: 'enum',
    enum: ExpenseCategory,
    nullable: true,
  })
  category?: ExpenseCategory;

  @Column()
  date: Date;

  @Column('decimal', { precision: 10, scale: 2, nullable: false })
  amount: number;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  paymentMethod?: string;

  @Column({ nullable: true })
  responsible?: string;

  @Column({ nullable: true })
  notes?: string;
}
