import { Column, Entity, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
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

  @OneToMany(() => Route, route => route.vehicle)
  routes: Route[];
}
