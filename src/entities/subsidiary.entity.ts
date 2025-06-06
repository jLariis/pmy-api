import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { RouteIncome } from './route-income.entity';
import { Expense } from './expense.entity';
import { User } from './user.entity';

@Entity('subsidiary')
export class Subsidiary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  address?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ default: true })
  active: boolean;

  @Column({ default: '', nullable: true})
  officeManager: string;

  @Column({
    type: "decimal",
    precision: 10,
    scale: 2,
    default: 0.00
  })
  fedexCostPackage: string;

  @Column({
    type: "decimal",
    precision: 10,
    scale: 2,
    default: 0.00
  })
  dhlCostPackage: string;


  @OneToMany(() => RouteIncome, income => income.subsidiary)
  incomes: RouteIncome[];

  @OneToMany(() => Expense, expense => expense.subsidiary)
  expenses: Expense[];

  @OneToMany(() => User, user => user.subsidiary)
  users: User[];
}
