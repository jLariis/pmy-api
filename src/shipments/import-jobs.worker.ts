import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { ImportJob } from '../entities/import-job.entity';
import { ImportJobsService } from './import-jobs.service';

const CLAIM_N = 3;
const STUCK_MIN = 5;
const MAX_ATTEMPTS = 3;

@Injectable()
export class ImportJobsWorker {
  private readonly logger = new Logger(ImportJobsWorker.name);
  private running = false;

  constructor(
    @InjectRepository(ImportJob) private readonly jobRepo: Repository<ImportJob>,
    private readonly dataSource: DataSource,
    private readonly service: ImportJobsService,
  ) {}

  @Cron('*/5 * * * * *') // cada 5s
  async tick(): Promise<void> {
    if (this.running) return; // evita solapamiento en el mismo proceso
    this.running = true;
    try {
      await this.recoverStuck();
      const jobs = await this.claimBatch();
      for (const job of jobs) {
        try {
          if (job.kind === 'master') await this.service.processMasterJob(job);
          else await this.service.processChargeJob(job);
        } catch (e: any) {
          this.logger.error(`Job ${job.id} falló: ${e?.message}`);
          await this.jobRepo.update(job.id, { status: 'failed', error: e?.message ?? 'error', finishedAt: new Date() });
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Claim-token: UPDATE optimista + SELECT (sin SKIP LOCKED, compatible con cualquier MySQL). */
  async claimBatch(): Promise<ImportJob[]> {
    const token = randomUUID();
    await this.dataSource.query(
      `UPDATE import_job SET status='processing', claimToken=?, claimedAt=NOW(), startedAt=COALESCE(startedAt, NOW()), attempts=attempts+1, heartbeatAt=NOW()
       WHERE status='pending' ORDER BY createdAt ASC LIMIT ?`,
      [token, CLAIM_N],
    );
    return this.jobRepo.find({ where: { claimToken: token } });
  }

  /** Re-encola colgados; marca failed los que superan MAX_ATTEMPTS. */
  async recoverStuck(): Promise<void> {
    await this.dataSource.query(
      `UPDATE import_job SET status='pending', claimToken=NULL
       WHERE status='processing' AND heartbeatAt < (NOW() - INTERVAL ? MINUTE) AND attempts < ?`,
      [STUCK_MIN, MAX_ATTEMPTS],
    );
    await this.dataSource.query(
      `UPDATE import_job SET status='failed', error='stuck', finishedAt=NOW()
       WHERE status='processing' AND heartbeatAt < (NOW() - INTERVAL ? MINUTE) AND attempts >= ?`,
      [STUCK_MIN, MAX_ATTEMPTS],
    );
  }
}
