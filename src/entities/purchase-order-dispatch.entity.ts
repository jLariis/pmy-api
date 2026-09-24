import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PurchaseOrder } from './purchase-order.entity';
import { CONTACT_CHANNELS, ContactChannel } from './supplier-contact.entity';

export const PO_DISPATCH_STATUSES = ['enviado', 'error'] as const;
export type PoDispatchStatus = (typeof PO_DISPATCH_STATUSES)[number];

/** Un intento de envío de la orden al proveedor (correo o WhatsApp). */
@Entity('purchase_order_dispatch')
export class PurchaseOrderDispatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PurchaseOrder, (p) => p.dispatches, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'purchaseOrderId' })
  purchaseOrder: PurchaseOrder;

  @Column({ length: 36 })
  purchaseOrderId: string;

  @Column({ type: 'enum', enum: CONTACT_CHANNELS })
  channel: ContactChannel;

  @Column({ length: 200 })
  destination: string;

  @Column({ type: 'enum', enum: PO_DISPATCH_STATUSES })
  status: PoDispatchStatus;

  /** 'orden' o 'cancelacion'. */
  @Column({ length: 20, default: 'orden' })
  kind: string;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ length: 36, nullable: true })
  emailLogId: string | null;

  @Column({ length: 36, nullable: true })
  sentById: string | null;

  @Column({ length: 150, nullable: true })
  sentByName: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  sentAt: Date;
}
