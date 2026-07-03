import { Injectable, Logger } from '@nestjs/common';
import { promises as fsp, createReadStream } from 'fs';
import * as path from 'path';
import type { Response } from 'express';

export type ServerLogKind = 'combined' | 'error';

export interface ServerLogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: string;
}

const POLL_MS = 1000;
const LIVE_TAIL_LINES = 300;
const HISTORICAL_TAIL_LINES = 2000;

/**
 * Lee y "tailea" (casi en tiempo real) los archivos de log que ya escribe
 * Winston (`winston-daily-rotate-file`, ver main.ts): `logs/DD-MM-YYYY-{kind}.log`,
 * uno por día. Usa polling de tamaño de archivo en vez de `fs.watch` (poco
 * confiable, sobre todo en Windows) — suficiente para "casi en tiempo real".
 *
 * Si la fecha pedida es HOY, se comporta como tail en vivo (igual que antes).
 * Si es una fecha pasada, el archivo ya no crece: se manda una sola carga
 * (más generosa) y se cierra la conexión — no tiene sentido "pollear" un
 * archivo que Winston ya no toca.
 */
@Injectable()
export class ServerLogsService {
  private readonly logger = new Logger(ServerLogsService.name);
  private readonly logsDir = path.join(process.cwd(), 'logs');

  private fileForDate(date: Date, kind: ServerLogKind): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
    return path.join(this.logsDir, `${stamp}-${kind}.log`);
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  private parseLine(line: string): ServerLogEntry {
    try {
      const obj = JSON.parse(line);
      return {
        timestamp: obj.timestamp || new Date().toISOString(),
        level: obj.level || 'info',
        message: typeof obj.message === 'string' ? obj.message : JSON.stringify(obj.message),
        context: obj.context,
      };
    } catch {
      return { timestamp: new Date().toISOString(), level: 'info', message: line };
    }
  }

  /** Últimas `maxLines` entradas del archivo de esa fecha + su tamaño actual en bytes. */
  async readTail(kind: ServerLogKind, date: Date, maxLines: number): Promise<{ entries: ServerLogEntry[]; filePath: string; size: number }> {
    const filePath = this.fileForDate(date, kind);
    try {
      const content = await fsp.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const tail = lines.slice(-maxLines);
      return { entries: tail.map((l) => this.parseLine(l)), filePath, size: Buffer.byteLength(content, 'utf8') };
    } catch {
      return { entries: [], filePath, size: 0 };
    }
  }

  /**
   * Escribe el tail inicial. Si `date` es hoy, mantiene la respuesta abierta y
   * sigue escribiendo (NDJSON) cada vez que el archivo crece, hasta que el
   * cliente cierra la conexión. Si `date` es una fecha pasada, escribe la
   * carga histórica y termina la respuesta de una vez.
   */
  streamTo(res: Response, kind: ServerLogKind, date: Date): void {
    const live = this.isSameDay(date, new Date());
    let closed = false;
    let currentFile = this.fileForDate(date, kind);
    let lastSize = 0;

    const writeEntries = (entries: ServerLogEntry[]) => {
      for (const e of entries) {
        if (closed) return;
        res.write(`${JSON.stringify(e)}\n`);
      }
    };

    const readDelta = async () => {
      const expectedFile = this.fileForDate(new Date(), kind); // detecta rollover de medianoche
      if (expectedFile !== currentFile) {
        currentFile = expectedFile;
        lastSize = 0;
      }
      try {
        const stat = await fsp.stat(currentFile);
        if (stat.size > lastSize) {
          const chunk: string = await new Promise((resolve, reject) => {
            let buf = '';
            const rs = createReadStream(currentFile, { start: lastSize, end: stat.size - 1, encoding: 'utf8' });
            rs.on('data', (d) => (buf += d));
            rs.on('end', () => resolve(buf));
            rs.on('error', reject);
          });
          lastSize = stat.size;
          const lines = chunk.split('\n').filter(Boolean);
          writeEntries(lines.map((l) => this.parseLine(l)));
        } else if (stat.size < lastSize) {
          // el archivo se truncó/rotó de forma inesperada; reinicia el offset
          lastSize = 0;
        }
      } catch {
        // el archivo aún no existe (ej. justo después de medianoche); se reintenta en el próximo tick
      }
    };

    this.readTail(kind, date, live ? LIVE_TAIL_LINES : HISTORICAL_TAIL_LINES)
      .then(({ entries, filePath, size }) => {
        if (closed) return;
        currentFile = filePath;
        lastSize = size;
        writeEntries(entries);

        if (!live) {
          res.end();
          return;
        }

        const interval = setInterval(() => {
          readDelta().catch((err) => this.logger.warn(`Error leyendo logs en vivo: ${err?.message}`));
        }, POLL_MS);
        res.on('close', () => {
          closed = true;
          clearInterval(interval);
        });
      })
      .catch((err) => {
        this.logger.warn(`No se pudo leer el tail de logs: ${err?.message}`);
        if (!closed) res.end();
      });
  }
}
