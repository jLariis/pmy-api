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
  it('estatus no cobrable → nada', () => {
    expect(deriveChargeableIncomes([ev({ k: 'x', status: ShipmentStatusType.EN_RUTA })], [])).toHaveLength(0);
  });
});
