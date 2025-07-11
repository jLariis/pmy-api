import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Subsidiary } from './subsidiary.entity';
import { ExpenseCategory } from '../common/enums/category-enum';

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

  @Column({ type: 'datetime' })
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

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;

  @BeforeInsert()
  setCreatedAt() {
    this.createdAt = new Date(); // Fecha en UTC
    if (!this.date) {
      this.date = new Date(); // Asignar fecha actual en UTC si no se proporciona
    }
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date(); // Fecha en UTC
  }
}