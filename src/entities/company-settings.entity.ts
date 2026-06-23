import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Datos de la empresa (singleton: una sola fila). Antes estaban hardcodeados en
 * la pantalla de Configuración; ahora se persisten porque se usan en encabezados,
 * PDFs y correos.
 */
@Entity('company_settings')
export class CompanySettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: '' })
  name: string;

  /** RFC */
  @Column({ default: '' })
  taxId: string;

  @Column({ default: '' })
  address: string;

  @Column({ default: '' })
  phone: string;

  @Column({ default: '' })
  email: string;

  @Column({ default: '' })
  website: string;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;
}
