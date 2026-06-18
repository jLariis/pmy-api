import { Column, Entity, Index, PrimaryGeneratedColumn, BeforeInsert } from 'typeorm';
import {
  AuditAction,
  AuditModule,
  AuditResult,
  AuditSeverity,
} from 'src/common/enums/audit.enum';

/**
 * Registro de auditoría (append-only). No se actualiza ni se borra desde la app.
 */
@Entity('audit_log')
@Index('idx_audit_user_date', ['userId', 'createdAt'])
@Index('idx_audit_module_date', ['module', 'createdAt'])
@Index('idx_audit_entity', ['entityName', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'char', length: 36, nullable: true })
  userId?: string;

  @Column({ nullable: true })
  userEmail?: string;

  @Column({ nullable: true })
  userName?: string;

  @Column({ nullable: true })
  role?: string;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  module: AuditModule;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  action: AuditAction;

  @Index()
  @Column({ type: 'varchar', length: 20, default: AuditResult.SUCCESS })
  result: AuditResult;

  @Column({ type: 'varchar', length: 20, default: AuditSeverity.INFO })
  severity: AuditSeverity;

  @Column({ type: 'varchar', length: 100, nullable: true })
  entityName?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  entityId?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string;

  @Column({ type: 'json', nullable: true })
  beforeState?: Record<string, any>;

  @Column({ type: 'json', nullable: true })
  afterState?: Record<string, any>;

  @Column({ type: 'json', nullable: true })
  changes?: Record<string, { from: any; to: any }>;

  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'varchar', length: 10, nullable: true })
  method?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  path?: string;

  @Column({ type: 'int', nullable: true })
  statusCode?: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  errorMessage?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip?: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent?: string;

  // Info del cliente (enviada por el navegador / derivada): persiste ciudad real,
  // IP pública y "equipo" (navegador+SO + id estable). El hostname real del SO no
  // es accesible desde la web.
  @Column({ type: 'varchar', length: 64, nullable: true })
  publicIp?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  geoCity?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  geoRegion?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  geoCountry?: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  device?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  deviceId?: string;

  @Index()
  @Column({ type: 'char', length: 36, nullable: true })
  subsidiaryId?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  requestId?: string;

  @Column({ type: 'int', nullable: true })
  durationMs?: number;

  @Index()
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @BeforeInsert()
  setCreatedAt() {
    if (!this.createdAt) this.createdAt = new Date();
  }
}
