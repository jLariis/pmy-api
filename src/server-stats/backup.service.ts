import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { createGunzip, createGzip } from 'zlib';
import { createReadStream, createWriteStream, promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Response } from 'express';

interface DbTarget {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

/** Fase del restore local y su peso en la barra de progreso global (0–100). */
type Phase = 'connect' | 'download' | 'prepare' | 'restore';
const PHASE_WEIGHTS: Record<Phase, number> = { connect: 5, download: 55, prepare: 5, restore: 35 };
const PHASE_ORDER: Phase[] = ['connect', 'download', 'prepare', 'restore'];

/**
 * Respaldo de la BD de producción hacia el MySQL local (solo desarrollo).
 *
 * - `streamDump`: corre `mysqldump` de la BD conectada y lo entrega comprimido
 *   (`.sql.gz`) en streaming. Lo usa el proceso de PRODUCCIÓN.
 * - `restoreFromProd`: descarga el dump del API de prod (dominio estable) y lo
 *   restaura en el MySQL local, emitiendo progreso NDJSON. SOLO-DEV.
 *
 * La contraseña de la BD viaja por `MYSQL_PWD` a los procesos hijos, nunca en
 * argumentos ni en los logs que se emiten a la UI.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private readonly config: ConfigService) {}

  /** Porcentaje global 0–100 dado la fase actual y su avance interno (0–1). */
  static computePercent(phase: Phase, fraction: number): number {
    const f = Math.min(1, Math.max(0, fraction));
    let base = 0;
    for (const p of PHASE_ORDER) {
      if (p === phase) break;
      base += PHASE_WEIGHTS[p];
    }
    return Math.round(base + PHASE_WEIGHTS[phase] * f);
  }

  /** El restore local solo se permite fuera de producción y con el flag explícito. */
  isRestoreAllowed(): boolean {
    const isProd = (this.config.get<string>('NODE_ENV') || process.env.NODE_ENV) === 'production';
    const flag = this.config.get<string>('BACKUP_ALLOW_RESTORE') || process.env.BACKUP_ALLOW_RESTORE;
    return !isProd && flag === '1';
  }

  status() {
    return {
      canRestore: this.isRestoreAllowed(),
      targetDatabase: this.dbTarget().database,
      prodApiUrl: this.prodApiUrl(),
    };
  }

  private dbTarget(): DbTarget {
    const db = this.config.get<any>('database') || {};
    return {
      host: db.host || process.env.DB_HOST || '127.0.0.1',
      port: Number(db.port || process.env.DB_PORT || 3306),
      username: db.username || process.env.DB_USER || 'root',
      password: db.password ?? process.env.DB_PASSWORD ?? '',
      database: db.database || process.env.DB_NAME || 'pmy-db',
    };
  }

  private prodApiUrl(): string {
    return (
      this.config.get<string>('PROD_API_URL') ||
      process.env.PROD_API_URL ||
      'https://api.paqueteriaymensajeriadelyaqui.com/api'
    );
  }

  private mysqldumpBin(): string {
    return this.config.get<string>('MYSQLDUMP_BIN') || process.env.MYSQLDUMP_BIN || 'mysqldump';
  }

  private mysqlBin(): string {
    return this.config.get<string>('MYSQL_BIN') || process.env.MYSQL_BIN || 'mysql';
  }

  /**
   * Corre `mysqldump` de la BD conectada y transmite la salida comprimida a
   * `res`. `--single-transaction` da consistencia sin bloquear escrituras;
   * `--no-tablespaces` evita necesitar el privilegio PROCESS.
   */
  streamDump(res: Response): void {
    const db = this.dbTarget();
    const args = [
      `--host=${db.host}`,
      `--port=${db.port}`,
      `--user=${db.username}`,
      '--single-transaction',
      '--quick',
      '--routines',
      '--triggers',
      '--events',
      '--no-tablespaces',
      '--default-character-set=utf8mb4',
      db.database,
    ];

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${db.database}-${stamp}.sql.gz"`);
    res.setHeader('Cache-Control', 'no-store');

    const child = spawn(this.mysqldumpBin(), args, {
      env: { ...process.env, MYSQL_PWD: db.password },
    });
    const gzip = createGzip();
    let stderr = '';

    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      this.logger.error(`No se pudo iniciar mysqldump: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ message: `mysqldump no disponible: ${err.message}` });
      else res.destroy(err);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        this.logger.error(`mysqldump salió con código ${code}: ${stderr.slice(0, 500)}`);
        // Los headers ya se enviaron al empezar a transmitir; solo se corta el stream.
        res.destroy(new Error(`mysqldump exit ${code}`));
      }
    });

    child.stdout.pipe(gzip).pipe(res);
  }

  /**
   * Descarga el dump de prod y lo restaura en el MySQL local, emitiendo eventos
   * NDJSON de progreso. Cierra la respuesta al terminar (éxito o error).
   */
  async restoreFromProd(res: Response): Promise<void> {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');

    const emit = (obj: Record<string, unknown>) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
    };
    const step = (key: Phase, message: string) =>
      emit({ type: 'step', key, message, percent: BackupService.computePercent(key, 0) });
    const progress = (phase: Phase, fraction: number, extra: Record<string, unknown> = {}) =>
      emit({ type: 'progress', phase, percent: BackupService.computePercent(phase, fraction), ...extra });
    const log = (stream: 'stdout' | 'stderr', line: string) => emit({ type: 'log', stream, line });

    if (!this.isRestoreAllowed()) {
      // Doble candado: nunca en producción ni sin el flag explícito.
      throw new ForbiddenException('El restore solo está habilitado en desarrollo (BACKUP_ALLOW_RESTORE=1).');
    }

    const secret = this.config.get<string>('BACKUP_SECRET') || process.env.BACKUP_SECRET;
    if (!secret) {
      emit({ type: 'error', message: 'Falta BACKUP_SECRET en el entorno local.' });
      res.end();
      return;
    }

    const db = this.dbTarget();
    const tmpFile = path.join(os.tmpdir(), `pmy-restore-${Date.now()}.sql.gz`);

    try {
      // 1) Conectar y pedir el dump al API de producción (dominio estable).
      step('connect', 'Conectando al API de producción…');
      const url = `${this.prodApiUrl().replace(/\/$/, '')}/server/backup/dump`;
      const resp = await fetch(url, { headers: { 'X-Backup-Secret': secret } });
      if (!resp.ok || !resp.body) {
        throw new Error(`El API de producción respondió ${resp.status} ${resp.statusText}`);
      }

      // 2) Descargar el .sql.gz a un temporal, reportando bytes.
      step('download', 'Descargando respaldo de producción…');
      const totalBytes = Number(resp.headers.get('content-length')) || 0;
      await this.downloadToFile(resp, tmpFile, (bytes) => {
        const fraction = totalBytes ? bytes / totalBytes : 0;
        progress('download', fraction, { bytes, totalBytes: totalBytes || undefined });
      });
      const { size } = await fsp.stat(tmpFile);
      progress('download', 1, { bytes: size, totalBytes: size });

      // 3) Asegurar que la BD local exista.
      step('prepare', `Preparando base de datos local "${db.database}"…`);
      await this.runMysql(
        db,
        undefined,
        [`-e`, `CREATE DATABASE IF NOT EXISTS \`${db.database}\` CHARACTER SET utf8mb4`],
        log,
      );
      progress('prepare', 1);

