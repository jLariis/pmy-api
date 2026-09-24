import { Column, DeleteDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Vehicle } from './vehicle.entity';
import { Subsidiary } from './subsidiary.entity';
import { User } from './user.entity';
import { MaintenanceQuote } from './maintenance-quote.entity';

export const REQUEST_STATUSES = ['abierta', 'en_cotizacion', 'orden_generada', 'completada', 'cancelada'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_PRIORITIES = ['baja', 'media', 'alta'] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

/** Solicitud de mantenimiento de una unidad; agrupa las cotizaciones comparables. */
@Entity('maintenance_request')
export class MaintenanceRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 20, unique: true })
  folio: string;

  @ManyToOne(() => Vehicle, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'vehicleId' })
  vehicle: Vehicle;

  @Column({ length: 36 })
  vehicleId: string;

  @ManyToOne(() => Subsidiary, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ length: 36 })
  subsidiaryId: string;

  @Column({ type: 'int', nullable: true })
  kmsAtRequest: number | null;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: REQUEST_PRIORITIES, default: 'media' })
  priority: RequestPriority;

  @Column({ type: 'enum', enum: REQUEST_STATUSES, default: 'abierta' })
  status: RequestStatus;

  @OneToMany(() => MaintenanceQuote, (q) => q.request)
  quotes: MaintenanceQuote[];

  @ManyToOne(() => User, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ length: 36, nullable: true })
  createdById: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date | null;

  @DeleteDateColumn({ type: 'datetime', nullable: true })
  deletedAt: Date | null;
}
