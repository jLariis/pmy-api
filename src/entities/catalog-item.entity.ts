import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Catálogo genérico: una fila por valor de cualquier enum del sistema.
 * `type` = el enum (ej. 'vehicle_type', 'expense_category', 'shipment_status').
 * `key`  = el valor estable que usa el código (ej. 'activo', 'fedex') — NO cambia.
 * `label`= cómo se muestra (editable). `isSystem` protege los valores del código
 * (no se pueden borrar; sí editar etiqueta/orden/activo). Los valores agregados
 * por el usuario (isSystem=false) solo se pueden borrar si NO están en uso en BD.
 */
@Entity('catalog_item')
@Unique(['type', 'key'])
export class CatalogItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  type: string;

  @Column()
  key: string;

  @Column()
  label: string;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ default: true })
  active: boolean;

  @Column({ default: false })
  isSystem: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
