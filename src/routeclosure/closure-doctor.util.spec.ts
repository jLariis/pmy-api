import { ShipmentStatusType as S } from 'src/common/enums/shipment-status-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { buildShadowKey } from 'src/tracking-sync/event-key.util';
import { diagnosePackage, DoctorEvent, DoctorInput } from './closure-doctor.util';

const ev = (iso: string, status: S, exceptionCode: string | null = null, vetoed = false): DoctorEvent => {
  const occurredAt = new Date(iso);
  return {
    occurredAt,
    status,
    exceptionCode,
    description: `evento ${status}`,
    location: 'LORETO',
    shadowKey: buildShadowKey(occurredAt.getTime(), exceptionCode, status),
    vetoed,
  };
};

const row = (iso: string, status: S, exceptionCode: string | null = null) => {
  const timestamp = new Date(iso);
  return { status, exceptionCode, timestamp, shadowKey: buildShadowKey(timestamp.getTime(), exceptionCode, status) };
};

// Ruta del 06-oct (Hermosillo). 07:00Z = 00:00 Hermosillo.
const ROUTE = new Date('2026-10-06T15:00:00.000Z');

function base(over: Partial<DoctorInput> = {}): DoctorInput {
  return {
    entity: { id: 's1', trackingNumber: '111', kind: 'shipment', status: S.EN_RUTA },
    fedex: { events: [], shieldedStatus: S.EN_RUTA, rawStatus: S.EN_RUTA, headerDeliveredAt: null },
    historyRows: [row('2026-10-06T15:00:00.000Z', S.EN_RUTA)],
    incomes: [],
    dispatch: { routeDate: ROUTE, createdAt: ROUTE, is315: false, cost: 59 },
    ...over,
  };
}

