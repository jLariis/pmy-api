import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { decimalTransformer } from 'src/common/transformers/decimal.transformer';
import { ProductCategory } from './product-category.entity';
import { Product } from './product.entity';
import { UnitOfMeasure } from './unit-of-measure.entity';

export const NEED_SOURCES = ['receta', 'ficha', 'palabra', 'manual'] as const;
export type NeedSource = (typeof NEED_SOURCES)[number];

/**
 * "Lo que se necesita" de una solicitud: pieza/insumo propuesto por la receta del servicio, la ficha de
 * la unidad o lo que escribió el usuario (o agregado a mano por Compras). Se conserva entre visitas.
 */
@Entity('request_need')
export class RequestNeed {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 36 })
  requestId: string;

  @ManyToOne(() => ProductCategory, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'categoryId' })
  category: ProductCategory;

  @Column({ length: 36 })
  categoryId: string;

  /** Producto preferido (de la ficha de la unidad). */
  @ManyToOne(() => Product, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'productId' })
  product: Product | null;

  @Column({ length: 36, nullable: true })
  productId: string | null;

  @Column('decimal', { precision: 10, scale: 2, default: 1, transformer: decimalTransformer })
  quantity: number;

  @ManyToOne(() => UnitOfMeasure, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'unitId' })
  unit: UnitOfMeasure | null;

  @Column({ length: 36, nullable: true })
  unitId: string | null;

  @Column({ type: 'enum', enum: NEED_SOURCES })
  source: NeedSource;

  @Column({ length: 200 })
  sourceLabel: string;

  @Column({ default: false })
  dismissed: boolean;

  /** Partida elegida en el comparativo (como en los renglones de la solicitud). */
  @Column({ length: 36, nullable: true })
  selectedQuoteItemId: string | null;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
