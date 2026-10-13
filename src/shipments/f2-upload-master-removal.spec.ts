jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));
// El parseo del Excel se prueba aparte; aquí solo importa qué hace processFileF2 con las filas.
jest.mock('src/utils/file-upload.utils', () => ({
  ...jest.requireActual('src/utils/file-upload.utils'),
  pickSheetWithHeaders: () => ({ sheet: {}, sheetName: 'F2' }),
  parseDynamicFileF2: () => [{ trackingNumber: 'MASTER1' }, { trackingNumber: 'NUEVA1' }, { trackingNumber: 'RUTA1' }],
}));

import * as XLSX from 'xlsx';
import { ShipmentsService } from './shipments.service';
import { Shipment, ShipmentStatus, ChargeShipment } from 'src/entities';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

/**
 * F2 del MISMO consolidado que el master (Cabo 305823041209, 13-oct-2026): la guía que el master
 * subió como paquete se elimina del master (sin clonar), la carga trae su historial de FedEx y el
 * contador del consolidado no la suma dos veces.
 */
function harness() {
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
          { id: 'ship-master1', trackingNumber: 'MASTER1', paymentId: 'pay-1', hasDispatch: 0, hasIncome: 0 },
          { id: 'ship-ruta1', trackingNumber: 'RUTA1', paymentId: null, hasDispatch: 1, hasIncome: 0 },
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
  const cons = { id: 'cons-1', numberOfPackages: 140 };
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

describe('processFileF2 — guía que el master del mismo consolidado ya subió como paquete', () => {
  it('elimina el paquete del master, pasa su cobro a la carga y no suma doble al consolidado', async () => {
    const h = harness();
    const res: any = await h.svc.processFileF2(h.file, 'sub-cabo', '305823041209', new Date('2026-10-13T00:00:00Z'), 'maria');

    expect(h.deleted).toEqual(['ship-master1']);
    expect(h.queries.some((q) => q.sql.startsWith('UPDATE payment') && q.params[0] && q.params[1] === 'pay-1')).toBe(true);
    // 140 del master + solo la NUEVA (MASTER1 ya estaba contada; RUTA1 se conserva y sí suma).
    expect(h.cons.numberOfPackages).toBe(142);
    expect(res.summary).toMatchObject({ migrated: 1, insertedNew: 2, notFoundInFedex: 1, keptInMaster: 1 });
    expect(res.details.keptInMaster).toEqual([{ tracking: 'RUTA1', reason: 'ya salió a ruta como paquete' }]);
    expect(res.details.notFoundInFedex).toEqual(['NUEVA1']);
  });

  it('guarda el historial de FedEx en la carga (ligado a la carga, no a un paquete) y su id FedEx', async () => {
    const h = harness();
    await h.svc.processFileF2(h.file, 'sub-cabo', '305823041209', new Date('2026-10-13T00:00:00Z'), 'maria');

    const fedexRows = h.savedStatuses.filter((r) => r.notes === 'At local FedEx facility');
    expect(fedexRows).toHaveLength(2); // MASTER1 y RUTA1 (NUEVA1 no existe en FedEx)
    for (const r of fedexRows) {
      expect(r.shipment).toBeNull();
      expect(r.chargeShipment?.id).toMatch(/^cs-/);
    }
    expect(h.updates.find((u) => u.patch.fedexUniqueId === 'uid-MASTER1')).toBeTruthy();
  });
});
