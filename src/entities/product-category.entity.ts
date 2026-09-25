import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const PRODUCT_KINDS = ['pieza', 'insumo', 'servicio', 'equipo'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/**
 * Categoría de producto. Las piezas (Balero doble, Bujía iridio…) y los insumos (Aceite, Refrigerante…)
 * son catálogos independientes en pantalla, pero viven aquí distinguidos por `kind`.
 */
@Entity('product_category')
export class ProductCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'enum', enum: PRODUCT_KINDS })
  kind: ProductKind;

  /** Sinónimos separados por coma (para reconocerla en lo que escribe el usuario). */
  @Column({ type: 'text', nullable: true })
  keywords: string | null;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
