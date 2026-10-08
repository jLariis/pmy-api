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

  it('entregado antes de la ruta y ya corregido (estatus, historial e ingreso) → se marca solo como revisado', () => {
    const dl = ev('2026-09-30T18:05:00.000Z', S.ENTREGADO);
    const d = diagnosePackage(
      base({
        entity: { id: 's1', trackingNumber: '111', kind: 'shipment', status: S.ENTREGADO },
        fedex: { events: [dl], shieldedStatus: S.ENTREGADO, rawStatus: S.ENTREGADO, headerDeliveredAt: null },
        historyRows: [row('2026-09-30T18:05:00.000Z', S.ENTREGADO), row('2026-10-06T15:00:00.000Z', S.EN_RUTA)],
        incomes: [{ id: 'i1', incomeType: IncomeStatus.ENTREGADO, date: new Date('2026-09-30T18:05:00.000Z') }],
      }),
    );
    expect(d.problems).toEqual(['DELIVERED_BEFORE_ROUTE']);
    expect(d.plan).toBeNull();
    expect(d.explanation.join(' ')).toContain('no hay nada que corregir');
  });

  it('entregado antes de la ruta con historial faltante → etiqueta + arreglo', () => {
    const dl = ev('2026-09-30T18:05:00.000Z', S.ENTREGADO);
    const d = diagnosePackage(
      base({
        entity: { id: 's1', trackingNumber: '111', kind: 'shipment', status: S.ENTREGADO },
        fedex: { events: [dl], shieldedStatus: S.ENTREGADO, rawStatus: S.ENTREGADO, headerDeliveredAt: null },
        incomes: [{ id: 'i1', incomeType: IncomeStatus.ENTREGADO, date: new Date('2026-09-30T18:05:00.000Z') }],
      }),
    );
    expect(d.problems).toEqual(['HISTORY_MISSING', 'DELIVERED_BEFORE_ROUTE']);
    expect(d.plan!.insertEvents).toHaveLength(1);
  });
});

describe('diagnosePackage — estatus del CIERRE fuera del día de la ruta (Vía Larga 929567984667)', () => {
  const ROUTE7 = new Date('2026-10-07T00:00:00.000Z'); // routeDate DATE 2026-10-07
  const enRuta = row('2026-10-07T17:09:17.000Z', S.EN_RUTA);
  const dispatch = { routeDate: ROUTE7, createdAt: new Date('2026-10-07T17:09:17.000Z'), is315: false, cost: 59 };

  it('carga entregada al día siguiente: DB ya entregado, el cierre la ve en ruta → se fija entregado para el cierre', () => {
    const dl = ev('2026-10-08T16:02:00.000Z', S.ENTREGADO);
    const d = diagnosePackage({
      entity: { id: 'c1', trackingNumber: '383870018494', kind: 'charge', status: S.ENTREGADO },
      fedex: { events: [dl], shieldedStatus: S.ENTREGADO, rawStatus: S.ENTREGADO, headerDeliveredAt: null },
      historyRows: [enRuta, row('2026-10-08T16:02:00.000Z', S.ENTREGADO)],
      incomes: [],
      dispatch,
      closure: { status: S.EN_RUTA, nextDispatchAt: null },
    });
    expect(d.problems).toEqual(['CLOSURE_STALE']);
    expect(d.closureStatus).toBe(S.EN_RUTA);
    expect(d.plan).toMatchObject({ setStatus: null, insertEvents: [], income: null });
    expect(d.plan!.closure).toEqual({ status: S.ENTREGADO, occurredAt: '2026-10-08T16:02:00.000Z', exceptionCode: null });
    expect(d.explanation.join(' ')).toContain('al día siguiente');
    expect(d.fingerprint).toMatch(/^[0-9a-f]{40}$/);
  });

  it('devuelto tras DEX03 de FedEx al día siguiente: sin "revisar a mano", fija el cierre como devuelto', () => {
    const de = ev('2026-10-08T16:03:00.000Z', S.DIRECCION_INCORRECTA, '03');
    const d = diagnosePackage({
      entity: { id: 'c2', trackingNumber: '877713622069', kind: 'charge', status: S.DEVUELTO_A_FEDEX },
      fedex: { events: [de], shieldedStatus: S.DEVUELTO_A_FEDEX, rawStatus: S.DIRECCION_INCORRECTA, headerDeliveredAt: null },
      historyRows: [enRuta, row('2026-10-08T07:00:00.000Z', S.DEVUELTO_A_FEDEX)],
      incomes: [],
      dispatch,
      closure: { status: S.EN_RUTA, nextDispatchAt: null },
    });
    expect(d.problems).toEqual(['CLOSURE_STALE']);
    expect(d.plan!.setStatus).toBeNull();
    expect(d.plan!.closure!.status).toBe(S.DEVUELTO_A_FEDEX);
  });

  it('el evento es posterior a que la guía salió en otra ruta → no se toca el cierre de esta salida', () => {
    const dl = ev('2026-10-09T20:00:00.000Z', S.ENTREGADO);
    const d = diagnosePackage({
      entity: { id: 'c3', trackingNumber: '999', kind: 'charge', status: S.ENTREGADO },
      fedex: { events: [dl], shieldedStatus: S.ENTREGADO, rawStatus: S.ENTREGADO, headerDeliveredAt: null },
      historyRows: [enRuta, row('2026-10-09T20:00:00.000Z', S.ENTREGADO)],
      incomes: [],
      dispatch,
      closure: { status: S.EN_RUTA, nextDispatchAt: new Date('2026-10-09T17:00:00.000Z') },
    });
    expect(d.problems).not.toContain('CLOSURE_STALE');
    expect(d.plan).toBeNull();
  });

  it('el cierre ya coincide (sucursal con la opción) → nada que corregir', () => {
    const dl = ev('2026-10-08T16:02:00.000Z', S.ENTREGADO);
    const d = diagnosePackage({
      entity: { id: 'c1', trackingNumber: '383870018494', kind: 'charge', status: S.ENTREGADO },
      fedex: { events: [dl], shieldedStatus: S.ENTREGADO, rawStatus: S.ENTREGADO, headerDeliveredAt: null },
      historyRows: [enRuta, row('2026-10-08T16:02:00.000Z', S.ENTREGADO)],
      incomes: [],
      dispatch,
      closure: { status: S.ENTREGADO, nextDispatchAt: null },
    });
    expect(d.problems).toEqual([]);
    expect(d.plan).toBeNull();
  });

  it('el cierre ya muestra el DEX del día de la ruta: la devolución del día siguiente no lo cambia', () => {
    const de = ev('2026-10-07T22:24:00.000Z', S.DIRECCION_INCORRECTA, '03');
    const d = diagnosePackage({
      entity: { id: 'c4', trackingNumber: '878070716817', kind: 'charge', status: S.DEVUELTO_A_FEDEX },
      fedex: { events: [de], shieldedStatus: S.DEVUELTO_A_FEDEX, rawStatus: S.DIRECCION_INCORRECTA, headerDeliveredAt: null },
      historyRows: [enRuta, row('2026-10-07T22:24:00.000Z', S.DIRECCION_INCORRECTA, '03'), row('2026-10-08T07:00:00.000Z', S.DEVUELTO_A_FEDEX)],
      incomes: [],
      dispatch,
      closure: { status: S.DIRECCION_INCORRECTA, nextDispatchAt: null },
    });
    expect(d.problems).toEqual([]);
    expect(d.plan).toBeNull();
  });
});
