import { dayOnlyUtc, planChangeDate, planChangeSubsidiary, planDelete } from './consolidated-actions.plan';
import { ConsolidatedFamily, FieldChange, SubsidiaryTariff } from './consolidated-actions.types';

const tariff = (over: Partial<SubsidiaryTariff> = {}): SubsidiaryTariff => ({
  id: 'CABO', name: 'Cabo San Lucas', fedexCostPackage: 122, dhlCostPackage: 90,
  chargeCost: 4878, chargeCostHalfTon: 0, chargeCostSundayHoliday: 0, chargeCostHalfTonSundayHoliday: 0,
  chargeSecondAbord: false, secondAbordAmount: 0, chargeOnlyFirstOfDay: false, ...over,
});

const family = (over: Partial<ConsolidatedFamily> = {}): ConsolidatedFamily => ({
  consNumber: '305820954693',
  subsidiaryId: 'OBR',
  consolidated: [{ id: 'C1', consNumber: '305820954693', subsidiaryId: 'OBR', date: new Date('2026-09-29T00:00:00Z') }],
  shipments: [
    { id: 'S1', trackingNumber: 'T1', subsidiaryId: 'OBR', shipmentType: 'fedex' },
    { id: 'S2', trackingNumber: 'T2', subsidiaryId: 'HMO', shipmentType: 'fedex' }, // traspasada
  ],
  chargeShipments: [{ id: 'CS1', trackingNumber: 'T9', subsidiaryId: 'OBR' }],
  charges: [{ id: 'CH1', subsidiaryId: 'OBR', chargeDate: new Date('2026-09-29T00:00:00Z'), isHalfTon: false }],
  incomes: [
    { id: 'I1', trackingNumber: 'T1', subsidiaryId: 'OBR', sourceType: 'shipment', shipmentId: 'S1', chargeId: null, cost: 64, originalCost: null, date: new Date('2026-09-29T18:57:00Z'), shipmentType: 'fedex', secondAbordApplied: null, chargeNotChargedSameDay: false },
    { id: 'I2', trackingNumber: null, subsidiaryId: 'OBR', sourceType: 'charge', shipmentId: null, chargeId: 'CH1', cost: 3000, originalCost: null, date: new Date('2026-09-29T00:00:00Z'), shipmentType: 'fedex', secondAbordApplied: false, chargeNotChargedSameDay: false },
  ],
  devolutions: [{ id: 'D1', trackingNumber: 'T1', subsidiaryId: 'OBR' }],
  enRuta: 0,
  withRoute: 0,
  ...over,
});

const find = (cs: FieldChange[], entityId: string, field: string) => cs.find((c) => c.entityId === entityId && c.field === field);

