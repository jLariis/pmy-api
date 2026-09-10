import { resolveManualIncomeCost } from './manual-income.util';
import { IncomeSourceType } from '../../common/enums/income-source-type.enum';
import { IncomeStatus } from '../../common/enums/income-status.enum';

describe('resolveManualIncomeCost', () => {
  it('recoleccion → collection/entregado', () => {
    expect(resolveManualIncomeCost('recoleccion', { cost: 120 })).toEqual({
      cost: 120,
      sourceType: IncomeSourceType.COLLECTION,
      incomeType: IncomeStatus.ENTREGADO,
    });
  });
  it('pod → shipment/entregado', () => {
    expect(resolveManualIncomeCost('pod', { cost: 100 })).toEqual({
      cost: 100,
      sourceType: IncomeSourceType.SHIPMENT,
      incomeType: IncomeStatus.ENTREGADO,
    });
  });
  it('dex → shipment/3ra visita', () => {
    expect(resolveManualIncomeCost('dex', { cost: 80 })).toEqual({
      cost: 80,
      sourceType: IncomeSourceType.SHIPMENT,
      incomeType: IncomeStatus.CLIENTE_NO_DISPONIBLE_3RA_VISITA,
    });
  });
  it('manual → manual/entregado', () => {
    expect(resolveManualIncomeCost('manual', { cost: 50 })).toEqual({
      cost: 50,
      sourceType: IncomeSourceType.MANUAL,
      incomeType: IncomeStatus.ENTREGADO,
    });
  });
  it('redondea a 2 decimales y trata cost ausente como 0', () => {
    expect(resolveManualIncomeCost('manual', {}).cost).toBe(0);
    expect(resolveManualIncomeCost('manual', { cost: 10.005 }).cost).toBe(10.01);
  });
});
