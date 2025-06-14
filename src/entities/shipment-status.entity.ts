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

  @Column({nullable: true, default: ''})
  exceptionCode?: string

  @Column({
    type: 'timestamp',
    precision: 3,
    transformer: {
      to: (value: Date) => {
        return new Date(value.getTime() - (value.getTimezoneOffset() * 60000));
      },
      from: (value: string) => {
        const date = new Date(value);
        return new Date(date.getTime() + (date.getTimezoneOffset() * 60000));
      }
    }
  })
  timestamp: Date;

  @Column({ nullable: true })
  notes?: string;
}
