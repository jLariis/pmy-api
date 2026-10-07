import { planChangeType, ChangeTypeInput, TypePackage } from './consolidated-type.plan';
import { ConsolidatedFamily, SubsidiaryTariff } from './consolidated-actions.types';

const SUB = 'sub-cabo';
const tariff: SubsidiaryTariff = {
  id: SUB, name: 'Cabo San Lucas', fedexCostPackage: 122, dhlCostPackage: 90, chargeCost: 4878, chargeCostHalfTon: 3000,
  chargeCostSundayHoliday: 6000, chargeCostHalfTonSundayHoliday: 4000, chargeSecondAbord: false, secondAbordAmount: 0,
  chargeOnlyFirstOfDay: false,
};
const DAY = new Date('2026-09-29T00:00:00.000Z');
const NOW = new Date('2026-10-07T18:00:00.000Z');

function family(over: Partial<ConsolidatedFamily> = {}): ConsolidatedFamily {
  return {
    consNumber: '305820438524', subsidiaryId: SUB,
    consolidated: [{ id: 'cons-1', consNumber: '305820438524', subsidiaryId: SUB, date: DAY }],
    shipments: [], chargeShipments: [], charges: [], incomes: [], devolutions: [], enRuta: 0, withRoute: 0,
    ...over,
  };
}

function pkg(id: string, tn: string, status = 'entregado', over: Partial<TypePackage> = {}): TypePackage {
  return {
    id, trackingNumber: tn,
    row: { trackingNumber: tn, shipmentType: 'fedex', recipientName: 'X', status, subsidiaryId: SUB, routeId: null, priority: 'baja' },
    lastEvent: { status, exceptionCode: null, timestamp: new Date('2026-09-30T20:00:00.000Z') },
    paymentId: null,
    ...over,
  };
}

let seq = 0;
function input(over: Partial<ChangeTypeInput>): ChangeTypeInput {
  seq = 0;
  return {
    family: family(),
    familyConsolidated: [{ id: 'cons-1', consNumber: '305820438524', subsidiaryId: SUB, date: DAY, type: 'ordinario' }],
    toType: 'carga', packages: [], whole: true, destConsolidated: null, destChargeId: null, alreadyInDest: new Map(),
    tariff, isHalfTon: false, isSundayHoliday: false, otherChargeIncomeOnDay: false, userId: 'u1', now: NOW,
    newId: () => `new-${++seq}`,
    ...over,
  };
}

const income = (id: string, shipmentId: string, cost = 122) => ({
  id, trackingNumber: null, subsidiaryId: SUB, sourceType: 'shipment', shipmentId, chargeId: null, cost, originalCost: null,
  date: DAY, shipmentType: 'fedex', secondAbordApplied: null, chargeNotChargedSameDay: false,
});

