import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { decimalTransformer } from 'src/common/transformers/decimal.transformer';
import { MaintenanceQuote } from './maintenance-quote.entity';
import { MaintenanceService } from './maintenance-service.entity';

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

  /** Precio de referencia del catálogo al momento de capturar (snapshot). */
  @Column('decimal', { precision: 12, scale: 2, nullable: true, transformer: decimalTransformer })
  referencePrice: number | null;

  @Column('decimal', { precision: 8, scale: 2, nullable: true, transformer: decimalTransformer })
  deviationPct: number | null;
}
