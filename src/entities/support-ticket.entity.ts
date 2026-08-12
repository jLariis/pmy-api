import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { SupportTicketComment } from './support-ticket-comment.entity';
import { SupportTicketAttachment } from './support-ticket-attachment.entity';

export type TicketType = 'mejora' | 'cambio' | 'eliminar' | 'error';
export type TicketStatus =
  | 'pendiente' // "Backlog" en el tablero
  | 'por_hacer'
  | 'en_progreso'
  | 'en_revision'
  | 'completado' // "Hecho" en el tablero
  | 'rechazado';
export type TicketPriority = 'baja' | 'media' | 'alta' | 'urgente';

@Entity('support_ticket')
@Index(['estado'])
@Index(['requesterId'])
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  folio: string; // SUP-0001

  @Column({ type: 'varchar', length: 20 })
  tipo: TicketType;

  @Column({ type: 'varchar', length: 200 })
  titulo: string;

  @Column({ type: 'text' })
  descripcion: string;

  @Column({ type: 'varchar', length: 20, default: 'pendiente' })
  estado: TicketStatus;

  @Column({ type: 'varchar', length: 20, default: 'media' })
  prioridad: TicketPriority;

  // Ubicación (todos opcionales según el tipo)
  @Column({ type: 'varchar', length: 60, nullable: true }) menuPrincipal: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) submenu: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) seccion: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) subseccion: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) nuevoMenu: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) menuError: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) submenuError: string | null;
  @Column({ type: 'text', nullable: true }) pasosReplicar: string | null;

  // Solicitante
  @Column({ type: 'char', length: 36 }) requesterId: string;
  @Column({ type: 'varchar', length: 160, nullable: true }) requesterName: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) requesterEmail: string | null;
  @Column({ type: 'char', length: 36, nullable: true }) subsidiaryId: string | null;

  // Asignación
  @Column({ type: 'char', length: 36, nullable: true }) assigneeId: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) assigneeName: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) assigneeEmail: string | null;

  // SLA
  @Column({ type: 'datetime', nullable: true }) slaDueAt: Date | null;
  /** Umbral de aviso preventivo (createdAt + fracción·SLA, p. ej. 80%). */
  @Column({ type: 'datetime', nullable: true }) slaWarnAt: Date | null;
  /** Marca para no repetir el aviso preventivo (cron). */
  @Column({ type: 'datetime', nullable: true }) slaWarnedAt: Date | null;
  /** Marca para no repetir el aviso de SLA vencido (cron). */
  @Column({ type: 'datetime', nullable: true }) slaNotifiedAt: Date | null;

  // SLA de primera respuesta
  @Column({ type: 'datetime', nullable: true }) firstResponseDueAt: Date | null;
  /** Se sella con la primera acción del agente (comentario o inicio de trabajo). */
  @Column({ type: 'datetime', nullable: true }) firstRespondedAt: Date | null;
  /** Marca para no repetir el aviso de primera respuesta vencida (cron). */
  @Column({ type: 'datetime', nullable: true }) firstResponseNotifiedAt: Date | null;

  // Contexto auto-capturado
  @Column({ type: 'varchar', length: 60, nullable: true }) appVersion: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) route: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) userAgent: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
  @Column({ type: 'datetime', nullable: true }) updatedAt: Date | null;
  @Column({ type: 'datetime', nullable: true }) resolvedAt: Date | null;

  @OneToMany(() => SupportTicketComment, (c) => c.ticket) comentarios: SupportTicketComment[];
  @OneToMany(() => SupportTicketAttachment, (a) => a.ticket) imagenes: SupportTicketAttachment[];
}
