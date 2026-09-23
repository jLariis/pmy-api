import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { decimalTransformer } from 'src/common/transformers/decimal.transformer';
import { PurchaseOrder } from './purchase-order.entity';
import { MaintenanceService } from './maintenance-service.entity';

/** Partida de la orden; `approved` la decide el autorizador (solo las aprobadas van al proveedor). */
@Entity('purchase_order_item')
export class PurchaseOrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PurchaseOrder, (p) => p.items, { onDelete: 'CASCADE', createForeignKeyConstraints: false, orphanedRowAction: 'delete' })
  @JoinColumn({ name: 'purchaseOrderId' })
  purchaseOrder: PurchaseOrder;

  @Column({ length: 36 })
  purchaseOrderId: string;

  @ManyToOne(() => MaintenanceService, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'serviceId' })
  service: MaintenanceService | null;

  @Column({ length: 36, nullable: true })
  serviceId: string | null;

  @Column({ length: 300 })
  description: string;

  @Column('decimal', { precision: 10, scale: 2, default: 1, transformer: decimalTransformer })
  quantity: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  unitPrice: number;

  @Column('decimal', { precision: 5, scale: 4, default: 0.16, transformer: decimalTransformer })
  taxRate: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  amount: number;

  @Column({ default: true })
  approved: boolean;
}
