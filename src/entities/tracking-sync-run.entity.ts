import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Una fila por corrida del orquestador de sincronización (métricas). */
@Entity('tracking_sync_run')
export class TrackingSyncRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'datetime' })
  startedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'varchar', length: 16, default: 'shadow' })
  mode: string;

  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({ type: 'int', default: 0 })
  ok: number;

  @Column({ type: 'int', default: 0 })
  noData: number;

  @Column({ type: 'int', default: 0 })
  failed: number;

  @Column({ default: false })
  aborted: boolean;

  @Column({ type: 'int', default: 0 })
  matchesLegacy: number;

  @Column({ type: 'int', default: 0 })
  divergesLegacy: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
