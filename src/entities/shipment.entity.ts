import { Column, Entity, ManyToOne, OneToMany, OneToOne, JoinColumn, PrimaryGeneratedColumn, BeforeInsert } from 'typeorm';
import { Payment } from './payment.entity';
import { ShipmentStatus } from './shipment-status.entity'
import { Priority } from '../common/enums/priority.enum';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';

@Entity('shipment')
export class Shipment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  trackingNumber: string;

  @Column()
  recipientName: string;

  @Column()
  recipientAddress: string;

  @Column()
  recipientCity: string;

  @Column()
  recipientZip: string;

  @Column({ type: 'date' })
  commitDate: Date;

  @Column({ type: 'time' })
  commitTime: string;

  @Column()
  recipientPhone: string;

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

  @Column({nullable: true})
  consNumber: string;

  @BeforeInsert()
  setDefaults() {
    const now = new Date();
    this.commitDate = new Date(now.toISOString().split('T')[0]); // yyyy-mm-dd
    this.commitTime = now.toTimeString().split(' ')[0]; // hh:mm:ss
  }
}
