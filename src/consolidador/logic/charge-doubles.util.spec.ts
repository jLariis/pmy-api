import { detectChargeDoubles } from './charge-doubles.util';

const week = { from: '2026-10-12', to: '2026-10-18' };
const guide = (tn: string) => ({
  chargeShipmentId: `cs-${tn}`, trackingNumber: tn, chargeId: 'ch1', consNumber: '305824072785',
  chargeDay: '2026-10-16', uploadedAt: '2026-10-16T08:30:00', uploadedBy: 'Maria Manzanilla',
});
const twin = (tn: string, consDay: string | null, id = `s-${tn}`) => ({
  shipmentId: id, trackingNumber: tn, consNumber: '305823741300', consDay, createdAt: '2026-10-16T08:25:00',
});
const income = (tn: string, shipmentId: string | null, id = 'i1') => ({ incomeId: id, trackingNumber: tn, shipmentId, cost: 122, day: '2026-10-16' });

describe('detectChargeDoubles', () => {
  it('paquete del mismo semana → doble', () => {
    const [r] = detectChargeDoubles([guide('A')], [twin('A', '2026-10-16')], [], week);
    expect(r.isDouble).toBe(true);
    expect(r.twin?.shipmentId).toBe('s-A');
  });

  it('paquete de la semana anterior → doble; de dos semanas antes → no', () => {
    expect(detectChargeDoubles([guide('A')], [twin('A', '2026-10-05')], [], week)[0].isDouble).toBe(true);
    expect(detectChargeDoubles([guide('A')], [twin('A', '2026-09-28')], [], week)[0].isDouble).toBe(false);
  });

  it('doble con ingreso del paquete ligado por shipmentId → cobrado de más', () => {
    const [r] = detectChargeDoubles([guide('A')], [twin('A', '2026-10-16')], [income('A', 's-A')], week);
    expect(r.overcharged).toBe(true);
    expect(r.packageIncome?.incomeId).toBe('i1');
  });

  it('ingreso sin shipmentId (ingresos del 19-oct) se liga por guía', () => {
    const [r] = detectChargeDoubles([guide('A')], [twin('A', '2026-10-16')], [income('A', null)], week);
    expect(r.overcharged).toBe(true);
  });

  it('ingreso de OTRA fila de la guía no se liga', () => {
    const [r] = detectChargeDoubles([guide('A')], [twin('A', '2026-10-16')], [income('A', 's-viejo')], week);
    expect(r.isDouble).toBe(true);
    expect(r.overcharged).toBe(false);
    expect(r.packageIncome).toBeNull();
  });

  it('sin paquete → no es doble', () => {
    const [r] = detectChargeDoubles([guide('A')], [twin('B', '2026-10-16')], [income('A', null)], week);
    expect(r).toMatchObject({ twin: null, isDouble: false, overcharged: false, packageIncome: null });
  });

  it('varios paquetes de la guía → gana el del consolidado más reciente en la ventana', () => {
    const [r] = detectChargeDoubles([guide('A')], [twin('A', '2026-10-13', 's-1'), twin('A', '2026-10-16', 's-2'), twin('A', '2026-11-02', 's-3')], [], week);
    expect(r.twin?.shipmentId).toBe('s-2');
  });
});
