import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TaskRefType, TaskStatus, TaskStep } from '../daily-tasks/daily-task.types';

/** Estado de un paso de Tareas del día por (sucursal, día, referencia, paso). Lo escribe solo el sistema. */
@Entity('daily_task')
@Index('UQ_daily_task', ['subsidiaryId', 'day', 'refType', 'refId', 'step'], { unique: true })
@Index('IDX_daily_task_sub_day', ['subsidiaryId', 'day'])
export class DailyTask {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) subsidiaryId: string;
  @Column({ type: 'date' }) day: string;
  @Column({ type: 'varchar', length: 12 }) refType: TaskRefType;
  @Column({ type: 'varchar', length: 36 }) refId: string;
  @Column({ type: 'varchar', length: 40, nullable: true }) consNumber: string | null;
  @Column({ type: 'varchar', length: 20 }) step: TaskStep;
  @Column({ type: 'varchar', length: 10 }) status: TaskStatus;
  /** Último estado del que ya se avisó (solo lo mueve el notificador). */
  @Column({ type: 'varchar', length: 10, nullable: true }) notifiedStatus: TaskStatus | null;
  @Column({ type: 'int', default: 0 }) doneCount: number;
  @Column({ type: 'int', default: 0 }) totalCount: number;
  @Column({ type: 'datetime' }) dueAt: Date;
  @Column({ type: 'datetime', nullable: true }) doneAt: Date | null;
  @Column({ type: 'varchar', length: 36, nullable: true }) doneById: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true }) doneByName: string | null;
  @UpdateDateColumn() updatedAt: Date;
}