      // 4) Restaurar: descomprimir el temporal y alimentar el cliente mysql.
      step('restore', 'Restaurando en MySQL local…');
      await this.restoreFile(db, tmpFile, size, (bytes) => {
        progress('restore', size ? bytes / size : 0, { bytes, totalBytes: size });
      }, log);
      progress('restore', 1);

      emit({ type: 'done', message: `Respaldo de producción restaurado en "${db.database}".`, percent: 100 });
    } catch (err: any) {
      this.logger.error(`Restore falló: ${err?.message}`);
      emit({ type: 'error', message: err?.message || 'Error desconocido durante el restore.' });
    } finally {
      await fsp.unlink(tmpFile).catch(() => undefined);
      if (!res.writableEnded) res.end();
    }
  }

  /** Vuelca el body de la respuesta a `file`, invocando `onBytes` con el acumulado. */
  private async downloadToFile(resp: Response | any, file: string, onBytes: (n: number) => void): Promise<void> {
    const out = createWriteStream(file);
    let received = 0;
    const reader = (resp.body as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        onBytes(received);
        if (!out.write(value)) {
          await new Promise<void>((r) => out.once('drain', r));
        }
      }
    } finally {
      out.end();
      await new Promise<void>((r) => out.once('finish', r));
    }
  }

  /** Descomprime `file` y lo pasa por stdin al cliente `mysql` contra `db.database`. */
  private restoreFile(
    db: DbTarget,
    file: string,
    totalGz: number,
    onBytes: (n: number) => void,
    log: (stream: 'stdout' | 'stderr', line: string) => void,
  ): Promise<void> {
    const args = [`--host=${db.host}`, `--port=${db.port}`, `--user=${db.username}`, db.database];
    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.mysqlBin(), args, { env: { ...process.env, MYSQL_PWD: db.password } });
      let read = 0;
      const gz = createReadStream(file);
      gz.on('data', (chunk) => {
        read += chunk.length;
        onBytes(read);
      });
      const gunzip = createGunzip();

      let stderr = '';
      child.stderr.on('data', (d) => {
        const line = d.toString();
        stderr += line;
        this.splitLines(line).forEach((l) => log('stderr', l));
      });
      child.on('error', (err) => reject(new Error(`mysql no disponible: ${err.message}`)));
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`mysql exit ${code}: ${stderr.slice(0, 500)}`))));

      gz.pipe(gunzip).pipe(child.stdin);
      gunzip.on('error', (err) => reject(err));
    });
  }

  /** Corre `mysql` con args arbitrarios (usado para el CREATE DATABASE). */
  private runMysql(
    db: DbTarget,
    input: string | undefined,
    extraArgs: string[],
    log: (stream: 'stdout' | 'stderr', line: string) => void,
  ): Promise<void> {
    const args = [`--host=${db.host}`, `--port=${db.port}`, `--user=${db.username}`, ...extraArgs];
    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.mysqlBin(), args, { env: { ...process.env, MYSQL_PWD: db.password } });
      let stderr = '';
      child.stderr.on('data', (d) => {
        const line = d.toString();
        stderr += line;
        this.splitLines(line).forEach((l) => log('stderr', l));
      });
      child.on('error', (err) => reject(new Error(`mysql no disponible: ${err.message}`)));
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`mysql exit ${code}: ${stderr.slice(0, 500)}`))));
      if (input) child.stdin.end(input);
      else child.stdin.end();
    });
  }

  private splitLines(chunk: string): string[] {
    return chunk.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  }
}
