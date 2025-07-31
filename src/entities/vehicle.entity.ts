import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  OneToMany,
  BeforeInsert,
  BeforeUpdate,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { VehicleStatus } from '../common/enums/vehicle-status-enum';
import { Subsidiary } from './subsidiary.entity';
import { VehicleTypeEnum } from 'src/common/enums/vehicle-type.enum';

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

  @Column({ nullable: true})
  kms: number;

  @Column({nullable: true})
  code: string;

  @Column({ nullable: true })
  name: string;

  @Column({ default: 100})
  capacity: number;

  @Column({
    type: 'enum',
    enum: VehicleTypeEnum,
    default: VehicleTypeEnum.VAN,
  })
  type: VehicleTypeEnum;

  @Column({ nullable: true})
  lastMaintenanceDate: Date;

  @Column({ nullable: true})
  nextMaintenanceDate: Date;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

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