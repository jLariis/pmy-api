import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SupportTicketComment } from './support-ticket-comment.entity';

/** Imagen adjunta a un comentario de soporte (archivo en disco, URL servida). */
@Entity('support_ticket_comment_attachment')
export class SupportTicketCommentAttachment {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => SupportTicketComment, (c) => c.imagenes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'commentId' })
  comment: SupportTicketComment;

  @Column({ type: 'varchar', length: 36 }) commentId: string;
  @Column({ type: 'varchar', length: 260 }) filename: string;
  @Column({ type: 'varchar', length: 400 }) url: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) mime: string | null;
  @Column({ type: 'int', nullable: true }) size: number | null;
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' }) createdAt: Date;
}