describe('dayOnlyUtc', () => {
  it("'yyyy-MM-dd' → medianoche UTC", () => {
    expect(dayOnlyUtc('2026-10-04').toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });
});

describe('planDelete', () => {
  it('da de baja consolidado, guías, guías de carga y cargas, y ANULA los ingresos', () => {
    const p = planDelete(family());
    for (const id of ['C1', 'S1', 'S2', 'CS1', 'CH1', 'I1', 'I2']) {
      expect(find(p.changes, id, 'active')?.value).toBe(false);
    }
    expect(p.summary.incomesAnnulled).toBe(2);
    expect(p.summary.amountBefore).toBe(3064);
    expect(p.summary.amountAfter).toBe(0);
    expect(p.summary.shipments).toBe(2);
    expect(p.summary.charges).toBe(1);
  });

  it('avisa si hay guías que ya salieron a ruta', () => {
    expect(planDelete(family({ withRoute: 3 })).warnings.join(' ')).toContain('3');
  });
});

describe('planChangeSubsidiary', () => {
  const dest = tariff();
  const notHoliday = () => false;

  it('mueve consolidado, carga, devolución y SOLO las guías que están en la sucursal origen', () => {
    const p = planChangeSubsidiary(family(), dest, notHoliday);
    expect(find(p.changes, 'C1', 'subsidiaryId')?.value).toBe('CABO');
    expect(find(p.changes, 'CH1', 'subsidiaryId')?.value).toBe('CABO');
    expect(find(p.changes, 'D1', 'subsidiaryId')?.value).toBe('CABO');
    expect(find(p.changes, 'S1', 'subsidiaryId')?.value).toBe('CABO');
    expect(find(p.changes, 'S2', 'subsidiaryId')).toBeUndefined(); // traspasada a HMO: se respeta
    expect(find(p.changes, 'CS1', 'subsidiaryId')?.value).toBe('CABO');
    expect(p.summary.shipments).toBe(1);
  });

  it('ingreso de guía: pasa al destino con SU tarifa (64 → 122) y guarda el costo original', () => {
    const p = planChangeSubsidiary(family(), dest, notHoliday);
    expect(find(p.changes, 'I1', 'subsidiaryId')?.value).toBe('CABO');
    expect(find(p.changes, 'I1', 'cost')?.value).toBe(122);
    expect(find(p.changes, 'I1', 'originalCost')?.value).toBe(64);
  });

  it('ingreso de carga: se recalcula con la tarifa de carga del destino', () => {
    const p = planChangeSubsidiary(family(), dest, notHoliday);
    expect(find(p.changes, 'I2', 'cost')?.value).toBe(4878);
    expect(p.summary.amountAfter).toBe(122 + 4878);
    expect(p.summary.incomesMoved).toBe(2);
    expect(p.summary.incomesRecosted).toBe(2);
  });

  it('carga marcada "no cobra (2ª del día)" se queda en 0', () => {
    const f = family();
    f.incomes[1] = { ...f.incomes[1], cost: 0, chargeNotChargedSameDay: true };
    const p = planChangeSubsidiary(f, dest, notHoliday);
    expect(find(p.changes, 'I2', 'cost')).toBeUndefined();
    expect(find(p.changes, 'I2', 'subsidiaryId')?.value).toBe('CABO');
  });

  it('domingo/festivo usa el sobreprecio del destino', () => {
    const p = planChangeSubsidiary(family(), tariff({ chargeCostSundayHoliday: 6660 }), () => true);
    expect(find(p.changes, 'I2', 'cost')?.value).toBe(6660);
  });

  it('destino sin tarifa de paquete → mueve igual y avisa', () => {
    const p = planChangeSubsidiary(family(), tariff({ fedexCostPackage: 0 }), notHoliday);
    expect(find(p.changes, 'I1', 'cost')?.value).toBe(0);
    expect(p.warnings.join(' ')).toMatch(/no tiene tarifa/i);
  });

  it('otros tipos de ingreso (recolección, etc.) solo cambian de sucursal', () => {
    const f = family();
    f.incomes.push({ ...f.incomes[0], id: 'I3', sourceType: 'collection', shipmentId: null, cost: 50 });
    const p = planChangeSubsidiary(f, dest, notHoliday);
    expect(find(p.changes, 'I3', 'subsidiaryId')?.value).toBe('CABO');
    expect(find(p.changes, 'I3', 'cost')).toBeUndefined();
  });
});

describe('planChangeDate', () => {
  const cabo = tariff({ chargeCostSundayHoliday: 6660 });

  it('cambia la fecha del consolidado y de la carga a medianoche UTC', () => {
    const p = planChangeDate(family(), cabo, '2026-10-01', false, false);
    expect((find(p.changes, 'C1', 'date')?.value as Date).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect((find(p.changes, 'CH1', 'chargeDate')?.value as Date).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('el ingreso de la carga se mueve y se recalcula; el de paquete NO se toca', () => {
    const p = planChangeDate(family(), cabo, '2026-10-01', false, false);
    expect((find(p.changes, 'I2', 'date')?.value as Date).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(find(p.changes, 'I2', 'cost')?.value).toBe(4878);
    expect(p.changes.some((c) => c.entityId === 'I1')).toBe(false);
    expect(p.summary.incomesRedated).toBe(1);
  });

  it('día nuevo domingo/festivo → sobreprecio', () => {
    const p = planChangeDate(family(), cabo, '2026-10-04', true, false);
    expect(find(p.changes, 'I2', 'cost')?.value).toBe(6660);
  });

  it('"solo 1ra carga del día": si ya hay otra carga cobrada ese día → 0 y marcada', () => {
    const p = planChangeDate(family(), tariff({ chargeOnlyFirstOfDay: true }), '2026-10-01', false, true);
    expect(find(p.changes, 'I2', 'cost')?.value).toBe(0);
    expect(find(p.changes, 'I2', 'chargeNotChargedSameDay')?.value).toBe(true);
  });

  it('carga que estaba "no cobra" y ahora es la 1ra del día → vuelve a cobrar', () => {
    const f = family();
    f.incomes[1] = { ...f.incomes[1], cost: 0, chargeNotChargedSameDay: true };
    const p = planChangeDate(f, tariff({ chargeOnlyFirstOfDay: true }), '2026-10-01', false, false);
    expect(find(p.changes, 'I2', 'cost')?.value).toBe(4878);
    expect(find(p.changes, 'I2', 'chargeNotChargedSameDay')?.value).toBe(false);
  });
});
