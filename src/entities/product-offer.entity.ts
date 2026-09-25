import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { decimalTransformer } from 'src/common/transformers/decimal.transformer';
import { Product } from './product.entity';
import { Supplier } from './supplier.entity';
import { UnitOfMeasure } from './unit-of-measure.entity';

/** Precio de un producto con un proveedor (y su calidad en estrellas). Se actualiza al capturar cotizaciones. */
@Entity('product_offer')
export class ProductOffer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product, (p) => p.offers, { onDelete: 'CASCADE', createForeignKeyConstraints: false, orphanedRowAction: 'delete' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ length: 36 })
  productId: string;

  @ManyToOne(() => Supplier, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ length: 36 })
  supplierId: string;

  @ManyToOne(() => UnitOfMeasure, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'unitId' })
  unit: UnitOfMeasure | null;

  @Column({ length: 36, nullable: true })
  unitId: string | null;

  @Column('decimal', { precision: 12, scale: 2, default: 0, transformer: decimalTransformer })
  price: number;

  /** 1–5 estrellas; null = sin calificar. */
  @Column({ type: 'tinyint', nullable: true })
  quality: number | null;

  @Column({ type: 'datetime', nullable: true })
  lastQuotedAt: Date | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date | null;
}
