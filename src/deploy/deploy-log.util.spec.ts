import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readLogFrom } from './deploy-log.util';

describe('readLogFrom', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-log-'));

  it('lee eventos completos y deja la línea a medias para la próxima lectura', async () => {
    const p = join(dir, 'a.log');
    const full = '{"type":"phase","key":"fetch"}\n{"type":"log","line":"hola"}\n';
    writeFileSync(p, full + '{"type":"log","li');
    const r = await readLogFrom(p, 0);
    expect(r.events).toEqual([{ type: 'phase', key: 'fetch' }, { type: 'log', line: 'hola' }]);
    expect(r.nextOffset).toBe(Buffer.byteLength(full));
  });

  it('continúa desde el offset', async () => {
    const p = join(dir, 'b.log');
    const first = '{"type":"log","line":"uno"}\n';
    writeFileSync(p, first + '{"type":"log","line":"dos"}\n');
    const r = await readLogFrom(p, Buffer.byteLength(first));
    expect(r.events).toEqual([{ type: 'log', line: 'dos' }]);
  });

  it('una línea que no es JSON se muestra como texto', async () => {
    const p = join(dir, 'c.log');
    writeFileSync(p, 'npm WARN algo\n');
    const r = await readLogFrom(p, 0);
    expect(r.events).toEqual([{ type: 'log', line: 'npm WARN algo' }]);
  });

  it('offset más allá del archivo o archivo inexistente → nada nuevo', async () => {
    const p = join(dir, 'd.log');
    writeFileSync(p, '{"type":"log","line":"x"}\n');
    expect(await readLogFrom(p, 9999)).toEqual({ events: [], nextOffset: 9999 });
    expect(await readLogFrom(join(dir, 'no-existe.log'), 0)).toEqual({ events: [], nextOffset: 0 });
  });

  it('respeta acentos (bytes multibyte) al calcular el offset', async () => {
    const p = join(dir, 'e.log');
    const first = '{"type":"log","line":"migración"}\n';
    writeFileSync(p, first + '{"type":"log","line":"compilación"}\n');
    const r1 = await readLogFrom(p, 0);
    expect(r1.events).toHaveLength(2);
    const r2 = await readLogFrom(p, Buffer.byteLength(first));
    expect(r2.events).toEqual([{ type: 'log', line: 'compilación' }]);
  });
});
