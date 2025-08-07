import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  OneToOne,
  BeforeInsert,
  BeforeUpdate,
  JoinColumn,
  Index,
} from 'typeorm';
import { PaymentStatus } from '../common/enums/payment-status.enum';
import { Shipment } from './shipment.entity';
import { PaymentTypeEnum } from 'src/common/enums/payment-type.enum';

@Entity('payment')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: PaymentTypeEnum,
    default: PaymentTypeEnum.COD,
  })
  type: PaymentTypeEnum

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Index()
  @OneToOne(() => Shipment, shipment => shipment.payment)
  @JoinColumn({ name: 'shipmentId'})
  shipment: Shipment;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @BeforeInsert()
  setCreatedAt() {
    this.createdAt = new Date(); // Fecha en UTC
  }

}