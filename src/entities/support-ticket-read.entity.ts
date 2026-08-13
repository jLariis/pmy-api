import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Marca de lectura de un ticket por usuario: cuándo lo vio por última vez.
 * Sirve para saber, en el tablero, si un ticket tiene comentarios NUEVOS
 * (posteriores a `lastViewedAt`) para ese usuario.
 */
@Entity('support_ticket_read')
@Index(['userId', 'ticketId'], { unique: true })
export class SupportTicketRead {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'char', length: 36 }) userId: string;
  @Column({ type: 'varchar', length: 36 }) ticketId: string;
  @Column({ type: 'datetime' }) lastViewedAt: Date;
}
