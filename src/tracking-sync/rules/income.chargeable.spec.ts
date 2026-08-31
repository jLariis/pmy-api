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
    const out = deriveChargeableIncomes([ev({ k: 'e1', status: ShipmentStatusType.ENTREGADO })], 0);
    expect(out).toHaveLength(1);
    expect(out[0].incomeType).toBe(IncomeStatus.ENTREGADO);
    expect(out[0].eventKey).toBe('e1');
  });
  it('07 / RECHAZADO → NO_ENTREGADO', () => {
    const out = deriveChargeableIncomes([ev({ k: 'e2', ec: '07', status: ShipmentStatusType.RECHAZADO })], 0);
    expect(out[0].incomeType).toBe(IncomeStatus.NO_ENTREGADO);
  });
  it('08 dispara solo en la 3ra visita (con 2 previas)', () => {
    const two = [ev({ k: 'a', ec: '08', status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE, t: '2026-08-20T10:00:00Z' })];
    expect(deriveChargeableIncomes(two, 2)).toHaveLength(1); // 2 previas + 1 nueva = 3
    expect(deriveChargeableIncomes(two, 1)).toHaveLength(0); // 1 + 1 = 2, aún no
  });
  it('estatus no cobrable → nada', () => {
    expect(deriveChargeableIncomes([ev({ k: 'x', status: ShipmentStatusType.EN_RUTA })], 0)).toHaveLength(0);
  });
});
