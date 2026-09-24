import { Column, DeleteDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { decimalTransformer } from 'src/common/transformers/decimal.transformer';
import { MaintenanceRequest } from './maintenance-request.entity';
import { Supplier } from './supplier.entity';
import { User } from './user.entity';
import { MaintenanceQuoteItem } from './maintenance-quote-item.entity';

export const QUOTE_STATUSES = ['capturada', 'ganadora', 'descartada'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Cotización de un proveedor para una solicitud. */
@Entity('maintenance_quote')
export class MaintenanceQuote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MaintenanceRequest, (r) => r.quotes, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'requestId' })
  request: MaintenanceRequest;

  @Column({ length: 36 })
  requestId: string;

  @ManyToOne(() => Supplier, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ length: 36 })
  supplierId: string;

  @Column({ type: 'date' })
  quoteDate: string;

  @Column({ type: 'date', nullable: true })
  validUntil: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Ruta relativa en disco del PDF/foto original del proveedor. */
  @Column({ length: 500, nullable: true })
  attachmentPath: string | null;

  @Column({ length: 255, nullable: true })
  attachmentName: string | null;

  @Column({ length: 100, nullable: true })
  attachmentMime: string | null;

  @Column('decimal', { precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  subtotal: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  tax: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  total: number;

  @Column({ type: 'enum', enum: QUOTE_STATUSES, default: 'capturada' })
  status: QuoteStatus;

  @OneToMany(() => MaintenanceQuoteItem, (i) => i.quote, { cascade: true })
  items: MaintenanceQuoteItem[];

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
