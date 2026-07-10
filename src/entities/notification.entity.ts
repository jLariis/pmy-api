import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type NotificationCategory = 'operacion' | 'soporte' | 'sesion' | 'sistema';
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

/**
 * Notificación dirigida (una fila por destinatario). El feed de la campana se
 * arma leyendo estas filas para el usuario. Difusiones (p.ej. "alguien registró
 * un consolidado en tu sucursal") se expanden a N filas al emitir.
 */
@Entity('notification')
@Index(['recipientId', 'read'])
@Index(['recipientId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  recipientId: string;

  @Column({ type: 'varchar', length: 80 })
  type: string;

  @Column({ type: 'varchar', length: 20, default: 'operacion' })
  category: NotificationCategory;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  icon: string | null;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  severity: NotificationSeverity;

  @Column({ type: 'varchar', length: 300, nullable: true })
  link: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  subsidiaryId: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  actorName: string | null;

  @Column({ type: 'boolean', default: false })
  read: boolean;

  @Column({ type: 'datetime', nullable: true })
  readAt: Date | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
