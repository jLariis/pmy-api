import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type InboxMessageStatus = 'nuevo' | 'detectado' | 'revision' | 'confirmado' | 'ignorado' | 'error';

/** Correo leído del buzón FedEx (sistemas@). El buzón nunca se modifica. */
@Entity('inbox_message')
@Index('UQ_inbox_message_uid', ['mailbox', 'uidValidity', 'uid'], { unique: true })
export class InboxMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120, default: 'INBOX' })
  mailbox: string;

  @Column({ type: 'bigint' })
  uidValidity: string;

  @Column({ type: 'int' })
  uid: number;

  @Index('UQ_inbox_message_messageId', { unique: true })
  @Column({ type: 'varchar', length: 500 })
  messageId: string;

  @Column({ type: 'varchar', length: 320 })
  fromAddress: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fromName: string | null;

  @Column({ type: 'json', nullable: true })
  toAddresses: string[] | null;

  @Column({ type: 'json', nullable: true })
  ccAddresses: string[] | null;

  @Column({ type: 'varchar', length: 998, default: '' })
  subject: string;

  @Index()
  @Column({ type: 'datetime' })
  receivedAt: Date;

  /** Mensaje superior (sin historial del hilo), texto plano. */
  @Column({ type: 'mediumtext', nullable: true })
  textTop: string | null;

  /** Cuerpo completo en texto plano (con historial). En DHL es lo que se pega en "Importar DHL". */
  @Column({ type: 'mediumtext', nullable: true })
  textBody: string | null;

  /** HTML completo ya sanitizado para mostrar. */
  @Column({ type: 'mediumtext', nullable: true })
  htmlSafe: string | null;

  @Column({ type: 'boolean', default: false })
  hasQuotedHistory: boolean;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'nuevo' })
  status: InboxMessageStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ignoreReason: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Index()
  @Column({ type: 'varchar', length: 36, nullable: true })
  subsidiaryId: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  confirmedById: string | null;

  @Column({ type: 'datetime', nullable: true })
  confirmedAt: Date | null;

  /** ¿Ya están en el sistema las guías del correo? (por guías, no por número) */
  @Index('IDX_inbox_message_coverage')
  @Column({ type: 'varchar', length: 10, nullable: true })
  uploadCoverage: 'ninguno' | 'parcial' | 'completo' | null;

  /** Paquetería: por dominio del remitente o, si es reenvío, del remitente original (ver decideCarrier). */
  @Index('IDX_inbox_message_carrier')
  @Column({ type: 'varchar', length: 10, default: 'fedex' })
  carrier: 'fedex' | 'dhl';

  @Column({ type: 'datetime', nullable: true })
  matchedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
