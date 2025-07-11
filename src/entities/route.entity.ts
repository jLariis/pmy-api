import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Driver } from './driver.entity';

@Entity('route')
export class Route {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ManyToOne(() => Driver)
  driver: Driver;

  @Column()
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

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;

  @BeforeInsert()
  setDefaults() {
    this.createdAt = new Date(); // Fecha en UTC
    if (!this.startTime) {
      this.startTime = new Date(); // Asignar fecha actual en UTC si no se proporciona
    }
    if (!this.estimatedArrival) {
      this.estimatedArrival = new Date(); // Asignar fecha actual en UTC si no se proporciona
    }
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date(); // Fecha en UTC
  }
}