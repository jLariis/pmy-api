import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  BeforeInsert,
  BeforeUpdate,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Driver } from './driver.entity';
import { Shipment } from './shipment.entity';
import { Subsidiary } from './subsidiary.entity';
import { Vehicle } from './vehicle.entity';

@Entity('package-dispatch')
export class PackageDispatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  trackingNumber: string;

  @OneToMany(() => Shipment, shipment => shipment.packageDispatch)
  shipments: Shipment[];

  @ManyToOne(() => Driver, { nullable: true })
  @JoinColumn({ name: 'driverId' })
  driver: Driver;

  @ManyToOne(() => Vehicle, { nullable: true })
  @JoinColumn({ name: 'vehicleId' })
  vehicle: string;

  @Column({
    type: 'enum',
    enum: ['En progreso', 'Completada', 'Pendiente', 'Cancelada'],
    default: 'Pendiente',
  })
  status: 'En progreso' | 'Completada' | 'Pendiente' | 'Cancelada';

  @Column({ type: 'datetime' })
  startTime: Date;

  @Column({ type: 'datetime' })
  estimatedArrival: Date;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;

  @BeforeInsert()
  setDefaults() {
    this.createdAt = new Date();

    // Genera un número aleatorio de 10 dígitos como string
    this.trackingNumber = this.generateTrackingNumber();

    if (!this.startTime) {
      this.startTime = new Date();
    }

    if (!this.estimatedArrival) {
      this.estimatedArrival = new Date();
    }
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date();
  }

  private generateTrackingNumber(): string {
    return Math.floor(1000000000 + Math.random() * 9000000000).toString(); // 10 dígitos
  }
}
