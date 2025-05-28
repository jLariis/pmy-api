import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
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

  @Column()
  status: 'En progreso' | 'Completada' | 'Pendiente' | 'Cancelada';

  @Column()
  startTime: string;

  @Column()
  estimatedArrival: string;
}
