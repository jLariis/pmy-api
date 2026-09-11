// p-limit es ESM puro; lo stubeamos con un limitador SECUENCIAL (concurrencia 1) para
// probar de forma determinista el aborto por cuota (el orden importa).
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => {
    let chain: Promise<any> = Promise.resolve();
    return (fn: any) => {
      const run = chain.then(() => fn());
      chain = run.catch(() => {});
      return run;
    };
  },
}));

import { DhlService } from './dhl.service';

describe('DhlService.trackBatch — aborto por cuota diaria (429)', () => {
  it('al agotarse la cuota (429 sostenido) ABORTA: no intenta las guías restantes', async () => {
    const svc = new DhlService();
    const attempted: string[] = [];
    // La 2ª guía dispara "cuota agotada"; las siguientes NO deben intentarse.
    (svc as any).trackByTrackingNumber = jest.fn(async (tn: string) => {
      attempted.push(tn);
      if (attempted.length === 2) {
        const e: any = new Error('DHL 429 cuota');
        e.dhlQuotaExhausted = true;
        throw e;
      }
      return { queryTrackingNumber: tn, found: true, pieceIds: [] };
    });

    const res = await svc.trackBatch(['a', 'b', 'c', 'd']);

    // Solo se intentaron a y b; c y d se saltaron por el aborto.
    expect(attempted).toEqual(['a', 'b']);
    // Devuelve una entrada por guía (las saltadas como found:false).
    expect(res).toHaveLength(4);
    expect(res[0].found).toBe(true);
    expect(res.slice(1).every((r) => r.found === false)).toBe(true);
  });

  it('un fallo NO-cuota en una guía no aborta el resto', async () => {
    const svc = new DhlService();
    const attempted: string[] = [];
    (svc as any).trackByTrackingNumber = jest.fn(async (tn: string) => {
      attempted.push(tn);
      if (tn === 'b') throw new Error('timeout puntual'); // error normal, sin flag de cuota
      return { queryTrackingNumber: tn, found: true, pieceIds: [] };
    });

    const res = await svc.trackBatch(['a', 'b', 'c']);

    expect(attempted).toEqual(['a', 'b', 'c']); // se intentaron todas
    expect(res.filter((r) => r.found)).toHaveLength(2); // a y c ok, b no
  });
});
