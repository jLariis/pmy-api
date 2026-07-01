import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Subsidiary } from './subsidiary.entity';
import { Role } from './role.entity';

@Entity('user')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  @Exclude()
  password: string;

  @Column({ nullable: true })
  name?: string;

  @Column({ nullable: true })
  lastName?: string;

  // Columna varchar (sin enum de BD). Unión alineada con los roles reales usados en
  // código/JWT (incluye la variante histórica 'superamin' y 'subadmin'/'superadmin'/'owner').
  // TRANSICIONAL: convive con la FK `roleId` (tabla `role`) durante la migración RBAC;
  // se deprecará cuando el front/guards usen permisos.
  @Column({ default: 'user' })
  role: 'admin' | 'user' | 'auxiliar' | 'bodega' | 'superadmin' | 'superamin' | 'subadmin' | 'owner';

  @ManyToOne(() => Role, { nullable: true })
  @JoinColumn({ name: 'roleId' })
  roleEntity?: Role;

  @Column({ nullable: true })
  roleId?: string;

  @ManyToOne(() => Subsidiary, { nullable: true })
  @JoinColumn({ name: 'subsidiaryId' })
  subsidiary: Subsidiary;

  @Column({ nullable: true })
  avatar?: string;

  @Column({ nullable: true, default: true })
  active: boolean;

  // ---- Recuperación de contraseña por OTP (autoservicio) ----
  @Column({ nullable: true })
  @Exclude()
  otpCode?: string;

  @Column({ type: 'datetime', nullable: true })
  @Exclude()
  otpExpiresAt?: Date;

  /** Último inicio de sesión exitoso (para auditoría/sesiones). */
  @Column({ type: 'datetime', nullable: true })
  lastLoginAt?: Date;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  updatedAt: Date;

  @BeforeInsert()
  setCreatedAt() {
    this.createdAt = new Date();
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date();
  }
}