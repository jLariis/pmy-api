import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Estado de lectura de notificaciones por usuario. Una fila por usuario con la
 * marca de tiempo de "última lectura": el badge de no leídas se calcula como
 * los eventos notificables en el alcance del usuario con createdAt > lastReadAt.
 */
@Entity('notification_read')
export class NotificationRead {
  @PrimaryColumn({ type: 'char', length: 36 })
  userId: string;

  @Column({ type: 'datetime', nullable: true })
  lastReadAt: Date;
}
