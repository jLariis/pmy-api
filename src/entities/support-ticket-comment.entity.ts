import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SupportTicket } from './support-ticket.entity';

@Entity('support_ticket_comment')
export class SupportTicketComment {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => SupportTicket, (t) => t.comentarios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: SupportTicket;

  @Column({ type: 'varchar', length: 36 }) ticketId: string;
  @Column({ type: 'char', length: 36, nullable: true }) authorId: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) authorName: string | null;
  @Column({ type: 'text' }) texto: string;
  @Column({ type: 'boolean', default: false }) internal: boolean;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
}
