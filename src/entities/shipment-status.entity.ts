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
import { ChargeShipment } from './charge-shipment.entity';

@Entity('shipment_status')
export class ShipmentStatus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Shipment, (shipment) => shipment.statusHistory, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'shipmentId' })
  shipment?: Shipment;

  @ManyToOne(() => ChargeShipment, (chargeShipment) => chargeShipment.statusHistory, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'chargeShipmentId' })
  chargeShipment?: ChargeShipment;

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

  /** Origen del renglón: 'route_closure_manual' si se capturó a mano en el cierre; null = los demás. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  source?: string | null;

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