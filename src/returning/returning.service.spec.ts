// p-limit es ESM puro y jest no transforma node_modules; lo stubeamos porque la cadena de
// imports de ReturningService lo arrastra (vía DevolutionsService → ShipmentsService).
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { ReturningService } from './returning.service';
import { ReturningHistory } from 'src/entities/returning-history.entity';

/**
 * Bug reportado: "las devoluciones salen con fecha de un día anterior" (elijo 20/ago y la
 * salida aparece con 19/ago en el Historial de Salidas).
 *
 * Causa raíz: la fecha viene de un <input type="date"> como día-calendario flotante
 * ("2026-08-20"). El backend hacía `new Date("2026-08-20")`, que JS interpreta como
 * MEDIANOCHE UTC (00:00Z). Guardado en UTC y pintado en Hermosillo (UTC-7) retrocede al
 * día anterior. La corrección ancla ese día a la medianoche de Hermosillo (= 07:00Z),
 * igual que el resto del sistema (ingresos/KPIs/traslados).
 */
describe('ReturningService.create — fecha de la Salida anclada a Hermosillo', () => {
  function makeHarness() {
    const saved: any[] = [];
    const manager = {
      create: jest.fn((entity: any, data: any) => ({ __entity: entity, ...data })),
      save: jest.fn((e: any) => {
        saved.push(e);
        return Promise.resolve(e);
      }),
    };
    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager,
    };

    const svc = Object.create(ReturningService.prototype) as any;
    svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.dataSource = { createQueryRunner: () => queryRunner };
    svc.devolutionsService = { processOneDevolution: jest.fn().mockResolvedValue('success') };
    svc.collectionsService = { saveCollectionsWithManager: jest.fn() };

    return { svc, saved };
  }

  function capturedHistory(saved: any[]): any {
    return saved.find((e) => e.__entity === ReturningHistory);
  }

  it('día-calendario "2026-08-20" -> se guarda a 07:00Z (medianoche de Hermosillo), NO a 00:00Z', async () => {
    const { svc, saved } = makeHarness();

    await svc.create(
      {
        subsidiaryId: 'SUB-1',
        date: '2026-08-20',
        devolutions: [{ trackingNumber: 'T1', reason: '03' }],
      },
      'user-1',
    );

    const history = capturedHistory(saved);
    expect(history.date instanceof Date).toBe(true);
    // El instante guardado, visto en Hermosillo, debe seguir siendo el 20 (no el 19).
    expect(history.date.toISOString()).toBe('2026-08-20T07:00:00.000Z');
  });

  it('sin fecha (usuario no eligió día) -> usa el instante actual, sin anclar', async () => {
    const { svc, saved } = makeHarness();
    const before = Date.now();

    await svc.create(
      {
        subsidiaryId: 'SUB-1',
        devolutions: [{ trackingNumber: 'T1', reason: '03' }],
      },
      'user-1',
    );

    const history = capturedHistory(saved);
    expect(history.date instanceof Date).toBe(true);
    expect(history.date.getTime()).toBeGreaterThanOrEqual(before);
  });
});
