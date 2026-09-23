import { Column, DeleteDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { decimalTransformer } from 'src/common/transformers/decimal.transformer';
import { PO_STATUSES, PoStatus } from 'src/maintenance/utils/po-state.util';
import { MaintenanceRequest } from './maintenance-request.entity';
import { MaintenanceQuote } from './maintenance-quote.entity';
import { Supplier } from './supplier.entity';
import { SupplierContact } from './supplier-contact.entity';
import { Vehicle } from './vehicle.entity';
import { Subsidiary } from './subsidiary.entity';
import { User } from './user.entity';
import { PurchaseOrderItem } from './purchase-order-item.entity';
import { PurchaseOrderDispatch } from './purchase-order-dispatch.entity';

/** Orden de compra de mantenimiento (nace de la cotización ganadora). */
@Entity('purchase_order')
export class PurchaseOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 20, unique: true })
  folio: string;

  @ManyToOne(() => MaintenanceRequest, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'requestId' })
  request: MaintenanceRequest;

  @Column({ length: 36 })
  requestId: string;

  @ManyToOne(() => MaintenanceQuote, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'quoteId' })
  quote: MaintenanceQuote;

  @Column({ length: 36 })
  quoteId: string;

  @ManyToOne(() => Supplier, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ length: 36 })
  supplierId: string;

  @ManyToOne(() => SupplierContact, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'contactId' })
  contact: SupplierContact | null;

  @Column({ length: 36, nullable: true })
  contactId: string | null;

  @ManyToOne(() => Vehicle, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'vehicleId' })
  vehicle: Vehicle;

  @Column({ length: 36 })
  vehicleId: string;

  @ManyToOne(() => Subsidiary, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ length: 36 })
  subsidiaryId: string;

  @Column({ type: 'enum', enum: PO_STATUSES, default: 'borrador' })
  status: PoStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string | null;

  @ManyToOne(() => User, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'authorizedById' })
  authorizedBy: User | null;

  @Column({ length: 36, nullable: true })
  authorizedById: string | null;

  @Column({ type: 'datetime', nullable: true })
  authorizedAt: Date | null;

  /** Totales de las partidas APROBADAS. */
  @Column('decimal', { precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  subtotal: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  tax: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  total: number;

  @Column({ type: 'datetime', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  completedKms: number | null;

  @Column('decimal', { precision: 12, scale: 2, nullable: true, transformer: decimalTransformer })
  finalAmount: number | null;

  @Column({ length: 36, nullable: true })
  expenseId: string | null;

  @Column({ type: 'text', nullable: true })
  cancelReason: string | null;

  @OneToMany(() => PurchaseOrderItem, (i) => i.purchaseOrder, { cascade: true })
  items: PurchaseOrderItem[];

  @OneToMany(() => PurchaseOrderDispatch, (d) => d.purchaseOrder)
  dispatches: PurchaseOrderDispatch[];

  @ManyToOne(() => User, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ length: 36, nullable: true })
  createdById: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date | null;

  @DeleteDateColumn({ type: 'datetime', nullable: true })
  deletedAt: Date | null;
}
