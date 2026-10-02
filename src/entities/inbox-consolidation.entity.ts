import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { Cobro, ConsolidationKind } from '../inbox/inbox.types';

export type InboxLinkStatus = 'pendiente' | 'subido' | 'no_aplica';

/**
 * Consolidado anunciado por correo FedEx. Base del tablero recibido vs subido
 * y, en fases siguientes, de alertas y tareas operativas.
 */
@Entity('inbox_consolidation')
@Index('UQ_inbox_consolidation_cons_kind', ['consNumber', 'kind'], { unique: true })
export class InboxConsolidation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  inboxMessageId: string;

  @Column({ type: 'varchar', length: 30 })
  consNumber: string;

  @Column({ type: 'varchar', length: 15 })
  kind: ConsolidationKind;

  @Index()
  @Column({ type: 'varchar', length: 36, nullable: true })
  subsidiaryId: string | null;

  @Column({ type: 'int', nullable: true })
  announcedCount: number | null;

  @Column({ type: 'json', nullable: true })
  cobros: Cobro[] | null;

  @Index()
  @Column({ type: 'datetime' })
  receivedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  uploadedAt: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  uploadedById: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  uploadedVia: 'manual' | 'auto' | 'correo' | null;

  @Column({ type: 'int', nullable: true })
  uploadMinutes: number | null;

  @Index()
  @Column({ type: 'varchar', length: 12, default: 'pendiente' })
  linkStatus: InboxLinkStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
