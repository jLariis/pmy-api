import { auditShipmentCobros, ShipmentAuditInput } from './cobros-audit.util';

const D = (iso: string) => new Date(iso);
// Semana ISO 35 de 2026: lun 24-ago … dom 30-ago.
const base = (over: Partial<ShipmentAuditInput> = {}): ShipmentAuditInput => ({
  trackingNumber: 'T1', isF2: false, currentStatus: null, events: [], incomes: [], ...over,
});
const ev = (status: string | null, exceptionCode: string | null, iso: string) => ({ status, exceptionCode, timestamp: D(iso) });
const inc = (incomeType: string, nonDeliveryStatus: string, iso: string) => ({ incomeType, nonDeliveryStatus, date: D(iso) });

describe('auditShipmentCobros — regla ENTREGADO', () => {
  it('entregado en la semana con su ingreso → OK (sin hallazgos)', () => {
    const out = auditShipmentCobros(base({
      currentStatus: 'entregado',
      events: [ev('entregado', null, '2026-08-25T10:00:00Z')],
      incomes: [inc('entregado', '', '2026-08-25T10:00:00Z')],
    }));
    expect(out).toEqual([]);
  });

  it('entregado sin ingreso → FALTA (missing entregado)', () => {
    const out = auditShipmentCobros(base({
      currentStatus: 'entregado',
      events: [ev('entregado', null, '2026-08-25T10:00:00Z')],
    }));
    expect(out).toEqual([expect.objectContaining({ rule: 'entregado', discrepancy: 'missing' })]);
  });

  it('ingreso entregado sin entrega y estatus no entregado → SOBRA (extra entregado)', () => {
    const out = auditShipmentCobros(base({
      currentStatus: 'en_ruta',
      events: [],
      incomes: [inc('entregado', '', '2026-08-25T10:00:00Z')],
    }));
    expect(out).toEqual([expect.objectContaining({ rule: 'entregado', discrepancy: 'extra' })]);
  });
});

describe('auditShipmentCobros — regla NO ENTREGADO (07 / DEX08)', () => {
  it('rechazo 07 con su ingreso → OK', () => {
    const out = auditShipmentCobros(base({
      events: [ev('rechazado', '07', '2026-08-25T10:00:00Z')],
      incomes: [inc('no_entregado', '07', '2026-08-25T10:00:00Z')],
    }));
    expect(out).toEqual([]);
  });

  it('rechazo 07 sin ingreso → FALTA', () => {
    const out = auditShipmentCobros(base({
      events: [ev('rechazado', '07', '2026-08-25T10:00:00Z')],
    }));
    expect(out).toEqual([expect.objectContaining({ rule: 'no_entregado', discrepancy: 'missing', subCode: '07' })]);
  });

  it('3 días distintos con 08 en la semana + ingreso → OK', () => {
    const out = auditShipmentCobros(base({
      currentStatus: 'cliente_no_disponible',
      events: [
        ev('cliente_no_disponible', '08', '2026-08-24T10:00:00Z'),
        ev('cliente_no_disponible', '08', '2026-08-25T10:00:00Z'),
        ev('cliente_no_disponible', '08', '2026-08-26T10:00:00Z'),
      ],
      incomes: [inc('no_entregado', '08', '2026-08-26T10:00:00Z')],
    }));
    expect(out).toEqual([]);
  });

  it('3 días distintos con 08 sin ingreso → FALTA (08)', () => {
    const out = auditShipmentCobros(base({
      events: [
        ev('cliente_no_disponible', '08', '2026-08-24T10:00:00Z'),
        ev('cliente_no_disponible', '08', '2026-08-25T10:00:00Z'),
        ev('cliente_no_disponible', '08', '2026-08-26T10:00:00Z'),
      ],
    }));
    expect(out).toEqual([expect.objectContaining({ rule: 'no_entregado', discrepancy: 'missing', subCode: '08' })]);
  });

  it('REVERSO: cobro no_entregado(08) con solo 2 días 08 → SOBRA (DEX08 sin 3 visitas)', () => {
    const out = auditShipmentCobros(base({
      events: [
        ev('cliente_no_disponible', '08', '2026-08-24T10:00:00Z'),
        ev('cliente_no_disponible', '08', '2026-08-25T10:00:00Z'),
      ],
      incomes: [inc('no_entregado', '08', '2026-08-25T10:00:00Z')],
    }));
    expect(out).toEqual([expect.objectContaining({ rule: 'no_entregado', discrepancy: 'extra', subCode: '08' })]);
  });

  it('REVERSO: cobro no_entregado(08) con 3 08 el MISMO día → SOBRA (1 sola visita)', () => {
    const out = auditShipmentCobros(base({
      events: [
        ev('cliente_no_disponible', '08', '2026-08-25T08:00:00Z'),
        ev('cliente_no_disponible', '08', '2026-08-25T13:00:00Z'),
        ev('cliente_no_disponible', '08', '2026-08-25T19:00:00Z'),
      ],
      incomes: [inc('no_entregado', '08', '2026-08-25T19:00:00Z')],
    }));
    expect(out).toEqual([expect.objectContaining({ rule: 'no_entregado', discrepancy: 'extra' })]);
  });

  it('cobro no_entregado justificado por 07 aunque no haya 3 días 08 → OK', () => {
    const out = auditShipmentCobros(base({
      events: [ev('rechazado', '07', '2026-08-25T10:00:00Z')],
      incomes: [inc('no_entregado', '07', '2026-08-25T10:00:00Z')],
    }));
    expect(out).toEqual([]);
  });

  it('doble cobro no_entregado la misma semana → SOBRA', () => {
    const out = auditShipmentCobros(base({
      events: [ev('rechazado', '07', '2026-08-25T10:00:00Z')],
      incomes: [
        inc('no_entregado', '07', '2026-08-25T10:00:00Z'),
        inc('no_entregado', '07', '2026-08-26T10:00:00Z'),
      ],
    }));
    expect(out.filter((f) => f.discrepancy === 'extra')).toHaveLength(1);
  });
});

