jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));
// El parseo del Excel se prueba aparte; aquí solo importa qué hace processFileF2 con las filas.
jest.mock('src/utils/file-upload.utils', () => ({
  ...jest.requireActual('src/utils/file-upload.utils'),
  pickSheetWithHeaders: () => ({ sheet: {}, sheetName: 'F2' }),
  parseDynamicFileF2: () => [{ trackingNumber: 'MASTER1' }, { trackingNumber: 'NUEVA1' }, { trackingNumber: 'RUTA1' }, { trackingNumber: 'VIEJA1' }],
}));

import * as XLSX from 'xlsx';
import { ShipmentsService } from './shipments.service';
import { Shipment, ShipmentStatus, ChargeShipment } from 'src/entities';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

/**
 * F2 que llega después del master con OTRO consolidado (el del correo; YAQUI, 28-oct-2026): la
 * guía que el master subió HOY como paquete se elimina del master (sin clonar), la carga trae su
 * historial de FedEx y los contadores de ambos consolidados cuadran. Lo de días anteriores no se toca.
 */
function harness(opts: { masterConsId?: string } = {}) {
  const masterConsId = opts.masterConsId ?? 'cons-master';
  const today = new Date();
  const yesterday = new Date(today.getTime() - 36 * 3600_000);
  const deleted: string[] = [];
  const queries: { sql: string; params: any[] }[] = [];
  const savedStatuses: any[] = [];
  const updates: any[] = [];
  let csSeq = 0;
  const manager: any = {
    findOne: jest.fn(async () => ({ id: 'sub-cabo', name: 'Cabo San Lucas' })),
    save: jest.fn(async (a: any, b?: any) => {
      const data = b ?? a;
      if (a === ShipmentStatus) savedStatuses.push(...(Array.isArray(data) ? data : [data]));
      if (data && data.trackingNumber && !data.id && a !== ShipmentStatus) return { ...data, id: `cs-${++csSeq}` };
      return data;
    }),
    update: jest.fn(async (_e: any, id: string, patch: any) => updates.push({ id, patch })),
    delete: jest.fn(async (entity: any, id: string) => { if (entity === Shipment) deleted.push(id); }),
    query: jest.fn(async (sql: string, params: any[]) => {
      queries.push({ sql, params });
      if (sql.includes('FROM shipment s')) {
        return [
          { id: 'ship-master1', trackingNumber: 'MASTER1', paymentId: 'pay-1', consolidatedId: masterConsId, status: 'pendiente', createdAt: today, hasDispatch: 0, hasIncome: 0 },
          { id: 'ship-ruta1', trackingNumber: 'RUTA1', paymentId: null, consolidatedId: masterConsId, status: 'en_ruta', createdAt: today, hasDispatch: 1, hasIncome: 0 },
          { id: 'ship-vieja1', trackingNumber: 'VIEJA1', paymentId: null, consolidatedId: 'cons-viejo', status: 'pendiente', createdAt: yesterday, hasDispatch: 0, hasIncome: 0 },
        ];
      }
      if (sql.startsWith('SELECT id FROM payment')) return [{ id: 'pay-1' }];
      return [];
    }),
  };
  const queryRunner: any = {
    connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(), release: jest.fn(), manager,
  };

  const svc = Object.create(ShipmentsService.prototype) as any;
  svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  svc.dataSource = { createQueryRunner: () => queryRunner };
  svc.consolidatedService = { assertNotInOtherSubsidiary: jest.fn() };
  svc.holidaysService = { getHolidayInputs: jest.fn(async () => []) };
  svc.chargeShipmentRepository = { create: (x: any) => x };
  svc.shipmentStatusRepository = { create: (x: any) => x };
  svc.incomeRepository = { create: (x: any) => x };
  svc.findOrCreateCharge = jest.fn(async () => ({ charge: { id: 'charge-1', numberOfPackages: 0 }, created: false }));
  svc.findExistingChargeTrackings = jest.fn(async () => new Set());
  const cons = { id: opts.masterConsId ?? 'cons-f2', numberOfPackages: opts.masterConsId ? 140 : 0 };
  svc.findOrCreateChargeConsolidated = jest.fn(async () => cons);
  svc.fedexService = {
    trackPackage: jest.fn(async (tn: string) => tn === 'NUEVA1'
      ? { output: { completeTrackResults: [{ trackResults: [{ error: { code: 'TRACKING.TRACKINGNUMBER.NOTFOUND' } }] }] } }
      : { output: { completeTrackResults: [{ trackResults: [{
          trackingNumberInfo: { trackingNumberUniqueId: `uid-${tn}`, carrierCode: 'FDXE' },
          scanEvents: [{ date: '2026-10-12T14:49:00-07:00', eventType: 'AR', derivedStatusCode: 'IT', eventDescription: 'At local FedEx facility' }],
        }] }] } }),
  };
  svc.processFedexScanEventsToStatusesResp = jest.fn(async (events: any[], s: any) =>
    events.map((e) => ({ status: ShipmentStatusType.EN_TRANSITO, timestamp: new Date(e.date), notes: e.eventDescription, shipment: s })));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Tracking'], ['MASTER1']]), 'F2');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { svc, cons, deleted, queries, savedStatuses, updates, file: { buffer } as any };
}

