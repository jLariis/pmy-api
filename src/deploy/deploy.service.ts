import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { AppRelease } from '../entities/app-release.entity';
import { DeployRun } from '../entities/deploy-run.entity';
import { DeployAnalysisService } from './deploy-analysis.service';
import { DeployRunner } from './deploy.runner';
import { deployConfig } from './deploy.config';
import { readLogFrom } from './deploy-log.util';
import { Bump, bumpVersion, ReleaseNote } from './release.util';

const STALE_MS = 30 * 60 * 1000;

interface StatusFile {
  status: 'success' | 'failed';
  step?: string;
  message?: string;
  fromApiCommit?: string;
  toApiCommit?: string;
  durationMs?: number;
}

@Injectable()
export class DeployService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeployService.name);

  constructor(
    private readonly analysis: DeployAnalysisService,
    private readonly runner: DeployRunner,
    @InjectRepository(DeployRun) private readonly runs: Repository<DeployRun>,
    @InjectRepository(AppRelease) private readonly releases: Repository<AppRelease>,
  ) {}

  /** Al arrancar (p. ej. justo después del reinicio del despliegue) cierra los runs terminados. */
  async onApplicationBootstrap() {
    try {
      const running = await this.runs.find({ where: { status: 'running' } });
      for (const r of running) await this.finalizeIfDone(r);
    } catch (e) {
      this.logger.warn(`No se pudieron cerrar despliegues pendientes: ${(e as Error).message}`);
    }
  }

  async status() {
    const running = await this.runs.findOne({ where: { status: 'running' }, order: { startedAt: 'DESC' } });
    return { currentVersion: await this.analysis.currentVersion(), running };
  }

  async start(bump: Bump, notes: ReleaseNote[], userId: string | null): Promise<{ runId: string }> {
    const preview = await this.analysis.preview();
    if (preview.running) throw new ConflictException('Ya hay una actualización en curso.');
    if (!preview.canRun) throw new BadRequestException(preview.cannotRunReason || 'No se puede actualizar ahora.');

    const cfg = deployConfig();
    await fsp.mkdir(cfg.logDir, { recursive: true });
    const id = randomUUID();
    const run = this.runs.create({
      id,
      status: 'running',
      step: 'fetch',
      fromVersion: preview.currentVersion,
      targetVersion: bumpVersion(preview.currentVersion, bump),
      bump,
      notes,
      // Todas las notas de archivo que se revisaron quedan publicadas, aunque se hayan quitado
      // del aviso: así no vuelven a salir en la próxima actualización.
      publishedNoteIds: preview.notes.filter((n) => !n.fromCommit).map((n) => n.id),
      fromApiCommit: preview.api.headCommit || null,
      toApiCommit: null,
      webCommit: preview.web?.targetCommit ?? null,
      startedAt: new Date(),
      startedById: userId,
      logPath: join(cfg.logDir, `${id}.log`),
    });
    await this.runs.save(run);
    try {
      this.runner.launch(cfg.script, [id, cfg.logDir, cfg.apiDir, cfg.pm2Name, cfg.healthUrl]);
    } catch (e) {
      await this.runs.update(id, { status: 'failed', finishedAt: new Date(), error: 'No se pudo iniciar la actualización.' });
      throw new BadRequestException('No se pudo iniciar la actualización.');
    }
    return { runId: id };
  }

  listRuns() {
    return this.runs.find({
      order: { startedAt: 'DESC' },
      take: 20,
      select: ['id', 'status', 'step', 'fromVersion', 'targetVersion', 'bump', 'startedAt', 'finishedAt', 'durationMs', 'startedById', 'error', 'toApiCommit'],
    });
  }

  async readLog(id: string, offset: number) {
    let run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundException('No se encontró esa actualización.');
    if (run.status === 'running') run = await this.finalizeIfDone(run);
    const { events, nextOffset } = await readLogFrom(run.logPath, Math.max(0, offset || 0));
    const { notes, publishedNoteIds, logPath, ...summary } = run;
    return { events, nextOffset, run: summary };
  }

  /** Lee <runId>.status.json; si ya terminó, cierra el run y (si salió bien) publica la versión. */
  private async finalizeIfDone(run: DeployRun): Promise<DeployRun> {
    const statusPath = run.logPath.replace(/\.log$/, '.status.json');
    let st: StatusFile | null = null;
    try {
      st = JSON.parse(await fsp.readFile(statusPath, 'utf8'));
    } catch {
      st = null;
    }
    if (!st) {
      // El script escribe un latido cada 15 s: si la bitácora lleva 30 min sin moverse, se
      // interrumpió. (La hora del archivo no depende de zonas horarias de la BD.)
      const lastActivity = await fsp
        .stat(run.logPath)
        .then((s) => s.mtimeMs)
        .catch(() => new Date(run.startedAt).getTime());
      if (Date.now() - lastActivity > STALE_MS) {
        await this.runs.update(run.id, { status: 'failed', finishedAt: new Date(), error: 'La actualización se interrumpió sin terminar.' });
        return { ...run, status: 'failed', error: 'La actualización se interrumpió sin terminar.' };
      }
      return run;
    }
    const patch: Partial<DeployRun> = {
      status: st.status === 'success' ? 'success' : 'failed',
      step: st.step || run.step,
      finishedAt: new Date(),
      durationMs: st.durationMs ?? null,
      toApiCommit: st.toApiCommit || null,
      error: st.status === 'success' ? null : st.message || 'La actualización falló.',
    };
    await this.runs.update(run.id, patch);
    if (st.status === 'success') {
      const exists = await this.releases.findOne({ where: { version: run.targetVersion } });
      if (!exists) {
        await this.releases.save(
          this.releases.create({
            version: run.targetVersion,
            bump: run.bump,
            notes: run.notes ?? [],
            publishedNoteIds: run.publishedNoteIds ?? [],
            apiCommit: st.toApiCommit || null,
            webCommit: run.webCommit,
            publishedAt: new Date(),
            publishedById: run.startedById,
          }),
        );
        this.logger.log(`Versión ${run.targetVersion} publicada.`);
      }
    }
    return { ...run, ...patch } as DeployRun;
  }
}
