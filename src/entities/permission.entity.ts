import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Permiso atómico del sistema. El `code` es el identificador estable usado en
 * guards y en el frontend (ej. 'finanzas.gastos', 'administracion.choferes').
 * El catálogo inicial se deriva de `allowed-page-roles.ts` del frontend
 * (acceso por página). Más adelante pueden agregarse permisos de acción.
 */
@Entity('permission')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column()
  name: string;

  /** Agrupador para la UI (ej. 'administracion', 'operaciones', 'finanzas'). */
  @Column({ default: '' })
  groupName: string;

  @Column({ default: '', nullable: true })
  description: string;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
