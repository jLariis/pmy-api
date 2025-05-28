import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Subsidiary } from './subsidiary.entity';

@Entity('route_income')
export class RouteIncome {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Subsidiary, subsidiary => subsidiary.incomes)
  subsidiary: Subsidiary;

  @Column()
  date: Date;

  @Column('decimal')
  ok: number;

  @Column('decimal')
  ba: number;

  @Column('decimal')
  collections: number;

  @Column('decimal')
  total: number;

  @Column('decimal')
  totalIncome: number;
}
