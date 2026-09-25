import { Column, DeleteDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { ProductCategory } from './product-category.entity';
import { UnitOfMeasure } from './unit-of-measure.entity';
import { ProductOffer } from './product-offer.entity';

/** Producto comprable (pieza, insumo, servicio o equipo) con sus precios por proveedor. */
@Entity('product')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ManyToOne(() => ProductCategory, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'categoryId' })
  category: ProductCategory | null;

  @Column({ length: 36, nullable: true })
  categoryId: string | null;

  @Column({ length: 100, nullable: true })
  brand: string | null;

  @Column({ length: 100, nullable: true })
  partNumber: string | null;

  @ManyToOne(() => UnitOfMeasure, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'unitId' })
  unit: UnitOfMeasure | null;

  @Column({ length: 36, nullable: true })
  unitId: string | null;

  @Column({ default: true })
  active: boolean;

  @OneToMany(() => ProductOffer, (o) => o.product, { cascade: true })
  offers: ProductOffer[];

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date | null;

  @DeleteDateColumn({ type: 'datetime', nullable: true })
  deletedAt: Date | null;
}
