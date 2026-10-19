import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { basename } from 'path';
import { AppRelease } from '../entities/app-release.entity';
import { DeployRun } from '../entities/deploy-run.entity';
import { GitRunner } from './git.runner';
import { deployConfig } from './deploy.config';
import {
  Bump,
  bumpVersion,
  commitToDraftNote,
  compareVersions,
  NoteSource,
  parseCommitSubject,
  parseReleaseNote,
  ReleaseNote,
  suggestBump,
} from './release.util';

const NOTES_DIR = 'release-notes/pending';
const TARGET = 'origin/main';

export interface RepoCommit {
  sha: string;
  subject: string;
  author: string;
  date: string;
}

export interface RepoDiff {
  source: NoteSource;
  dir: string;
  branch: string;
  dirty: boolean;
  headCommit: string;
  targetCommit: string | null;
  /** Commits que main tiene y esta carpeta todavía no (lo que de verdad se desplegaría). */
  pendingCount: number;
  commits: RepoCommit[];
  warnings: string[];
}

export interface DeployPreview {
  currentVersion: string;
  api: RepoDiff;
  web: RepoDiff | null;
  notes: ReleaseNote[];
  noteErrors: string[];
  migrations: string[];
  suggestedBump: Bump;
  nextVersions: Record<Bump, string>;
  /** El servidor ya tiene todo lo de main (no hay que compilar ni reiniciar). */
  serverUpToDate: boolean;
  /** No hay nada que hacer: servidor al día, sin cambios de pantallas y sin novedades. */
  upToDate: boolean;
  canRun: boolean;
  cannotRunReason: string | null;
  running: boolean;
}

/** Lee qué trae main (commits, notas de novedades, migraciones) sin tocar nada. */
@Injectable()
export class DeployAnalysisService {
  private readonly logger = new Logger(DeployAnalysisService.name);

  constructor(
    private readonly git: GitRunner,
    @InjectRepository(AppRelease) private readonly releases: Repository<AppRelease>,
    @InjectRepository(DeployRun) private readonly runs: Repository<DeployRun>,
  ) {}

  async latestRelease(): Promise<AppRelease | null> {
    const all = await this.releases.find();
    if (!all.length) return null;
    return all.sort((a, b) => compareVersions(b.version, a.version))[0];
  }

  async currentVersion(): Promise<string> {
    return (await this.latestRelease())?.version ?? '2.0.0';
  }

  async preview(): Promise<DeployPreview> {
    const cfg = deployConfig();
    const all = await this.releases.find();
    const latest = all.sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
    const published = new Set(all.flatMap((r) => r.publishedNoteIds ?? []));

    const api = await this.readRepo('api', cfg.apiDir, latest?.apiCommit ?? null);
    const web = cfg.webDir ? await this.readRepo('web', cfg.webDir, latest?.webCommit ?? null) : null;

    const notes: ReleaseNote[] = [];
    const noteErrors: string[] = [];
    for (const repo of [api, web]) {
      if (!repo || !repo.targetCommit) continue;
      const files = await this.listNoteFiles(repo.dir);
      for (const file of files) {
        const id = `${repo.source}:${basename(file, '.json')}`;
        if (published.has(id)) continue;
        try {
          const raw = await this.git.git(repo.dir, ['show', `${TARGET}:${file}`]);
          const { note, error } = parseReleaseNote(raw, id, repo.source);
          if (note) notes.push(note);
          else if (error) noteErrors.push(error);
        } catch (e) {
          noteErrors.push(`No se pudo leer la nota ${id}.`);
        }
      }
      const withNote = await this.commitsThatAddedNotes(repo, repo.source === 'api' ? latest?.apiCommit : latest?.webCommit);
      for (const c of repo.commits) {
        if (parseCommitSubject(c.subject).userVisible && !withNote.has(c.sha)) {
          notes.push(commitToDraftNote(c.sha, c.subject, repo.source));
        }
      }
    }

    let migrations: string[] = [];
    if (api.targetCommit) {
      try {
        const out = await this.git.git(api.dir, [
          'diff', '--name-only', '--diff-filter=A', 'HEAD', TARGET, '--', 'src/database/migrations',
        ]);
        migrations = out.split('\n').map((l) => l.trim()).filter(Boolean).map((p) => basename(p).replace(/\.ts$/, ''));
      } catch {
        api.warnings.push('No se pudieron revisar las migraciones nuevas.');
      }
    }

    const currentVersion = latest?.version ?? '2.0.0';
    const running = (await this.runs.count({ where: { status: 'running' } })) > 0;
    const serverUpToDate = !!api.targetCommit && api.pendingCount === 0;
    const upToDate = serverUpToDate && (web?.commits.length ?? 0) === 0 && notes.length === 0;
    let cannotRunReason: string | null = null;
    if (upToDate && !running) cannotRunReason = 'Todo está al día: no hay cambios nuevos que subir.';
    else if (!cfg.enabled) cannotRunReason = 'Las actualizaciones solo se pueden lanzar en el servidor de producción.';
    else if (running) cannotRunReason = 'Ya hay una actualización en curso.';
    else if (api.branch !== 'main') cannotRunReason = `El servidor está en la rama "${api.branch}", no en main.`;
    else if (api.dirty) cannotRunReason = 'Hay cambios hechos a mano en el servidor; hay que revisarlos antes.';
    else if (!api.targetCommit) cannotRunReason = 'No se pudo consultar main en GitHub.';

    return {
      currentVersion,
      api,
      web,
      notes,
      noteErrors,
      migrations,
      suggestedBump: suggestBump(notes),
      nextVersions: {
        patch: bumpVersion(currentVersion, 'patch'),
        minor: bumpVersion(currentVersion, 'minor'),
        major: bumpVersion(currentVersion, 'major'),
      },
      serverUpToDate,
      upToDate,
      canRun: !cannotRunReason,
      cannotRunReason,
      running,
    };
  }

