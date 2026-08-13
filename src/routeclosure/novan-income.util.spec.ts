import { noVanIncomeDecision, NoVanFedexOutcome } from './novan-income.util';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

const outcome = (o: Partial<NoVanFedexOutcome>): NoVanFedexOutcome => ({
  trackingNumber: 'TN',
  delivered: false,
  dexCode: null,
  resolved: true,
  ...o,
});

describe('noVanIncomeDecision', () => {
  it('no cobra si FedEx no resolvió (no encontrado / caído)', () => {
    expect(noVanIncomeDecision(outcome({ resolved: false }))).toBeNull();
    // resolved=false gana aunque venga delivered/dexCode por ruido.
    expect(noVanIncomeDecision(outcome({ resolved: false, delivered: true }))).toBeNull();
  });

  it('no cobra si está en tránsito (resuelto pero sin entregar ni DEX)', () => {
    expect(noVanIncomeDecision(outcome({ delivered: false, dexCode: null }))).toBeNull();
  });

  it('cobra ENTREGADO sin nonDeliveryStatus cuando fue entregado', () => {
    expect(noVanIncomeDecision(outcome({ delivered: true }))).toEqual({
      incomeType: IncomeStatus.ENTREGADO,
      nonDeliveryStatus: null,
    });
  });

  it('cobra NO_ENTREGADO con el código DEX cuando hay excepción de entrega', () => {
    expect(noVanIncomeDecision(outcome({ delivered: false, dexCode: '07' }))).toEqual({
      incomeType: IncomeStatus.NO_ENTREGADO,
      nonDeliveryStatus: '07',
    });
  });

  it('prioriza entregado: si delivered=true ignora dexCode', () => {
    expect(noVanIncomeDecision(outcome({ delivered: true, dexCode: '03' }))).toEqual({
      incomeType: IncomeStatus.ENTREGADO,
      nonDeliveryStatus: null,
    });
  });
});
