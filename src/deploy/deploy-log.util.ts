import { promises as fsp } from 'fs';

const MAX_CHUNK = 512 * 1024;

/**
 * Lee la bitácora NDJSON del despliegue desde `offset` (bytes). Solo consume líneas
 * completas: la última a medias se queda para la siguiente lectura. Así la pantalla
 * puede reconectarse tras el reinicio de la API y seguir donde iba.
 */
export async function readLogFrom(
  path: string,
  offset: number,
): Promise<{ events: Record<string, unknown>[]; nextOffset: number }> {
  let fh: fsp.FileHandle | undefined;
  try {
    fh = await fsp.open(path, 'r');
  } catch {
    return { events: [], nextOffset: offset };
  }
  try {
    const { size } = await fh.stat();
    if (offset >= size) return { events: [], nextOffset: offset };
    const len = Math.min(size - offset, MAX_CHUNK);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, offset);
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl < 0) return { events: [], nextOffset: offset };
    const text = buf.subarray(0, lastNl).toString('utf8');
    const events = text
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => l.length > 0)
      .map((l) => {
        try {
          const v = JSON.parse(l);
          return v && typeof v === 'object' ? v : { type: 'log', line: l };
        } catch {
          return { type: 'log', line: l };
        }
      });
    return { events, nextOffset: offset + lastNl + 1 };
  } finally {
    await fh.close();
  }
}
