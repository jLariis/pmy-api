import { buildGroups } from './consolidador-groups.util';
import { ConsolidadorGroupRow, ConsolidadorRow, GroupInputRow } from '../consolidador.types';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { Verdict } from './package-verdict.util';
import { IncomeSourceType } from '../../common/enums/income-source-type.enum';
import { IncomeStatus } from '../../common/enums/income-status.enum';

const okVerdict: Verdict = { code: 'our_delivery_ok', level: 'ok', title: '', evidence: [], suggestedAction: { kind: 'none' } };
const dangerVerdict: Verdict = { code: 'fedex_delivery_doubtful', level: 'danger', title: '', evidence: [], suggestedAction: { kind: 'delete_income' } };

function income(cost: number): ConsolidadorRow {
  return {
    id: `i-${Math.random()}`, trackingNumber: 'T', sourceType: IncomeSourceType.SHIPMENT, incomeType: IncomeStatus.ENTREGADO,
    cost, originalCost: null, date: '2026-09-17T00:00:00.000Z', consNumber: null, consolidatedId: null, routeId: 'r1',
    shipmentId: 's1', shipmentStatus: ShipmentStatusType.ENTREGADO, editReason: null, secondAbordApplied: null,
    secondAbordAmount: 0, subsidiaryId: 'sub', subsidiaryName: 'HMO',
  };
}

function row(over: Partial<GroupInputRow>): GroupInputRow {
  return {
    tracking: 'T1', shipmentId: 's1', status: ShipmentStatusType.ENTREGADO, isShipment: true,
    income: income(100), groupKey: 'r1', groupLabel: 'Ruta r1', groupDate: '2026-09-17',
    driver: 'Juan', owner: null, verdict: okVerdict, ...over,
  };
}

describe('buildGroups', () => {
  it('cuenta entregados (nuestra+fedex) vs no entregados y suma ingresos', () => {
    const { groups } = buildGroups(
      [
        row({ tracking: 'A', status: ShipmentStatusType.ENTREGADO, income: income(100) }),
        row({ tracking: 'B', status: ShipmentStatusType.ENTREGADO_POR_FEDEX, income: income(140), verdict: dangerVerdict }),
        row({ tracking: 'C', status: ShipmentStatusType.EN_RUTA, income: null }),
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
    expect(g.rows).toHaveLength(3); // envío sin ingreso también sale
  });

  it('las cargas (no envío) suman al ingreso pero no cuentan como entrega; sí salen en rows (editables)', () => {
    const { groups } = buildGroups(
      [
        row({ tracking: 'A', status: ShipmentStatusType.ENTREGADO, income: income(100) }),
        row({ tracking: null, shipmentId: null, status: null, isShipment: false, income: income(3150), verdict: okVerdict }),
      ],
      new Map(),
    );
    const g = groups[0];
    expect(g.kpis.delivered).toBe(1);
    expect(g.kpis.notDelivered).toBe(0);
    expect(g.kpis.incomeAmount).toBe(3250);
    expect(g.rows).toHaveLength(2); // envío + carga con ingreso
  });

  it('ordena por día (cronológico) y desempata por folio numérico', () => {
    const { groups } = buildGroups(
      [
        row({ groupKey: 'r2', groupLabel: 'Ruta 2', groupDate: '2026-09-18' }),
        row({ groupKey: 'r1', groupLabel: 'Ruta 1', groupDate: '2026-09-16' }),
        row({ groupKey: 'r10', groupLabel: 'Ruta 10', groupDate: '2026-09-16' }),
      ],
      new Map(),
    );
    // 16 (Ruta 1, luego Ruta 10 por orden numérico) antes que 18 (Ruta 2)
    expect(groups.map((g) => g.id)).toEqual(['r1', 'r10', 'r2']);
  });

  it('suma el descuadre de cobros por guía dentro del grupo', () => {
    const { groups } = buildGroups(
      [row({ tracking: 'A' }), row({ tracking: 'B' })],
      new Map([['A', 140], ['B', 85]]),
    );
    expect(groups[0].kpis.chargeDiscrepancy).toBe(225);
  });

  it('un envío sin ingreso aparece en rows con income null', () => {
    const { groups } = buildGroups([row({ tracking: 'C', status: ShipmentStatusType.RECHAZADO, income: null })], new Map());
    const r: ConsolidadorGroupRow = groups[0].rows[0];
    expect(r.income).toBeNull();
    expect(r.isShipment).toBe(true);
  });
});
