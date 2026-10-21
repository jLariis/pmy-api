import { BadRequestException } from '@nestjs/common';
import { ChargeShipment, Income, Shipment, ShipmentStatus } from 'src/entities';
import { RouteClosureManualStatus } from 'src/entities/route-closure-manual-status.entity';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { applyManualChanges, ManualChangesContext, ManualStatusChangeInput } from './pre-closure/apply-manual-changes';

/**
 * Cambios manuales del cierre con pre-cierre (Cabo San Lucas). Se prueba contra una BD en memoria:
 * el manager entiende where simples, arreglos (OR) y los operadores Between / IsNull de TypeORM.
 */
type Row = Record<string, any>;

function makeDb(seed: { shipments?: Row[]; charges?: Row[]; incomes?: Row[]; history?: Row[]; statuses?: Row[] }) {
  const tables = new Map<any, Row[]>([
    [Shipment, seed.shipments ?? []],
    [ChargeShipment, seed.charges ?? []],
    [Income, seed.incomes ?? []],
    [ShipmentStatus, seed.statuses ?? []],
    [RouteClosureManualStatus, []],
  ]);
  const history = seed.history ?? [];
  let seq = 0;

  const matchValue = (actual: any, expected: any) => {
    if (expected && typeof expected === 'object' && '_type' in expected) {
      if (expected._type === 'isNull') return actual == null;
      if (expected._type === 'between') {
        const t = new Date(actual).getTime();
        return t >= new Date(expected._value[0]).getTime() && t <= new Date(expected._value[1]).getTime();
      }
      if (expected._type === 'in') return expected._value.includes(actual);
    }
    return actual === expected;
  };
  const matches = (row: Row, where: any) =>
    (Array.isArray(where) ? where : [where]).some((w) => Object.entries(w).every(([k, v]) => matchValue(row[k], v)));

  const manager: any = {
    query: jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('package_dispatch_history')) return history.filter((h) => h.dispatchId === params[0]);
      if (sql.includes('shipment_status')) {
        return tables.get(ShipmentStatus)!.filter((s) => s.shipmentId === params[0] && s.exceptionCode === '08').map((s) => ({ timestamp: s.timestamp }));
      }
      return [];
    }),
    find: jest.fn(async (entity: any, opts: any) => tables.get(entity)!.filter((r) => matches(r, opts.where))),
    findOne: jest.fn(async (entity: any, opts: any) => tables.get(entity)!.find((r) => matches(r, opts.where)) ?? null),
    // `create` marca la entidad para soportar también `save(instancia)` (sin entidad explícita).
    create: jest.fn((entity: any, data: any) => Object.defineProperty({ ...data }, '__entity', { value: entity })),
    save: jest.fn(async (entityOrRow: any, maybeRow?: any) => {
      const entity = maybeRow ? entityOrRow : entityOrRow.__entity;
      const data = maybeRow ?? entityOrRow;
      const row = { id: data.id ?? `new-${++seq}`, active: true, ...data };
      if (row.shipment?.id && !row.shipmentId) row.shipmentId = row.shipment.id;
      if (row.chargeShipment?.id && !row.chargeShipmentId) row.chargeShipmentId = row.chargeShipment.id;
      tables.get(entity)!.push(row);
      return row;
    }),
    update: jest.fn(async (entity: any, where: any, patch: any) => {
      const crit = typeof where === 'string' ? { id: where } : where;
      tables.get(entity)!.filter((r) => matches(r, crit)).forEach((r) => Object.assign(r, patch));
    }),
  };
  return { manager, tables };
}

const audit = { log: jest.fn() } as any;

const ctx: ManualChangesContext = {
  dispatchId: 'd1',
  is315: false,
  subsidiary: { id: 'cabo', fedexCostPackage: 59 },
  routeClosureId: 'rc1',
  userId: 'u1',
  userName: 'Ana Ruiz',
  folio: '929567984667',
  routeDay: '2026-10-20',
  driverNames: 'Samuel Gaytán',
  routeIncomeDate: new Date('2026-10-20T07:00:00.000Z'),
  now: new Date('2026-10-20T23:30:00.000Z'),
};

const fedex = (id: string, tn: string, status: string): Row => ({ id, trackingNumber: tn, status, shipmentType: ShipmentType.FEDEX });
const change = (id: string, tn: string, previousStatus: string, option: any, isCharge = false): ManualStatusChangeInput => ({ id, trackingNumber: tn, previousStatus, option, isCharge });
const liveIncomes = (tables: Map<any, Row[]>) => tables.get(Income)!.filter((i) => i.active);

