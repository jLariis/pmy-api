import { RequestSelectedService } from './request-service.entity';
import { Column, DeleteDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Vehicle } from './vehicle.entity';
import { Subsidiary } from './subsidiary.entity';
import { User } from './user.entity';
import { MaintenanceQuote } from './maintenance-quote.entity';
import { RequestItem } from './request-item.entity';

export const REQUEST_STATUSES = ['por_revisar', 'rechazada', 'abierta', 'en_cotizacion', 'orden_generada', 'completada', 'cancelada'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_PRIORITIES = ['baja', 'media', 'alta'] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];
/** Mantenimiento/servicio/reparación requieren unidad; compra de equipo/material la tiene opcional. */
export const REQUEST_TYPES = ['mantenimiento', 'servicio', 'reparacion', 'compra'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const TYPES_REQUIRING_VEHICLE: RequestType[] = ['mantenimiento', 'servicio', 'reparacion'];

/** Solicitud de compra (expediente): renglones, cotizaciones comparables y N órdenes. */
@Entity('maintenance_request')
export class MaintenanceRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 20, unique: true })
  folio: string;

  @Column({ type: 'enum', enum: REQUEST_TYPES, default: 'mantenimiento' })
  type: RequestType;

  @ManyToOne(() => Vehicle, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'vehicleId' })
  vehicle: Vehicle | null;

  @Column({ length: 36, nullable: true })
  vehicleId: string | null;

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

  @Column({ type: 'enum', enum: REQUEST_STATUSES, default: 'por_revisar' })
  status: RequestStatus;

  @ManyToOne(() => User, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'reviewedById' })
  reviewedBy: User | null;

  @Column({ length: 36, nullable: true })
  reviewedById: string | null;

  @Column({ type: 'datetime', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string | null;

  @OneToMany(() => RequestItem, (i) => i.request, { cascade: true })
  items: RequestItem[];

  @OneToMany(() => RequestSelectedService, (s) => s.request)
  services: RequestSelectedService[];

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
