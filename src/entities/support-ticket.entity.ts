import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { SupportTicketComment } from './support-ticket-comment.entity';
import { SupportTicketAttachment } from './support-ticket-attachment.entity';

export type TicketType = 'mejora' | 'cambio' | 'eliminar' | 'error';
export type TicketStatus = 'pendiente' | 'en_progreso' | 'completado' | 'rechazado';
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
