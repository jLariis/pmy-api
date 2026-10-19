import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { Bump, ReleaseNote } from '../deploy/release.util';

export type DeployRunStatus = 'running' | 'success' | 'failed';

/** Una ejecución del botón "Actualizar" (historial + bitácora en archivo). */
@Entity('deploy_run')
export class DeployRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10 })
  status: DeployRunStatus;

  /** Clave del paso actual o del que falló (fetch|deps|migrate|build|restart|verify). */
  @Column({ type: 'varchar', length: 40, nullable: true })
  step: string | null;

  @Column({ type: 'varchar', length: 20 })
  fromVersion: string;

  @Column({ type: 'varchar', length: 20 })
  targetVersion: string;

  @Column({ type: 'varchar', length: 10 })
  bump: Bump;

  @Column({ type: 'json', nullable: true })
  notes: ReleaseNote[] | null;

  @Column({ type: 'json', nullable: true })
  publishedNoteIds: string[] | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  fromApiCommit: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  toApiCommit: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  webCommit: string | null;

  @Column({ type: 'datetime' })
  startedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  startedById: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'varchar', length: 255 })
  logPath: string;
}
