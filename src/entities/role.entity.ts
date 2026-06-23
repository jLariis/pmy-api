import {
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Permission } from './permission.entity';

/**
 * Rol del sistema. `key` es el identificador estable (ej. 'admin', 'superadmin',
 * 'subadmin', 'auxiliar', 'bodega', 'user') que viaja en el JWT y reemplaza al
 * string suelto `user.role`. `isSystem` protege los roles base de borrado.
 * Los permisos se asignan vía la tabla join `role_permissions`.
 */
@Entity('role')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  key: string;

  @Column()
  name: string;

  @Column({ default: '', nullable: true })
  description: string;

  @Column({ default: false })
  isSystem: boolean;

  @ManyToMany(() => Permission, { cascade: false })
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'roleId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permissionId', referencedColumnName: 'id' },
  })
  permissions: Permission[];

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
