import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Expense } from './expense.entity';
import { ExpenseCategoryGroup } from './expense-category-group.entity';

@Entity('expense_category')
export class ExpenseCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ManyToOne(() => ExpenseCategoryGroup, (g) => g.categories, { nullable: true })
  @JoinColumn({ name: 'groupId' })
  group?: ExpenseCategoryGroup;

  @Column({ nullable: true })
  groupId?: string;

  @Column({ default: false })
  isSystem: boolean;

  @Column({ default: true })
  active: boolean;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ nullable: true })
  description?: string;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @OneToMany(() => Expense, (e) => e.category)
  expenses: Expense[];
}
