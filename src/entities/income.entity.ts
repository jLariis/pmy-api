import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Subsidiary } from './subsidiary.entity';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { Shipment } from './shipment.entity';
import { Collection } from './collection.entity';
import { Charge } from './charge.entity';

@Entity('income')
export class Income {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Opcional: solo si el ingreso viene de un shipment o collection */
  @Column({ nullable: true })
  trackingNumber?: string;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ nullable: true })
  subsidiaryId: string;

  @Column()
  shipmentType: ShipmentType;

  @Column('decimal', { precision: 10, scale: 2, nullable: false })
  cost: number;

  @Column({ nullable: false })
  incomeType: IncomeStatus;

  @Column({ nullable: true, default: '' })
  notDeliveryStatus: string;

  /** Indica si el ingreso está agrupado (por un charge, por ejemplo) */
  @Column({ default: false })
  isGrouped: boolean;

  /** Tipo de fuente: shipment, collection, charge, manual, etc. */
  @Column({ type: 'enum', enum: IncomeSourceType })
  sourceType: IncomeSourceType;

  /** Referencia opcional a un Shipment */
  @ManyToOne(() => Shipment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'shipmentId' })
  shipment?: Shipment;

  @Column({ nullable: true })
  shipmentId?: string;

  /** Referencia opcional a una Collection */
  @ManyToOne(() => Collection, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'collectionId' })
  collection?: Collection;

  @Column({ nullable: true })
  collectionId?: string;

  /** Referencia opcional a un Charge */
  @ManyToOne(() => Charge, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'chargeId' })
  charge?: Charge;

  @Column({ nullable: true })
  chargeId?: string;

  @Column()
  date: Date;

  @Column({ nullable: true })
  createdAt: string;

  @BeforeInsert()
  setDefaults() {
    const now = new Date();
    this.createdAt = now.toISOString();
  }
}
