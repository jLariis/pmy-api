import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  OneToMany,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Route } from './route.entity';
import { VehicleStatus } from '../common/enums/vehicle-status.enum';

@Entity('vehicle')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  plateNumber: string;

  @Column()
  model: string;

  @Column()
  brand: string;

  @Column({
    type: 'enum',
    enum: VehicleStatus,
    default: VehicleStatus.ACTIVE,
  })
  status: VehicleStatus;

  @OneToMany(() => Route, (route) => route.vehicle)
  @Exclude() // Evitar serializar routes
  routes: Route[];

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;

  @BeforeInsert()
  setCreatedAt() {
    this.createdAt = new Date(); // Fecha en UTC
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date(); // Fecha en UTC
  }
}