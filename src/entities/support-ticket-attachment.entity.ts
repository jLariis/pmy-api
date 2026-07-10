import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SupportTicket } from './support-ticket.entity';

@Entity('support_ticket_attachment')
export class SupportTicketAttachment {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => SupportTicket, (t) => t.imagenes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: SupportTicket;

  @Column({ type: 'char', length: 36 }) ticketId: string;
  @Column({ type: 'varchar', length: 260 }) filename: string;
  @Column({ type: 'varchar', length: 400 }) url: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) mime: string | null;
  @Column({ type: 'int', nullable: true }) size: number | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
}
