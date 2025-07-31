import { Column, Entity, ManyToOne, OneToMany, OneToOne, JoinColumn, PrimaryGeneratedColumn, BeforeInsert, Index } from 'typeorm';
import { Payment } from './payment.entity';
import { ShipmentStatus } from './shipment-status.entity';
import { Priority } from '../common/enums/priority.enum';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';
import { ShipmentType } from '../common/enums/shipment-type.enum';
import { Subsidiary } from './subsidiary.entity';
import { Route } from './route.entity';
import { PackageDispatch } from './package-dispatch.entity';

@Entity('shipment')
export class Shipment {
  @Index()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  trackingNumber: string;

  @Index()
  @Column({
    type: 'enum',
    enum: ShipmentType,
    default: ShipmentType.FEDEX,
  })
  shipmentType: ShipmentType;

  @Column()
  recipientName: string;

  @Column()
  recipientAddress: string;

  @Column()
  recipientCity: string;

  @Column()
  recipientZip: string;

  // Combinar commitDate y commitTime en un solo campo
  @Column({ type: 'datetime' })
  commitDateTime: Date;

  @Column()
  recipientPhone: string;

  @Index()
  @Column({
    type: 'enum',
    enum: ShipmentStatusType,
    default: ShipmentStatusType.PENDIENTE,
  })
  status: ShipmentStatusType;

  @Column({
    type: 'enum',
    enum: Priority,
    default: Priority.BAJA,
  })
  priority: Priority;

  @OneToOne(() => Payment, { cascade: true })
  @JoinColumn()
  payment: Payment;

  @OneToMany(() => ShipmentStatus, status => status.shipment, { cascade: true })
  statusHistory: ShipmentStatus[];

  @Column({ nullable: true })
  consNumber: string;

  @Column({ default: '' })
  receivedByName: string;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Index()
  @Column({ nullable: true, default: null })
  consolidatedId: string;

  @Column({ nullable: true, default: false})
  isHighValue: boolean;

  @ManyToOne(() => PackageDispatch, packageDispatch => packageDispatch.shipments, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'routeId' })
  packageDispatch?: PackageDispatch;

  @BeforeInsert()
  setDefaults() {
    this.createdAt = new Date(); // Fecha en UTC (asegúrate de que el servidor esté en UTC)
  }
}