import { deriveChargeableIncomes } from './income.chargeable';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

const ev = (over: any) => ({
  occurredAt: new Date(over.t || '2026-08-20T10:00:00Z'), derivedCode: null, statusCode: null,
  exceptionCode: over.ec ?? null, eventType: null, description: null, location: null,
  status: over.status, eventKey: over.k, shadowKey: over.k,
});

describe('deriveChargeableIncomes', () => {
  it('DL → ENTREGADO', () => {
    const out = deriveChargeableIncomes([ev({ k: 'e1', status: ShipmentStatusType.ENTREGADO })], []);
    expect(out).toHaveLength(1);
    expect(out[0].incomeType).toBe(IncomeStatus.ENTREGADO);
    expect(out[0].eventKey).toBe('e1');
  });
  it('07 / RECHAZADO → NO_ENTREGADO', () => {
    const out = deriveChargeableIncomes([ev({ k: 'e2', ec: '07', status: ShipmentStatusType.RECHAZADO })], []);
    expect(out[0].incomeType).toBe(IncomeStatus.NO_ENTREGADO);
  });
  it('08 dispara solo en la 3ra visita de la MISMA semana (con 2 previas esa semana)', () => {
    // Evento nuevo 2026-08-20 (jueves, sem 34). Previas en la MISMA semana ISO.
    const sem34 = [new Date('2026-08-18T10:00:00Z'), new Date('2026-08-19T10:00:00Z')];
    const one = [new Date('2026-08-18T10:00:00Z')];
    const nuevo = [ev({ k: 'a', ec: '08', status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE, t: '2026-08-20T10:00:00Z' })];
    expect(deriveChargeableIncomes(nuevo, sem34)).toHaveLength(1); // 2 previas + 1 = 3 (misma semana)
    expect(deriveChargeableIncomes(nuevo, one)).toHaveLength(0); // 1 + 1 = 2, aún no
  });
  it('08 repartidos entre 2 semanas → NO cobra', () => {
    // 2 previas en sem 35 + 1 nuevo en sem 36 (lunes) → ninguna semana junta 3.
    const sem35 = [new Date('2026-08-25T10:00:00Z'), new Date('2026-08-26T10:00:00Z')];
    const nuevo = [ev({ k: 'a', ec: '08', status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE, t: '2026-08-31T10:00:00Z' })];
    expect(deriveChargeableIncomes(nuevo, sem35)).toHaveLength(0);
  });
  it('varios 08 el MISMO día no cuentan como 3 visitas (anti "cobra con 1")', () => {
    // 2 filas 08 del mismo día 18 en historial + 1 nuevo día 20 → solo 2 días distintos.
    const dupDia18 = [new Date('2026-08-18T09:00:00Z'), new Date('2026-08-18T18:00:00Z')];
    const nuevo = [ev({ k: 'a', ec: '08', status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE, t: '2026-08-20T10:00:00Z' })];
    expect(deriveChargeableIncomes(nuevo, dupDia18)).toHaveLength(0);
    // 3 eventos nuevos el mismo día (re-escaneos) → 1 sola visita → no cobra.
    const tresMismoDia = [
      ev({ k: 'a', ec: '08', status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE, t: '2026-08-20T09:00:00Z' }),
      ev({ k: 'b', ec: '08', status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE, t: '2026-08-20T14:00:00Z' }),
      ev({ k: 'c', ec: '08', status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE, t: '2026-08-20T20:00:00Z' }),
    ];
    expect(deriveChargeableIncomes(tresMismoDia, [])).toHaveLength(0);
  });
  it('estatus no cobrable → nada', () => {
    expect(deriveChargeableIncomes([ev({ k: 'x', status: ShipmentStatusType.EN_RUTA })], [])).toHaveLength(0);
  });
});