describe('planChangeType', () => {
  it('completo paquete → carga: misma fila de consolidado (sin tocar su tipo), carga nueva con su ingreso, guías nuevas y anula ingresos por paquete', () => {
    const f = family({ shipments: [{ id: 's1', trackingNumber: 'A', subsidiaryId: SUB }], incomes: [income('i1', 's1')] });
    const plan = planChangeType(input({ family: f, packages: [pkg('s1', 'A')] }));

    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'shipment', entityId: 's1', field: 'active', newValue: '0' }),
      expect.objectContaining({ entityType: 'income', entityId: 'i1', field: 'active', newValue: '0' }),
    ]));
    expect(plan.changes.some((c) => c.entityType === 'consolidated')).toBe(false);
    const charge = plan.inserts!.find((i) => i.table === 'charge')!;
    const cs = plan.inserts!.find((i) => i.table === 'charge_shipment')!;
    const chargeIncome = plan.inserts!.find((i) => i.table === 'income')!;
    expect(cs.values).toMatchObject({ trackingNumber: 'A', status: 'entregado', chargeId: charge.id, consolidatedId: 'cons-1', active: 1 });
    expect(chargeIncome.values).toMatchObject({ sourceType: 'charge', chargeId: charge.id, cost: 4878, isGrouped: 1 });
    const hist = plan.inserts!.find((i) => i.table === 'shipment_status')!;
    expect(hist.values).toMatchObject({ chargeShipmentId: cs.id, status: 'entregado', shipmentId: null });
    expect(String(hist.values.notes)).toContain('venía como paquete');
    expect(plan.summary).toMatchObject({ converted: 1, incomesAnnulled: 1, incomesCreated: 1, amountBefore: 122, amountAfter: 4878 });
  });

  it('por guías a una F2 ya subida: usa su carga y NO crea ingreso de carga (ya cobró)', () => {
    const f = family({ shipments: [{ id: 's1', trackingNumber: 'A', subsidiaryId: SUB }], incomes: [income('i1', 's1')] });
    const plan = planChangeType(input({
      family: f, whole: false, packages: [pkg('s1', 'A')],
      destConsolidated: { id: 'cons-f2', consNumber: '305820438600', subsidiaryId: SUB, date: DAY, type: 'carga' },
      destChargeId: 'charge-f2',
    }));
    expect(plan.inserts!.filter((i) => i.table === 'charge')).toHaveLength(0);
    expect(plan.inserts!.filter((i) => i.table === 'income')).toHaveLength(0);
    expect(plan.inserts!.find((i) => i.table === 'charge_shipment')!.values).toMatchObject({
      chargeId: 'charge-f2', consolidatedId: 'cons-f2', consNumber: '305820438600',
    });
    expect(plan.changes.some((c) => c.entityType === 'consolidated')).toBe(false);
    expect(plan.summary.amountAfter).toBe(0);
  });

  it('guía que ya está como carga en el destino (F2 repetida en el master): baja del duplicado, sin registro nuevo', () => {
    const f = family({ shipments: [{ id: 's1', trackingNumber: 'A', subsidiaryId: SUB }, { id: 's2', trackingNumber: 'B', subsidiaryId: SUB }], incomes: [income('i1', 's1')] });
    const plan = planChangeType(input({
      family: f, whole: false, packages: [pkg('s1', 'A', 'entregado', { paymentId: 'pay1' }), pkg('s2', 'B')], alreadyInDest: new Map([['A', 'cs-existing']]),
      destConsolidated: { id: 'cons-f2', consNumber: 'F2', subsidiaryId: SUB, date: DAY, type: 'ordinario', kind: 'carga' }, destChargeId: 'ch',
    }));
    expect(plan.inserts!.filter((i) => i.table === 'charge_shipment').map((i) => i.trackingNumber)).toEqual(['B']);
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'shipment', entityId: 's1', field: 'active', newValue: '0' }),
      expect.objectContaining({ entityType: 'income', entityId: 'i1', field: 'active', newValue: '0' }),
      expect.objectContaining({ entityType: 'payment', entityId: 'pay1', field: 'chargeShipmentId', newValue: 'cs-existing' }),
    ]));
    expect(plan.inserts!.filter((i) => i.table === 'shipment_status' && i.trackingNumber === 'A')).toHaveLength(0);
    expect(plan.warnings.join(' ')).toContain('1 guía(s) ya estaban como carga');
    expect(plan.summary).toMatchObject({ converted: 1, shipments: 2, incomesAnnulled: 1, amountAfter: 0 });
  });

  it('completo carga → paquete: anula carga e ingreso; crea ingreso por paquete solo a los cobrables', () => {
    const f = family({
      chargeShipments: [{ id: 'c1', trackingNumber: 'A', subsidiaryId: SUB }, { id: 'c2', trackingNumber: 'B', subsidiaryId: SUB }],
      charges: [{ id: 'ch1', subsidiaryId: SUB, chargeDate: DAY, isHalfTon: false }],
      incomes: [{ ...income('ic', '', 4878), sourceType: 'charge', shipmentId: null, chargeId: 'ch1' }],
    });
    const plan = planChangeType(input({
      family: f, toType: 'paquete',
      familyConsolidated: [{ id: 'cons-1', consNumber: '305820438524', subsidiaryId: SUB, date: DAY, type: 'carga' }],
      packages: [pkg('c1', 'A', 'entregado'), pkg('c2', 'B', 'en_bodega')],
    }));
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'charge', entityId: 'ch1', field: 'active', newValue: '0' }),
      expect.objectContaining({ entityType: 'income', entityId: 'ic', field: 'active', newValue: '0' }),
    ]));
    const ships = plan.inserts!.filter((i) => i.table === 'shipment');
    expect(ships).toHaveLength(2);
    const incomes = plan.inserts!.filter((i) => i.table === 'income');
    expect(incomes).toHaveLength(1);
    expect(incomes[0].values).toMatchObject({ trackingNumber: 'A', cost: 122, incomeType: 'entregado', sourceType: 'shipment', shipmentId: ships[0].id });
    expect(plan.summary.amountAfter).toBe(122);
  });

  it('cobro COD: se mueve al registro nuevo en los dos sentidos', () => {
    const toCarga = planChangeType(input({ packages: [pkg('s1', 'A', 'pendiente', { paymentId: 'pay1' })] }));
    const cs = toCarga.inserts!.find((i) => i.table === 'charge_shipment')!;
    expect(toCarga.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'payment', entityId: 'pay1', field: 'chargeShipmentId', newValue: cs.id }),
      expect.objectContaining({ entityType: 'payment', entityId: 'pay1', field: 'shipmentId', newValue: null }),
      expect.objectContaining({ entityType: 'shipment', entityId: 's1', field: 'paymentId', newValue: null }),
    ]));
    const toPaquete = planChangeType(input({
      toType: 'paquete', packages: [pkg('c1', 'A', 'pendiente', { paymentId: 'pay1' })],
      familyConsolidated: [{ id: 'cons-1', consNumber: 'X', subsidiaryId: SUB, date: DAY, type: 'carga' }],
    }));
    const sh = toPaquete.inserts!.find((i) => i.table === 'shipment')!;
    expect(sh.values.paymentId).toBe('pay1');
    expect(toPaquete.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'payment', field: 'shipmentId', newValue: sh.id }),
      expect.objectContaining({ entityType: 'payment', field: 'chargeShipmentId', newValue: null }),
    ]));
  });

  it('guía en ruta: el registro nuevo hereda la salida y entra a su historial', () => {
    const p = pkg('s1', 'A', 'en_ruta');
    p.row.routeId = 'disp-1';
    const plan = planChangeType(input({ packages: [p] }));
    const cs = plan.inserts!.find((i) => i.table === 'charge_shipment')!;
    expect(cs.values.routeId).toBe('disp-1');
    expect(plan.inserts!.find((i) => i.table === 'package_dispatch_history')!.values).toMatchObject({ dispatchId: 'disp-1', chargeShipmentId: cs.id });
    expect(plan.warnings.join(' ')).toContain('en ruta');
  });

  it('carga nueva respeta "solo la 1ª carga del día" y 1.5 ton en domingo/festivo', () => {
    const skip = planChangeType(input({ packages: [pkg('s1', 'A')], tariff: { ...tariff, chargeOnlyFirstOfDay: true }, otherChargeIncomeOnDay: true }));
    expect(skip.inserts!.find((i) => i.table === 'income')!.values).toMatchObject({ cost: 0, chargeNotChargedSameDay: 1 });
    const noTariff = planChangeType(input({ packages: [pkg('s1', 'A')], tariff: { ...tariff, name: 'Loreto', chargeCost: 0 } }));
    expect(noTariff.warnings.join(' ')).toContain('Loreto no tiene tarifa de carga');
    const half = planChangeType(input({ packages: [pkg('s1', 'A')], isHalfTon: true, isSundayHoliday: true }));
    expect(half.inserts!.find((i) => i.table === 'income')!.values.cost).toBe(4000);
    expect(half.inserts!.find((i) => i.table === 'charge')!.values.isHalfTon).toBe(1);
  });

  it('por guías a carga sin destino: crea consolidado y carga con el número de la F2 del correo', () => {
    const plan = planChangeType(input({ whole: false, packages: [pkg('s1', 'A')], destConsNumber: '305821316556' }));
    expect(plan.inserts!.find((i) => i.table === 'consolidated')!.values.consNumber).toBe('305821316556');
    expect(plan.inserts!.find((i) => i.table === 'charge')!.values.consNumber).toBe('305821316556');
    expect(plan.inserts!.find((i) => i.table === 'charge_shipment')!.values.consNumber).toBe('305821316556');
  });

  it('por guías a paquete sin master en la familia: crea el consolidado ordinario', () => {
    const plan = planChangeType(input({
      toType: 'paquete', whole: false, packages: [pkg('c1', 'A', 'pendiente')],
      familyConsolidated: [{ id: 'cons-1', consNumber: 'X', subsidiaryId: SUB, date: DAY, type: 'carga' }],
    }));
    const cons = plan.inserts!.find((i) => i.table === 'consolidated')!;
    expect(cons.values).toMatchObject({ type: 'ordinario', consNumber: 'X', active: 1 });
    expect(plan.inserts!.find((i) => i.table === 'shipment')!.values.consolidatedId).toBe(cons.id);
    expect(plan.changes.some((c) => c.entityType === 'charge')).toBe(false);
  });
});
