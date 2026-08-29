import { Column, Entity, Index, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type ImportJobStatus = 'pending' | 'processing' | 'done' | 'partial' | 'failed';
export type ImportJobKind = 'master' | 'charge';
export type ImportJobSource = 'paste' | 'retry';

@Entity('import_job')
@Index('IDX_import_job_status_created', ['status', 'createdAt'])
@Index('IDX_import_job_idem', ['subsidiaryId', 'kind', 'consNumber', 'payloadHash', 'createdAt'])
export class ImportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  kind: ImportJobKind;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: ImportJobStatus;

  @Column({ type: 'varchar', length: 16, default: 'paste' })
  source: ImportJobSource;

  @Column({ type: 'varchar', length: 36 })
  subsidiaryId: string;

  @Column({ type: 'varchar', length: 255 })
  consNumber: string;

  @Column({ type: 'datetime', nullable: true })
  consDate: Date | null;

  @Column({ type: 'boolean', default: false })
  isAereo: boolean;

  @Column({ type: 'boolean', default: false })
  isHalfTon: boolean;

  @Column({ type: 'boolean', default: false })
  notRemoveCharge: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  label: string | null;

  @Column({ type: 'varchar', length: 64 })
  payloadHash: string;

  @Column({ type: 'longtext' })
  payloadRows: string; // JSON.stringify(CanonicalRow[])

  @Column({ type: 'longtext', nullable: true })
  onlyTrackings: string | null; // JSON.stringify(string[])

  @Column({ type: 'varchar', length: 36, nullable: true })
  parentJobId: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  claimToken: string | null;

  @Column({ type: 'int', default: 0 })
  totalRows: number;

  @Column({ type: 'int', default: 0 })
  processedRows: number;

  @Column({ type: 'int', default: 0 })
  saved: number;

  @Column({ type: 'int', default: 0 })
  duplicated: number;

  @Column({ type: 'int', default: 0 })
  recycled: number;

  @Column({ type: 'int', default: 0 })
  failed: number;

  @Column({ type: 'int', default: 0 })
  hvMarked: number;

  @Column({ type: 'int', default: 0 })
  cobrosApplied: number;

  @Column({ type: 'int', default: 0 })
  cobrosUnmatched: number;

  @Column({ type: 'longtext', nullable: true })
  result: string | null; // JSON.stringify(ImportJobResult)

  @Column({ type: 'varchar', length: 36, nullable: true })
  consolidatedId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'datetime', nullable: true })
  claimedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  heartbeatAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdById: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  createdByName: string | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}
