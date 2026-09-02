import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Subsidiary } from './subsidiary.entity';
import { ShipmentType } from '../common/enums/shipment-type.enum';
import { IncomeStatus } from '../common/enums/income-status.enum';
import { IncomeSourceType } from '../common/enums/income-source-type.enum';
import { Shipment } from './shipment.entity';
import { Collection } from './collection.entity';
import { Charge } from './charge.entity';

@Entity('income')
export class Income {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  trackingNumber?: string;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ type: 'enum', enum: ShipmentType })
  shipmentType: ShipmentType;

  @Column('decimal', { precision: 10, scale: 2, nullable: false })
  cost: number;

  @Column({ type: 'enum', enum: IncomeStatus, nullable: false })
  incomeType: IncomeStatus;

  @Column({ nullable: true, default: '' })
  nonDeliveryStatus: string;

  @Column({ default: false })
  isGrouped: boolean;

  @Column({ type: 'enum', enum: IncomeSourceType })
  sourceType: IncomeSourceType;

  @Index()
  @ManyToOne(() => Shipment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'shipmentId' })
  shipment?: Shipment;

  @Index()
  @ManyToOne(() => Collection, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'collectionId' })
  collection?: Collection;

  @Index()
  @ManyToOne(() => Charge, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'chargeId' })
  charge?: Charge;

  @Column({ type: 'datetime' })
  date: Date;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  /** Usuario que originó el ingreso (auditoría); se hereda de la operación padre. */
  @Column({ type: 'char', length: 36, nullable: true })
  createdById?: string;

  /**
   * Soft-delete del ingreso. Al anular un `entregado` por una devolución, el original y su fila
   * de reversa (−cost) quedan `active=false`: los reportes que SUMAN netean a 0 (incluyan o no
   * inactivos) y los que CUENTAN por fila filtran `active=true`. Ver migración 064.
   */
  @Column({ type: 'tinyint', width: 1, default: 1 })
  active: boolean;

  /** Cuándo se anuló este ingreso (solo en el original anulado). */
  @Column({ type: 'datetime', nullable: true })
  annulledAt?: Date | null;

  /** Quién anuló este ingreso: el usuario que registró la devolución. */
  @Column({ type: 'char', length: 36, nullable: true })
  annulledById?: string | null;

  /** En una fila de REVERSA: id del ingreso original que anula. Null en ingresos normales. */
  @Column({ type: 'char', length: 36, nullable: true })
  reversalOfIncomeId?: string | null;

  // Ancla del cobro al evento terminal de FedEx que lo originó (idempotencia fuerte,
  // reconciliación exacta evento↔ingreso). Null en ingresos legacy/agrupados.
  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceEventKey?: string | null;

  @BeforeInsert()
  setDefaults() {
    this.createdAt = new Date(); // Fecha en UTC
    if (!this.date) {
      this.date = new Date(); // Asignar fecha actual en UTC si no se proporciona
    }
  }
}