describe('processFileF2 — guía que el master subió hoy como paquete (F2 con otro consolidado)', () => {
  it('elimina del master solo el paquete de hoy, pasa su cobro a la carga y cuadra ambos contadores', async () => {
    const h = harness();
    const res: any = await h.svc.processFileF2(h.file, 'sub-yaqui', '305900000001', new Date(), 'maria');

    // Sin exigir el mismo consolidado del master.
    const lookup = h.queries.find((q) => q.sql.includes('FROM shipment s'))!;
    expect(lookup.sql).not.toContain('consNumber');
    expect(h.deleted).toEqual(['ship-master1']); // VIEJA1 (ayer) y RUTA1 (ya en ruta) se quedan
    expect(h.queries.some((q) => q.sql.startsWith('UPDATE payment') && q.params[0] && q.params[1] === 'pay-1')).toBe(true);
    // El consolidado del master pierde la guía que pasó a carga; el del F2 cuenta todas sus guías.
    expect(h.queries.find((q) => q.sql.startsWith('UPDATE consolidated'))?.params).toEqual([1, 'cons-master']);
    expect(h.cons.numberOfPackages).toBe(4);
    expect(res.summary).toMatchObject({ migrated: 1, insertedNew: 3, notFoundInFedex: 1, keptInMaster: 1 });
    expect(res.details.keptInMaster).toEqual([{ tracking: 'RUTA1', reason: 'ya salió a ruta como paquete' }]);
    expect(res.details.notFoundInFedex).toEqual(['NUEVA1']);
  });

  it('si el F2 cae en el mismo consolidado del master, no cuenta dos veces la guía migrada', async () => {
    const h = harness({ masterConsId: 'cons-same' });
    await h.svc.processFileF2(h.file, 'sub-yaqui', '305900000001', new Date(), 'maria');

    expect(h.queries.some((q) => q.sql.startsWith('UPDATE consolidated'))).toBe(false);
    expect(h.cons.numberOfPackages).toBe(143); // 140 + NUEVA1, RUTA1, VIEJA1 (MASTER1 ya estaba)
  });

  it('guarda el historial de FedEx en la carga (ligado a la carga, no a un paquete) y su id FedEx', async () => {
    const h = harness();
    await h.svc.processFileF2(h.file, 'sub-yaqui', '305900000001', new Date(), 'maria');

    const fedexRows = h.savedStatuses.filter((r) => r.notes === 'At local FedEx facility');
    expect(fedexRows).toHaveLength(3); // MASTER1, RUTA1 y VIEJA1 (NUEVA1 no existe en FedEx)
    for (const r of fedexRows) {
      expect(r.shipment).toBeNull();
      expect(r.chargeShipment?.id).toMatch(/^cs-/);
    }
    expect(h.updates.find((u) => u.patch.fedexUniqueId === 'uid-MASTER1')).toBeTruthy();
  });
});
