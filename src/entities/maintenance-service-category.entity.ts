import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Categoría del catálogo de servicios de mantenimiento (editable desde la UI). */
@Entity('maintenance_service_category')
export class MaintenanceServiceCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100, unique: true })
  name: string;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
