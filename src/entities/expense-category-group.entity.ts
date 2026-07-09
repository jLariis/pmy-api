import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { ExpenseCategory } from './expense-category.entity';

@Entity('expense_category_group')
export class ExpenseCategoryGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  icon?: string;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ default: false })
  isSystem: boolean;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @OneToMany(() => ExpenseCategory, (c) => c.group)
  categories: ExpenseCategory[];
}