describe('diagnosePackage', () => {
  it('sin datos de FedEx → solo aviso, sin plan', () => {
    const d = diagnosePackage(base({ fedex: null, fedexError: 'Sin datos en FedEx' }));
    expect(d.problems).toEqual(['WARNING']);
    expect(d.plan).toBeNull();
    expect(d.fingerprint).toBeNull();
  });

  it('Loreto: entregado el 30-sep, ruta del 06-oct → estatus + evento + ingreso fechado 30-sep en semana pasada', () => {
    const dl = ev('2026-09-30T18:05:00.000Z', S.ENTREGADO, null, true); // vetado por pre-registro
    const d = diagnosePackage(
      base({ fedex: { events: [dl], shieldedStatus: S.EN_RUTA, rawStatus: S.ENTREGADO, headerDeliveredAt: null } }),
    );
    expect(d.problems).toEqual(expect.arrayContaining(['STATUS_BEHIND', 'DELIVERED_BEFORE_ROUTE', 'INCOME_MISSING']));
    expect(d.targetStatus).toBe(S.ENTREGADO);
    expect(d.plan!.setStatus).toBe(S.ENTREGADO);
    expect(d.plan!.insertEvents).toHaveLength(1); // el respaldo entra aunque esté vetado
    expect(d.plan!.income).toMatchObject({
      type: 'create',
      incomeType: IncomeStatus.ENTREGADO,
      date: '2026-09-30T18:05:00.000Z',
      cost: 59,
      pastWeek: true,
    });
    expect(d.explanation.join(' ')).toContain('6 días');
    expect(d.fingerprint).toMatch(/^[0-9a-f]{40}$/);
  });

  it('shipment ya ENTREGADO pero sin el evento en historial → solo agrega el evento', () => {
    const dl = ev('2026-10-06T21:32:00.000Z', S.ENTREGADO);
    const d = diagnosePackage(
      base({
        entity: { id: 's1', trackingNumber: '111', kind: 'shipment', status: S.ENTREGADO },
        fedex: { events: [dl], shieldedStatus: S.ENTREGADO, rawStatus: S.ENTREGADO, headerDeliveredAt: null },
        incomes: [{ id: 'i1', incomeType: IncomeStatus.ENTREGADO, date: new Date('2026-10-06T21:32:00.000Z') }],
      }),
    );
    expect(d.problems).toEqual(['HISTORY_MISSING']);
    expect(d.plan!.setStatus).toBeNull();
    expect(d.plan!.insertEvents.map((e) => e.status)).toEqual([S.ENTREGADO]);
    expect(d.plan!.income).toBeNull();
  });

  it('carga F2 entregada → corrige estatus, nunca ingreso', () => {
    const dl = ev('2026-10-06T21:32:00.000Z', S.ENTREGADO);
    const d = diagnosePackage(
      base({
        entity: { id: 'c1', trackingNumber: '222', kind: 'charge', status: S.EN_RUTA },
        fedex: { events: [dl], shieldedStatus: S.ENTREGADO, rawStatus: S.ENTREGADO, headerDeliveredAt: null },
      }),
    );
    expect(d.problems).toEqual(['STATUS_BEHIND']);
    expect(d.plan!.income).toBeNull();
    expect(d.explanation.join(' ')).toContain('no genera ingreso');
  });

  it('ruta 31.5 → sin ingreso', () => {
    const dl = ev('2026-10-06T21:32:00.000Z', S.ENTREGADO);
    const d = diagnosePackage(
      base({
        fedex: { events: [dl], shieldedStatus: S.ENTREGADO, rawStatus: S.ENTREGADO, headerDeliveredAt: null },
        dispatch: { routeDate: ROUTE, createdAt: ROUTE, is315: true, cost: 59 },
      }),
    );
    expect(d.problems).not.toContain('INCOME_MISSING');
    expect(d.plan!.income).toBeNull();
  });

  it('ya tiene ingreso ENTREGADO de otra ruta → no duplica', () => {
    const dl = ev('2026-10-06T21:32:00.000Z', S.ENTREGADO);
    const d = diagnosePackage(
      base({
        fedex: { events: [dl], shieldedStatus: S.ENTREGADO, rawStatus: S.ENTREGADO, headerDeliveredAt: null },
        incomes: [{ id: 'i9', incomeType: IncomeStatus.ENTREGADO, date: new Date('2026-09-20T18:00:00.000Z') }],
      }),
    );
    expect(d.problems).toEqual(['STATUS_BEHIND']);
    expect(d.plan!.income).toBeNull();
  });

  it('DEX del mismo día y FedEx dice entregado → reemplaza el ingreso DEX', () => {
    const dex = ev('2026-10-06T17:00:00.000Z', S.RECHAZADO, '07');
    const dl = ev('2026-10-06T22:00:00.000Z', S.ENTREGADO);
    const d = diagnosePackage(
      base({
        entity: { id: 's1', trackingNumber: '111', kind: 'shipment', status: S.RECHAZADO },
        fedex: { events: [dex, dl], shieldedStatus: S.ENTREGADO, rawStatus: S.ENTREGADO, headerDeliveredAt: null },
        historyRows: [row('2026-10-06T17:00:00.000Z', S.RECHAZADO, '07')],
        incomes: [{ id: 'i2', incomeType: IncomeStatus.NO_ENTREGADO, date: new Date('2026-10-06T17:00:00.000Z') }],
      }),
    );
    expect(d.plan!.income).toMatchObject({ type: 'supersede', incomeId: 'i2', incomeType: IncomeStatus.ENTREGADO });
  });

  it('DEX08 sin 3 visitas en la semana → corrige estatus sin ingreso', () => {
    const e08 = ev('2026-10-06T20:00:00.000Z', S.CLIENTE_NO_DISPONIBLE, '08');
    const d = diagnosePackage(
      base({ fedex: { events: [e08], shieldedStatus: S.CLIENTE_NO_DISPONIBLE, rawStatus: S.CLIENTE_NO_DISPONIBLE, headerDeliveredAt: null } }),
    );
    expect(d.problems).toEqual(['STATUS_BEHIND']);
    expect(d.plan!.income).toBeNull();
  });

  it('estatus final distinto a FedEx → aviso, no se degrada', () => {
    const e07 = ev('2026-10-07T18:00:00.000Z', S.RECHAZADO, '07');
    const d = diagnosePackage(
      base({
        entity: { id: 's1', trackingNumber: '111', kind: 'shipment', status: S.ENTREGADO },
        fedex: { events: [e07], shieldedStatus: S.ENTREGADO, rawStatus: S.RECHAZADO, headerDeliveredAt: null },
        historyRows: [row('2026-10-06T20:00:00.000Z', S.ENTREGADO)],
      }),
    );
    expect(d.problems).toEqual(['WARNING']);
    expect(d.plan).toBeNull();
  });

  it('EN_RUTA y FedEx solo dice EN_BODEGA (escudo) → sin problema', () => {
    const e67 = ev('2026-10-06T14:00:00.000Z', S.EN_BODEGA);
    const d = diagnosePackage(
      base({
        fedex: { events: [e67], shieldedStatus: S.EN_RUTA, rawStatus: S.EN_BODEGA, headerDeliveredAt: null },
      }),
    );
    expect(d.problems).toEqual([]);
    expect(d.plan).toBeNull();
  });

  it('cobrado como entregado pero FedEx dice no entregado → aviso', () => {
    const e07 = ev('2026-10-06T18:00:00.000Z', S.RECHAZADO, '07');
    const d = diagnosePackage(
      base({
        entity: { id: 's1', trackingNumber: '111', kind: 'shipment', status: S.RECHAZADO },
        fedex: { events: [e07], shieldedStatus: S.RECHAZADO, rawStatus: S.RECHAZADO, headerDeliveredAt: null },
        historyRows: [row('2026-10-06T18:00:00.000Z', S.RECHAZADO, '07')],
        incomes: [{ id: 'i1', incomeType: IncomeStatus.ENTREGADO, date: new Date('2026-10-06T18:00:00.000Z') }],
      }),
    );
    expect(d.problems).toEqual(['WARNING']);
  });

  it('la huella es estable para el mismo plan', () => {
    const dl = ev('2026-10-06T21:32:00.000Z', S.ENTREGADO);
    const input = base({ fedex: { events: [dl], shieldedStatus: S.ENTREGADO, rawStatus: S.ENTREGADO, headerDeliveredAt: null } });
    expect(diagnosePackage(input).fingerprint).toBe(diagnosePackage(input).fingerprint);
  });
});
