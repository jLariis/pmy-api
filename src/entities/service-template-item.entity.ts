import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { decimalTransformer } from 'src/common/transformers/decimal.transformer';
import { ProductCategory } from './product-category.entity';
import { ServiceTemplate } from './service-template.entity';
import { UnitOfMeasure } from './unit-of-measure.entity';

/** Renglón de la receta de un servicio: qué pieza/insumo lleva y cuánto. */
@Entity('service_template_item')
export class ServiceTemplateItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ServiceTemplate, (s) => s.items, { onDelete: 'CASCADE', createForeignKeyConstraints: false, orphanedRowAction: 'delete' })
  @JoinColumn({ name: 'serviceTemplateId' })
  serviceTemplate: ServiceTemplate;

  @Column({ length: 36 })
  serviceTemplateId: string;

  @ManyToOne(() => ProductCategory, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'categoryId' })
  category: ProductCategory;

  @Column({ length: 36 })
  categoryId: string;

  @Column('decimal', { precision: 10, scale: 2, default: 1, transformer: decimalTransformer })
  quantity: number;

  @ManyToOne(() => UnitOfMeasure, { createForeignKeyConstraints: false, nullable: true })
  @JoinColumn({ name: 'unitId' })
  unit: UnitOfMeasure | null;

  @Column({ length: 36, nullable: true })
  unitId: string | null;

  @Column({ default: 0 })
  sortOrder: number;
}
