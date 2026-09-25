import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { decimalTransformer } from 'src/common/transformers/decimal.transformer';
import { ProductCategory } from './product-category.entity';
import { Product } from './product.entity';
import { UnitOfMeasure } from './unit-of-measure.entity';

/** Ficha técnica de la unidad: qué pieza o insumo lleva y cuánto (sugerido al hacer solicitudes). */
@Entity('vehicle_spec_item')
export class VehicleSpecItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 36 })
  vehicleId: string;

  @ManyToOne(() => ProductCategory, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'categoryId' })
  category: ProductCategory;

  @Column({ length: 36 })
  categoryId: string;

  /** Producto preferido (opcional), p. ej. "ACDELCO 10W-30" para el insumo "ACEITE". */
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

  @Column({ length: 300, nullable: true })
  notes: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
