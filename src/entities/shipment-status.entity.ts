import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  BeforeInsert,
  JoinColumn,
} from 'typeorm';
import { Shipment } from './shipment.entity';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';

@Entity('shipment_status')
export class ShipmentStatus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Shipment, (shipment) => shipment.statusHistory, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'shipmentId'})
  shipment: Shipment;

  @Column({
    type: 'enum',
    enum: ShipmentStatusType,
  })
  status: ShipmentStatusType;

  @Index()
  @Column({ nullable: true, default: '' })
  exceptionCode?: string;

  @Column({ type: 'datetime' })
  timestamp: Date;

  @Column({ nullable: true })
  notes?: string;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @BeforeInsert()
  setDefaults() {
    this.createdAt = new Date(); // Fecha en UTC
    if (!this.timestamp) {
      this.timestamp = new Date(); // Asignar fecha actual en UTC si no se proporciona
    }
  }

}