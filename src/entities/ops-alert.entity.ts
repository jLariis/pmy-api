import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { OpsStep } from '../ops-alerts/ops-alerts.util';

/** Configuración global de alertas operativas (una sola fila). */
@Entity('ops_alert_settings')
export class OpsAlertSettings {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'boolean', default: false }) enabled: boolean;
  @Column({ type: 'int', default: 30 }) uploadMinutes: number;
  @Column({ type: 'varchar', length: 5, default: '21:00' }) unloadingTime: string;
  @Column({ type: 'varchar', length: 5, default: '10:00' }) dispatchTime: string;
  @Column({ type: 'varchar', length: 5, default: '21:00' }) closureTime: string;
  @Column({ type: 'varchar', length: 5, default: '19:00' }) inventoryTime: string;
  @Column({ type: 'int', default: 30 }) escalate1Min: number;
  @Column({ type: 'int', default: 60 }) escalate2Min: number;
  @Column({ type: 'int', default: 100 }) completePct: number;
  @Column({ type: 'int', default: 3 }) lookbackDays: number;
  @Column({ type: 'varchar', length: 5, default: '06:00' }) activeFrom: string;
  @Column({ type: 'varchar', length: 5, default: '21:30' }) activeTo: string;
  /** Cuándo se prendieron: lo que ya venía vencido antes no se avisa (solo se muestra). */
  @Column({ type: 'datetime', nullable: true }) enabledAt: Date | null;
  /** WhatsApp a grupos cuando alguien sube guías desde la bandeja de correos. */
  @Column({ type: 'boolean', default: true }) uploadNotifyEnabled: boolean;
  @Column({ type: 'json', nullable: true }) uploadNotifyGroups: { id: string; name: string }[] | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) updatedById: string | null;
  @UpdateDateColumn() updatedAt: Date;
}

/** Por sucursal: qué pasos aplican, encargados y a dónde va el WhatsApp. */
@Entity('ops_alert_subsidiary')
export class OpsAlertSubsidiary {
  @PrimaryColumn({ type: 'varchar', length: 36 }) subsidiaryId: string;
  @Column({ type: 'boolean', default: true }) stepUpload: boolean;
  @Column({ type: 'boolean', default: true }) stepUnloading: boolean;
  @Column({ type: 'boolean', default: true }) stepDispatch: boolean;
  @Column({ type: 'boolean', default: true }) stepClosure: boolean;
  @Column({ type: 'boolean', default: true }) stepInventory: boolean;
  @Column({ type: 'json', nullable: true }) managerUserIds: string[] | null;
  @Column({ type: 'json', nullable: true }) whatsappNumbers: string[] | null;
  @Column({ type: 'json', nullable: true }) whatsappGroups: { id: string; name: string }[] | null;
  @UpdateDateColumn() updatedAt: Date;
}

/** Una alerta por paso y consolidado (o por sucursal y día en inventario). */
@Entity('ops_alert')
@Index('UQ_ops_alert_step_ref', ['step', 'refKey'], { unique: true })
export class OpsAlert {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) subsidiaryId: string;
  @Column({ type: 'varchar', length: 12 }) step: OpsStep;
  /** inbox_consolidation.id, o `<subsidiaryId>:<día>` para inventario. */
  @Column({ type: 'varchar', length: 80 }) refKey: string;
  @Column({ type: 'varchar', length: 36, nullable: true }) inboxConsolidationId: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) consNumber: string | null;
  @Column({ type: 'datetime' }) dueAt: Date;
  /** Último nivel avisado: 0 ninguno · 1 vencido · 2 encargado · 3 supervisión. */
  @Column({ type: 'tinyint', default: 0 }) level: number;
  @Column({ type: 'datetime', nullable: true }) notifiedAt: Date | null;
  @Column({ type: 'int', default: 0 }) progressPct: number;
  @Column({ type: 'datetime', nullable: true }) resolvedAt: Date | null;
  @Column({ type: 'int', nullable: true }) lateMinutes: number | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
