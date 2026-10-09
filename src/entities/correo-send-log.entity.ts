import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type SendChannel = 'whatsapp' | 'campana' | 'correo';
export type SendOrigin = 'alerta' | 'subida' | 'manual';
export type SendRecipientType = 'grupo' | 'numero' | 'usuario';

/**
 * Historial de lo que manda el menú Correos (alertas automáticas, aviso de subida y avisos a
 * mano): una fila por destinatario y canal, con quién lo mandó, el texto y si salió.
 */
@Entity('correo_send_log')
@Index('IDX_correo_send_log_created', ['createdAt'])
@Index('IDX_correo_send_log_cons', ['consNumber'])
export class CorreoSendLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'varchar', length: 12 }) channel: SendChannel;
  @Column({ type: 'varchar', length: 12 }) origin: SendOrigin;
  @Column({ type: 'varchar', length: 12 }) recipientType: SendRecipientType;
  /** JID del grupo, número o id del usuario. */
  @Column({ type: 'varchar', length: 120 }) recipientId: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) recipientName: string | null;
  /** null = lo mandó el sistema. */
  @Column({ type: 'varchar', length: 36, nullable: true }) sentById: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) sentByName: string | null;
  @Index() @Column({ type: 'varchar', length: 36, nullable: true }) subsidiaryId: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) consNumber: string | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) inboxMessageId: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) title: string | null;
  @Column({ type: 'text' }) body: string;
  /** enviado · fallido · en_cola (correo: se entregó al servidor de correo, sin confirmación). */
  @Column({ type: 'varchar', length: 12 }) status: 'enviado' | 'fallido' | 'en_cola';
  @Column({ type: 'varchar', length: 500, nullable: true }) error: string | null;
}
