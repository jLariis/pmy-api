import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { ServiceTemplateItem } from './service-template-item.entity';

/**
 * Servicio predefinido de mantenimiento ("Servicio de 10,000 km", "Cambio de balatas"…). La receta de
 * piezas/insumos es OPCIONAL; los sinónimos sirven para reconocerlo en lo que escribe el usuario.
 */
@Entity('service_template')
export class ServiceTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 150 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Tipo de unidad al que aplica (null = cualquiera). */
  @Column({ length: 50, nullable: true })
  vehicleType: string | null;

  /** Sinónimos separados por coma. */
  @Column({ type: 'text', nullable: true })
  keywords: string | null;

  @Column({ default: true })
  active: boolean;

  @OneToMany(() => ServiceTemplateItem, (i) => i.serviceTemplate, { cascade: true })
  items: ServiceTemplateItem[];

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date | null;
}
