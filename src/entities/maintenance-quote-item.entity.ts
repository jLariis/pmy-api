import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { decimalTransformer } from 'src/common/transformers/decimal.transformer';
import { MaintenanceQuote } from './maintenance-quote.entity';
import { MaintenanceService } from './maintenance-service.entity';
import { Product } from './product.entity';

export const AVAILABILITY = ['si', 'no', 'sobre_pedido'] as const;
export type Availability = (typeof AVAILABILITY)[number];

/** Partida de una cotización (del catálogo o libre). */
@Entity('maintenance_quote_item')
export class MaintenanceQuoteItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MaintenanceQuote, (q) => q.items, { onDelete: 'CASCADE', createForeignKeyConstraints: false, orphanedRowAction: 'delete' })
  @JoinColumn({ name: 'quoteId' })
  quote: MaintenanceQuote;

  @Column({ length: 36 })
  quoteId: string;

  @ManyToOne(() => MaintenanceService, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'serviceId' })
  service: MaintenanceService | null;

  @Column({ length: 36, nullable: true })
  serviceId: string | null;

  /** Renglón de la solicitud al que responde esta partida (comparativo por partida). */
  @Column({ length: 36, nullable: true })
  requestItemId: string | null;

  @ManyToOne(() => Product, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'productId' })
  product: Product | null;

  @Column({ length: 36, nullable: true })
  productId: string | null;

  @Column({ length: 300 })
  description: string;

  /** ¿El proveedor lo tiene? sí / no / sobre pedido (+ días de entrega). */
  @Column({ type: 'enum', enum: AVAILABILITY, default: 'si' })
  availability: Availability;

  @Column({ type: 'int', nullable: true })
  leadTimeDays: number | null;

  @Column({ default: true })
  ivaEnabled: boolean;

  @Column({ default: false })
  iepsEnabled: boolean;

  @Column('decimal', { precision: 6, scale: 4, default: 0, transformer: decimalTransformer })
  iepsRate: number;

  /** Calidad 1–5 estrellas de este producto con este proveedor. */
  @Column({ type: 'tinyint', nullable: true })
  quality: number | null;

  @Column('decimal', { precision: 10, scale: 2, default: 1, transformer: decimalTransformer })
  quantity: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  unitPrice: number;

  @Column('decimal', { precision: 5, scale: 4, default: 0.16, transformer: decimalTransformer })
  taxRate: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  amount: number;

  /** Precio de referencia del catálogo al momento de capturar (snapshot). */
  @Column('decimal', { precision: 12, scale: 2, nullable: true, transformer: decimalTransformer })
  referencePrice: number | null;

  @Column('decimal', { precision: 8, scale: 2, nullable: true, transformer: decimalTransformer })
  deviationPct: number | null;
}
