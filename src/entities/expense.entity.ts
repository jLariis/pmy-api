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
import { ExpenseCategory } from './expense-category.entity';
import { User } from './user.entity';
import { Vehicle } from './vehicle.entity';
import { Frequency } from 'src/common/enums/frequency-enum';
import { toHermosilloDateString } from 'src/common/utils';

@Entity('expense')
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ nullable: true })
  subsidiaryId: string;

  @ManyToOne(() => ExpenseCategory, { nullable: true })
  @JoinColumn({ name: 'categoryId' })
  category?: ExpenseCategory;

  @Column({ nullable: true })
  categoryId?: string;

  @Column({ type: 'date' })
  date: string;

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

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @ManyToOne(() => Vehicle, { nullable: true })
  @JoinColumn({ name: 'vehicleId' })
  vehicle: Vehicle;

  @Column({ nullable: true })
  createdById: string;

  @Column({ nullable: true })
  vehicleId: string;

  @Column({
    type: 'enum',
    enum: Frequency,
    nullable: true,
  })
  frequency?: Frequency;

  @BeforeInsert()
  setCreatedAt() {
    this.createdAt = new Date(); // instante UTC (createdAt sigue siendo datetime)
    if (!this.date) {
      this.date = toHermosilloDateString(new Date()); // día calendario Hermosillo
    }
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date(); // Fecha en UTC
  }
}