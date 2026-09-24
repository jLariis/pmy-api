import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { warehouseDeliveryIncomeAction, warehouseDeliveryCost } from './warehouse-delivery-income.util';

describe('warehouseDeliveryIncomeAction', () => {
  it('crea ingreso ENTREGADO si el paquete no tiene ingreso activo', () => {
    expect(warehouseDeliveryIncomeAction([])).toEqual({ type: 'create' });
  });

  it('no duplica si ya tiene un ENTREGADO activo', () => {
    expect(warehouseDeliveryIncomeAction([{ id: 'i1', incomeType: IncomeStatus.ENTREGADO }])).toEqual({ type: 'none' });
  });

  it('reemplaza un no-entregado (DEX) previo por ENTREGADO', () => {
    expect(
      warehouseDeliveryIncomeAction([{ id: 'i2', incomeType: IncomeStatus.NO_ENTREGADO }]),
    ).toEqual({ type: 'supersede', incomeId: 'i2' });
  });
});

describe('warehouseDeliveryCost', () => {
  const sub = { fedexCostPackage: 59.5, dhlCostPackage: 45 };

  it('FedEx usa fedexCostPackage', () => {
    expect(warehouseDeliveryCost(ShipmentType.FEDEX, sub)).toBe(59.5);
  });

  it('DHL usa dhlCostPackage', () => {
    expect(warehouseDeliveryCost(ShipmentType.DHL, sub)).toBe(45);
  });

  it('sin costo configurado da 0', () => {
    expect(warehouseDeliveryCost(ShipmentType.FEDEX, null)).toBe(0);
  });
});
