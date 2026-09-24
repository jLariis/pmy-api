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
import { User } from './user.entity';

@Entity('vehicle')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  plateNumber: string;

  @Column({default: '', nullable: true})
  plateNumber2: string;

  @Column({default: '', nullable: true})
  policyNumber: string;

  @Column({ type: 'datetime', nullable: true })
  policyExpirationDate: Date;

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

  /** Km del último servicio (ancla del próximo por km). */
  @Column({ type: 'int', nullable: true })
  lastMaintenanceKms: number | null;

  /** Cada cuántos km toca servicio (5,000–10,000 según la unidad). */
  @Column({ type: 'int', default: 5000 })
  maintenanceIntervalKms: number;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ nullable: true })
  createdById: string;

  @BeforeInsert()
  setCreatedAt() {
    this.createdAt = new Date(); // Fecha en UTC
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date(); // Fecha en UTC
  }
}