import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';
import { Permission } from './permission.entity';

export enum PermissionEffect {
  ALLOW = 'allow',
  DENY = 'deny',
}

/**
 * Override de permiso POR USUARIO (permiso especial). Permite conceder (`allow`)
 * o revocar (`deny`) un permiso puntual a un usuario, por encima de lo que da su
 * rol. Permisos efectivos = (permisos del rol) ∪ allow − deny.
 */
@Entity('user_permission')
@Unique(['userId', 'permissionId'])
export class UserPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  permissionId: string;

  @ManyToOne(() => Permission, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permissionId' })
  permission: Permission;

  @Column({ type: 'enum', enum: PermissionEffect, default: PermissionEffect.ALLOW })
  effect: PermissionEffect;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
