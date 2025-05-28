import { Column, Entity, PrimaryGeneratedColumn, OneToOne } from 'typeorm';
import { PaymentStatus } from '../common/enums/payment-status.enum';
import { Shipment } from './shipment.entity';

@Entity('payment')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @OneToOne(() => Shipment, shipment => shipment.payment)
  shipment: Shipment;
}
