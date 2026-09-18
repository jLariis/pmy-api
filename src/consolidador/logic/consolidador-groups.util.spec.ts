import { buildGroups } from './consolidador-groups.util';
import { GroupInputRow } from '../consolidador.types';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { Verdict } from './package-verdict.util';

const okVerdict: Verdict = { code: 'our_delivery_ok', level: 'ok', title: '', evidence: [], suggestedAction: { kind: 'none' } };
const dangerVerdict: Verdict = { code: 'fedex_delivery_doubtful', level: 'danger', title: '', evidence: [], suggestedAction: { kind: 'delete_income' } };

function row(over: Partial<GroupInputRow>): GroupInputRow {
  return {
    tracking: 'T1', shipmentId: 's1', status: ShipmentStatusType.ENTREGADO, isShipment: true,
    cost: 100, incomeId: 'i1', groupKey: 'r1', groupLabel: 'Ruta r1', groupDate: '2026-09-17',
    driver: 'Juan', owner: null, verdict: okVerdict, ...over,
  };
}

describe('buildGroups', () => {
  it('cuenta entregados (nuestra+fedex) vs no entregados y suma ingresos', () => {
    const { groups } = buildGroups(
      [
        row({ tracking: 'A', status: ShipmentStatusType.ENTREGADO, cost: 100 }),
        row({ tracking: 'B', status: ShipmentStatusType.ENTREGADO_POR_FEDEX, cost: 140, verdict: dangerVerdict }),
        row({ tracking: 'C', status: ShipmentStatusType.EN_RUTA, cost: 0, incomeId: null }),
      ],
      new Map(),
    );
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.kpis.delivered).toBe(2);
    expect(g.kpis.notDelivered).toBe(1);
    expect(g.kpis.incomeAmount).toBe(240);
    expect(g.kpis.incomeCount).toBe(2);
    expect(g.kpis.anomalyCount).toBe(1); // B es danger
    expect(g.rows).toHaveLength(3);
  });

  it('las cargas (no envío) suman al ingreso pero no cuentan como entrega ni salen en rows', () => {
    const { groups } = buildGroups(
      [
        row({ tracking: 'A', status: ShipmentStatusType.ENTREGADO, cost: 100 }),
        row({ tracking: null, shipmentId: null, status: null, isShipment: false, cost: 3150, incomeId: 'c1', verdict: okVerdict }),
      ],
      new Map(),
    );
    const g = groups[0];
    expect(g.kpis.delivered).toBe(1);
    expect(g.kpis.notDelivered).toBe(0);
    expect(g.kpis.incomeAmount).toBe(3250);
    expect(g.rows).toHaveLength(1); // solo el envío
  });

  it('agrupa por groupKey y ordena por fecha desc', () => {
    const { groups } = buildGroups(
      [
        row({ groupKey: 'r1', groupLabel: 'Ruta r1', groupDate: '2026-09-16' }),
        row({ groupKey: 'r2', groupLabel: 'Ruta r2', groupDate: '2026-09-18' }),
      ],
      new Map(),
    );
    expect(groups.map((g) => g.id)).toEqual(['r2', 'r1']);
  });

  it('suma el descuadre de cobros por guía dentro del grupo', () => {
    const { groups } = buildGroups(
      [row({ tracking: 'A' }), row({ tracking: 'B' })],
      new Map([['A', 140], ['B', 85]]),
    );
    expect(groups[0].kpis.chargeDiscrepancy).toBe(225);
  });
});
