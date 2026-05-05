import { Driver, Subsidiary, User, Vehicle } from './'; // Ajusta tus imports
import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

@Entity('transfer')
export class Transfer {
  @Index()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'originId' })
  origin: Subsidiary;
  
  @Column({ nullable: true })
  originId: string;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'destinationId' })
  destination: Subsidiary;

  @Column({ nullable: true })
  destinationId: string;

  // NUEVO: Para cuando seleccionan "Otro" en la sucursal de destino
  @Column({ type: 'varchar', length: 255, nullable: true })
  otherDestination: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: false, default: 0 })
  amount: number;

  // NUEVO: Tipo de traslado (Tyco, Aeropuerto, Otro)
  @Column({ type: 'varchar', length: 50, nullable: false })
  transferType: string;

  // NUEVO: Descripción cuando el tipo de traslado es "Otro"
  @Column({ type: 'varchar', length: 255, nullable: true })
  otherTransferType: string;

  // NUEVO: Un estado siempre es útil para el dashboard
  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  status: string;

  @ManyToMany(() => Driver, { nullable: true })
  @JoinTable({
    name: 'transfer_drivers',
    joinColumn: { name: 'transferId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'driverId', referencedColumnName: 'id' },
  })
  drivers: Driver[] | null;

  @ManyToOne(() => Vehicle, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'vehicleId' })
  vehicle: Vehicle | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ nullable: true })
  createdById: string;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}