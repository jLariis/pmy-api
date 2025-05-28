import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Shipment } from './shipment.entity';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';

@Entity('shipment_status')
export class ShipmentStatus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Shipment, shipment => shipment.statusHistory)
  shipment: Shipment;

  @Column({
    type: 'enum',
    enum: ShipmentStatusType,
  })
  status: ShipmentStatusType;

  @Column()
  timestamp: string;

  @Column({ nullable: true })
  notes?: string;
}
