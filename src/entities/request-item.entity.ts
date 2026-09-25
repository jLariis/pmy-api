import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { decimalTransformer } from 'src/common/transformers/decimal.transformer';
import { MaintenanceRequest } from './maintenance-request.entity';
import { Product } from './product.entity';
import { ProductCategory } from './product-category.entity';
import { UnitOfMeasure } from './unit-of-measure.entity';

/** Renglón de una solicitud (lo que se necesita). `selectedQuoteItemId` = ganador elegido en el comparativo. */
@Entity('request_item')
export class RequestItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MaintenanceRequest, (r) => r.items, { onDelete: 'CASCADE', createForeignKeyConstraints: false, orphanedRowAction: 'delete' })
  @JoinColumn({ name: 'requestId' })
  request: MaintenanceRequest;

  @Column({ length: 36 })
  requestId: string;

  @ManyToOne(() => Product, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'productId' })
  product: Product | null;

  @Column({ length: 36, nullable: true })
  productId: string | null;

  @ManyToOne(() => ProductCategory, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'categoryId' })
  category: ProductCategory | null;

  @Column({ length: 36, nullable: true })
  categoryId: string | null;

  @Column({ length: 300 })
  description: string;

  @Column('decimal', { precision: 10, scale: 2, default: 1, transformer: decimalTransformer })
  quantity: number;

  @ManyToOne(() => UnitOfMeasure, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'unitId' })
  unit: UnitOfMeasure | null;

  @Column({ length: 36, nullable: true })
  unitId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ length: 36, nullable: true })
  selectedQuoteItemId: string | null;

  @Column({ default: 0 })
  sortOrder: number;
}
