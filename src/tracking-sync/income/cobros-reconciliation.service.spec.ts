import { CobrosReconciliationService } from './cobros-reconciliation.service';

describe('CobrosReconciliationService', () => {
  it('cuenta guías distintas y devuelve filas ricas (missing/orphan)', async () => {
    const ds: any = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('COUNT(DISTINCT')) return [{ c: 8 }];
        if (sql.includes('i.id IS NULL')) return [
          { trackingNumber: 'A', consNumber: 'CONS1', subsidiary: 'Hermosillo', recipientName: 'Juan', status: 'entregado', date: '2026-08-20T10:00:00Z', deliveredAt: '2026-08-20T12:40:00Z', cost: 50, isF2: 0 },
          { trackingNumber: 'B', consNumber: 'CONS2', subsidiary: 'Obregón', recipientName: 'Ana', status: 'entregado', date: null, deliveredAt: null, cost: 40, isF2: 1 }, // F2 colado
        ];
        if (sql.includes('s.status) <> ')) return [
          { trackingNumber: 'C', consNumber: 'CONS3', subsidiary: 'La Paz', recipientName: 'Luis', status: 'en_ruta', date: '2026-08-19T00:00:00Z', deliveredAt: '2026-08-19T00:00:00Z', cost: 50, isF2: 0 },
        ];
        return [];
      }),
    };
    const r = await new CobrosReconciliationService(ds).reconcile(14);
    expect(r.deliveredShipments).toBe(8);
    expect(r.missingCount).toBe(2);
    expect(r.orphanCount).toBe(1);
    expect(r.missingIncome[0]).toMatchObject({ trackingNumber: 'A', subsidiary: 'Hermosillo', type: 'envio', deliveredAt: '2026-08-20T12:40:00.000Z' });
    expect(r.missingIncome[1].type).toBe('f2'); // el F2 colado queda etiquetado
    expect(r.missingIncome[1].deliveredAt).toBeNull();
    expect(r.orphanIncome[0]).toMatchObject({ trackingNumber: 'C', status: 'en_ruta', type: 'envio' });
  });

  it('sin discrepancias → contadores en 0', async () => {
    const ds: any = { query: jest.fn(async (sql: string) => (sql.includes('COUNT(DISTINCT') ? [{ c: 5 }] : [])) };
    const r = await new CobrosReconciliationService(ds).reconcile();
    expect(r.deliveredShipments).toBe(5);
    expect(r.missingCount).toBe(0);
    expect(r.orphanCount).toBe(0);
  });
});