  private async readRepo(source: NoteSource, dir: string, base: string | null): Promise<RepoDiff> {
    const r: RepoDiff = { source, dir, branch: '', dirty: false, headCommit: '', targetCommit: null, pendingCount: 0, commits: [], warnings: [] };
    try {
      r.branch = (await this.git.git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      r.headCommit = (await this.git.git(dir, ['rev-parse', 'HEAD'])).trim();
      r.dirty = (await this.git.git(dir, ['status', '--porcelain', '--untracked-files=no'])).trim().length > 0;
    } catch (e) {
      r.warnings.push(`No se pudo leer la carpeta ${dir}.`);
      return r;
    }
    try {
      await this.git.git(dir, ['fetch', '--quiet', 'origin', 'main']);
    } catch (e) {
      r.warnings.push('No se pudo traer main de GitHub; se muestra lo último descargado.');
      this.logger.warn(`git fetch ${source}: ${(e as Error).message}`);
    }
    try {
      r.targetCommit = (await this.git.git(dir, ['rev-parse', TARGET])).trim();
    } catch {
      r.warnings.push('No existe origin/main en esta carpeta.');
      return r;
    }
    try {
      r.pendingCount = parseInt((await this.git.git(dir, ['rev-list', '--count', `HEAD..${TARGET}`])).trim(), 10) || 0;
    } catch {
      r.pendingCount = 0;
    }
    if (!base) return r; // primera vez: solo notas, no se listan commits viejos
    try {
      const out = await this.git.git(dir, ['log', `${base}..${TARGET}`, '--no-merges', '--format=%H%x1f%s%x1f%an%x1f%aI']);
      r.commits = out
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [sha, subject, author, date] = l.split('\x1f');
          return { sha, subject, author, date };
        });
    } catch {
      r.warnings.push('No se pudo comparar contra la versión anterior.');
    }
    return r;
  }

  private async listNoteFiles(dir: string): Promise<string[]> {
    try {
      const out = await this.git.git(dir, ['ls-tree', '--name-only', `${TARGET}`, `${NOTES_DIR}/`]);
      return out.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.json'));
    } catch {
      return [];
    }
  }

  private async commitsThatAddedNotes(repo: RepoDiff, base: string | null | undefined): Promise<Set<string>> {
    if (!base || !repo.commits.length) return new Set();
    try {
      const out = await this.git.git(repo.dir, [
        'log', `${base}..${TARGET}`, '--format=%H', '--diff-filter=A', '--', NOTES_DIR,
      ]);
      return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
    } catch {
      return new Set();
    }
  }
}
