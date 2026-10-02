import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { Signal } from '../inbox/inbox.types';

/** Una corrida del detector sobre un correo; la vigente es la más reciente. */
@Entity('inbox_detection')
export class InboxDetection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  inboxMessageId: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  subsidiaryId: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 3, default: 0 })
  confidence: string;

  @Column({ type: 'boolean', default: false })
  autoSafe: boolean;

  @Column({ type: 'json' })
  signals: Signal[];

  @Column({ type: 'json', nullable: true })
  runnerUp: { subsidiaryId: string; score: number } | null;

  @Column({ type: 'varchar', length: 500, default: '' })
  reason: string;

  @Column({ type: 'int', default: 1 })
  detectorVersion: number;

  @CreateDateColumn()
  createdAt: Date;
}