describe('auditShipmentCobros — F2 se marca', () => {
  it('propaga isF2 en los hallazgos', () => {
    const out = auditShipmentCobros(base({
      isF2: true,
      events: [ev('entregado', null, '2026-08-25T10:00:00Z')],
    }));
    expect(out[0]).toEqual(expect.objectContaining({ isF2: true }));
  });
});

describe('auditShipmentCobros — entregado en bodega', () => {
  it('entregado en bodega sin ingreso → FALTA (missing entregado, dice bodega)', () => {
    const out = auditShipmentCobros(base({
      currentStatus: 'entregado_en_bodega',
      events: [ev('entregado_en_bodega', null, '2026-08-25T20:00:00Z')],
    }));
    expect(out).toEqual([expect.objectContaining({ rule: 'entregado', discrepancy: 'missing' })]);
    expect(out[0].reason).toContain('bodega');
  });

  it('entregado en bodega con su ingreso → OK', () => {
    const out = auditShipmentCobros(base({
      currentStatus: 'entregado_en_bodega',
      events: [ev('entregado_en_bodega', null, '2026-08-25T20:00:00Z')],
      incomes: [inc('entregado', '', '2026-08-25T07:00:00Z')],
    }));
    expect(out).toEqual([]);
  });

  it('entregado en bodega con un DEX08 de 1 visita cobrado → falta entregado y sobra el DEX (se reemplaza)', () => {
    const out = auditShipmentCobros(base({
      currentStatus: 'entregado_en_bodega',
      events: [ev('cliente_no_disponible', '08', '2026-08-24T20:00:00Z'), ev('entregado_en_bodega', null, '2026-08-25T20:00:00Z')],
      incomes: [inc('no_entregado', '08', '2026-08-24T07:00:00Z')],
    }));
    expect(out).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'entregado', discrepancy: 'missing' }),
      expect.objectContaining({ rule: 'no_entregado', discrepancy: 'extra', subCode: '08' }),
    ]));
  });
});