describe('applyManualChanges', () => {
  it('manual delivered creates one income', async () => {
    const { manager, tables } = makeDb({ shipments: [fedex('s1', 'T1', 'cliente_no_disponible')], history: [{ dispatchId: 'd1', shipmentId: 's1' }] });
    const res = await applyManualChanges(manager, audit, ctx, [change('s1', 'T1', 'cliente_no_disponible', 'ENTREGADO')]);

    expect(res.incomesCreated).toBe(1);
    expect(liveIncomes(tables)).toEqual([
      expect.objectContaining({ trackingNumber: 'T1', incomeType: IncomeStatus.ENTREGADO, cost: 59, sourceType: IncomeSourceType.SHIPMENT, createdById: 'u1' }),
    ]);
    expect(tables.get(Shipment)![0].status).toBe('entregado');
  });

  it('manual delivered upgrades existing no-entregado', async () => {
    const { manager, tables } = makeDb({
      shipments: [fedex('s1', 'T1', 'cliente_no_disponible')],
      history: [{ dispatchId: 'd1', shipmentId: 's1' }],
      incomes: [{ id: 'i1', shipmentId: 's1', trackingNumber: 'T1', incomeType: IncomeStatus.NO_ENTREGADO, nonDeliveryStatus: '08', sourceType: IncomeSourceType.SHIPMENT, date: new Date('2026-10-19T07:00:00Z'), active: true, cost: 59 }],
    });
    const res = await applyManualChanges(manager, audit, ctx, [change('s1', 'T1', 'cliente_no_disponible', 'ENTREGADO')]);

    expect(res).toMatchObject({ incomesCreated: 0, incomesUpgraded: 1 });
    expect(liveIncomes(tables)).toEqual([expect.objectContaining({ id: 'i1', incomeType: IncomeStatus.ENTREGADO, nonDeliveryStatus: null })]);
  });

  it('manual delivered does nothing when already delivered income this week', async () => {
    const { manager, tables } = makeDb({
      shipments: [fedex('s1', 'T1', 'en_ruta')],
      history: [{ dispatchId: 'd1', shipmentId: 's1' }],
      incomes: [{ id: 'i1', shipmentId: 's1', trackingNumber: 'T1', incomeType: IncomeStatus.ENTREGADO, sourceType: IncomeSourceType.SHIPMENT, date: new Date('2026-10-20T07:00:00Z'), active: true, cost: 59 }],
    });
    const res = await applyManualChanges(manager, audit, ctx, [change('s1', 'T1', 'en_ruta', 'ENTREGADO')]);
    expect(res).toMatchObject({ incomesCreated: 0, incomesUpgraded: 0 });
    expect(liveIncomes(tables)).toHaveLength(1);
  });

  it('entregado→DEX annuls and writes reversal', async () => {
    const { manager, tables } = makeDb({
      shipments: [fedex('s1', 'T1', 'entregado')],
      history: [{ dispatchId: 'd1', shipmentId: 's1' }],
      incomes: [{ id: 'i1', shipmentId: 's1', trackingNumber: 'T1', incomeType: IncomeStatus.ENTREGADO, sourceType: IncomeSourceType.SHIPMENT, date: new Date('2026-10-20T07:00:00Z'), active: true, cost: 59 }],
    });
    const res = await applyManualChanges(manager, audit, ctx, [change('s1', 'T1', 'entregado', 'DEX08')]);

    expect(res.incomesAnnulled).toBe(1);
    const all = tables.get(Income)!;
    expect(all.find((i) => i.id === 'i1')).toMatchObject({ active: false, annulledById: 'u1' });
    expect(all.find((i) => i.reversalOfIncomeId === 'i1')).toMatchObject({ cost: -59, active: false });
    // DEX08 sin 3 visitas en la semana → no genera ingreso de no entregado.
    expect(liveIncomes(tables)).toHaveLength(0);
  });

  it('entregado→DEX07 annuls and charges the DEX by charge_rule', async () => {
    const { manager, tables } = makeDb({
      shipments: [fedex('s1', 'T1', 'entregado')],
      history: [{ dispatchId: 'd1', shipmentId: 's1' }],
      incomes: [{ id: 'i1', shipmentId: 's1', trackingNumber: 'T1', incomeType: IncomeStatus.ENTREGADO, sourceType: IncomeSourceType.SHIPMENT, date: new Date('2026-10-20T07:00:00Z'), active: true, cost: 59 }],
    });
    await applyManualChanges(manager, audit, ctx, [change('s1', 'T1', 'entregado', 'DEX07')]);
    expect(liveIncomes(tables)).toEqual([expect.objectContaining({ incomeType: IncomeStatus.NO_ENTREGADO, nonDeliveryStatus: '07', cost: 59 })]);
  });

  it('charge shipment changes status but no income', async () => {
    const { manager, tables } = makeDb({ charges: [fedex('c1', 'T9', 'en_ruta')], history: [{ dispatchId: 'd1', chargeShipmentId: 'c1' }] });
    await applyManualChanges(manager, audit, ctx, [change('c1', 'T9', 'en_ruta', 'ENTREGADO', true)]);
    expect(tables.get(ChargeShipment)![0].status).toBe('entregado');
    expect(tables.get(Income)).toHaveLength(0);
    expect(tables.get(ShipmentStatus)![0]).toMatchObject({ chargeShipmentId: 'c1', source: 'route_closure_manual' });
  });

  it('is315 route no income', async () => {
    const { manager, tables } = makeDb({ shipments: [fedex('s1', 'T1', 'en_ruta')], history: [{ dispatchId: 'd1', shipmentId: 's1' }] });
    await applyManualChanges(manager, audit, { ...ctx, is315: true }, [change('s1', 'T1', 'en_ruta', 'ENTREGADO')]);
    expect(tables.get(Income)).toHaveLength(0);
  });

  it('rejects stale previousStatus (y no aplica nada)', async () => {
    const { manager, tables } = makeDb({
      shipments: [fedex('s1', 'T1', 'en_ruta'), fedex('s2', 'T2', 'entregado')],
      history: [{ dispatchId: 'd1', shipmentId: 's1' }, { dispatchId: 'd1', shipmentId: 's2' }],
    });
    await expect(
      applyManualChanges(manager, audit, ctx, [change('s1', 'T1', 'en_ruta', 'ENTREGADO'), change('s2', 'T2', 'en_ruta', 'DEX03')]),
    ).rejects.toThrow(new BadRequestException('La guía T2 cambió mientras cerrabas; recarga la pantalla.'));
    expect(tables.get(Shipment)![0].status).toBe('en_ruta');
    expect(tables.get(ShipmentStatus)).toHaveLength(0);
  });

  it('rejects a guía que no es de la salida', async () => {
    const { manager } = makeDb({ shipments: [fedex('s1', 'T1', 'en_ruta')], history: [] });
    await expect(applyManualChanges(manager, audit, ctx, [change('s1', 'T1', 'en_ruta', 'ENTREGADO')])).rejects.toThrow(
      'La guía T1 no pertenece a esta salida a ruta.',
    );
  });

  it('rejects DHL (se confirma con su código DHL)', async () => {
    const { manager } = makeDb({ shipments: [{ ...fedex('s1', 'JD1', 'en_ruta'), shipmentType: ShipmentType.DHL }], history: [{ dispatchId: 'd1', shipmentId: 's1' }] });
    await expect(applyManualChanges(manager, audit, ctx, [change('s1', 'JD1', 'en_ruta', 'ENTREGADO')])).rejects.toThrow(
      'La guía JD1 es DHL: se confirma con su código DHL.',
    );
  });

  it('writes shipment_status with source and reason', async () => {
    const { manager, tables } = makeDb({ shipments: [fedex('s1', 'T1', 'entregado')], history: [{ dispatchId: 'd1', shipmentId: 's1' }] });
    await applyManualChanges(manager, audit, ctx, [change('s1', 'T1', 'entregado', 'DEX03')]);
    expect(tables.get(ShipmentStatus)![0]).toMatchObject({
      shipmentId: 's1',
      status: 'direccion_incorrecta',
      exceptionCode: '03',
      source: 'route_closure_manual',
      timestamp: ctx.now,
      notes: 'Cambio manual en cierre de ruta por Ana Ruiz: guía T1 de Entregado a DEX03. Ruta 929567984667 del 2026-10-20, chofer Samuel Gaytán.',
    });
  });

  it('writes route_closure_manual_status row', async () => {
    const { manager, tables } = makeDb({ shipments: [fedex('s1', 'T1', 'en_ruta')], history: [{ dispatchId: 'd1', shipmentId: 's1' }] });
    await applyManualChanges(manager, audit, ctx, [change('s1', 'T1', 'en_ruta', 'DEX12')]);
    expect(tables.get(RouteClosureManualStatus)![0]).toMatchObject({
      routeClosureId: 'rc1',
      shipmentId: 's1',
      chargeShipmentId: null,
      trackingNumber: 'T1',
      previousStatus: 'en_ruta',
      newStatus: 'no_entregado',
      exceptionCode: '12',
      createdById: 'u1',
    });
  });

  it('sin cambios no toca nada', async () => {
    const { manager } = makeDb({});
    expect(await applyManualChanges(manager, audit, ctx, [])).toEqual({ applied: 0, incomesCreated: 0, incomesUpgraded: 0, incomesAnnulled: 0 });
    expect(manager.query).not.toHaveBeenCalled();
  });
});
