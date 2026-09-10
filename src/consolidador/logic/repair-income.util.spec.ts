import { deriveRepairIncome } from './repair-income.util';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';
import { IncomeStatus } from '../../common/enums/income-status.enum';

describe('deriveRepairIncome', () => {
  it('entregado → crea income entregado', () => {
    expect(deriveRepairIncome(ShipmentStatusType.ENTREGADO)).toEqual({ create: true, incomeType: IncomeStatus.ENTREGADO });
  });
  it('entregado por fedex → crea entregado', () => {
    expect(deriveRepairIncome(ShipmentStatusType.ENTREGADO_POR_FEDEX)).toEqual({ create: true, incomeType: IncomeStatus.ENTREGADO });
  });
  it('rechazado / devuelto / cliente no disponible → crea no_entregado', () => {
    expect(deriveRepairIncome(ShipmentStatusType.RECHAZADO).incomeType).toBe(IncomeStatus.NO_ENTREGADO);
    expect(deriveRepairIncome(ShipmentStatusType.DEVUELTO_A_FEDEX).incomeType).toBe(IncomeStatus.NO_ENTREGADO);
    expect(deriveRepairIncome(ShipmentStatusType.CLIENTE_NO_DISPONIBLE).incomeType).toBe(IncomeStatus.NO_ENTREGADO);
  });
  it('en tránsito (en_ruta/pendiente) → no crea', () => {
    expect(deriveRepairIncome(ShipmentStatusType.EN_RUTA)).toEqual({ create: false, incomeType: null });
    expect(deriveRepairIncome(ShipmentStatusType.PENDIENTE)).toEqual({ create: false, incomeType: null });
  });
  it('null → no crea', () => {
    expect(deriveRepairIncome(null)).toEqual({ create: false, incomeType: null });
  });
});
