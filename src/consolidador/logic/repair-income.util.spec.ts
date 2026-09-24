import { deriveRepairIncome, planRepairIncome } from './repair-income.util';
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

describe('planRepairIncome — entregado en bodega', () => {
  const sub = { fedexCostPackage: 113, dhlCostPackage: 90 };
  const at = new Date('2026-09-22T20:00:00Z'); // 13:00 Hermosillo del 22

  it('sin ingresos → crea ENTREGADO con la fecha del día de la entrega en bodega y costo del carrier', () => {
    const p = planRepairIncome({ status: ShipmentStatusType.ENTREGADO_EN_BODEGA, warehouseDeliveredAt: at, existingActive: [], shipmentType: 'fedex', subsidiary: sub });
    expect(p).toMatchObject({ action: 'create', incomeType: IncomeStatus.ENTREGADO, cost: 113 });
    expect(p.date?.toISOString()).toBe('2026-09-22T07:00:00.000Z');
  });

  it('DHL usa el costo DHL', () => {
    const p = planRepairIncome({ status: ShipmentStatusType.ENTREGADO_EN_BODEGA, warehouseDeliveredAt: at, existingActive: [], shipmentType: 'dhl', subsidiary: sub });
    expect(p.cost).toBe(90);
  });

  it('ya tiene un DEX de una visita previa → lo reemplaza por ENTREGADO', () => {
    const p = planRepairIncome({ status: ShipmentStatusType.ENTREGADO_EN_BODEGA, warehouseDeliveredAt: at, existingActive: [{ id: 'dex', incomeType: IncomeStatus.NO_ENTREGADO }], shipmentType: 'fedex', subsidiary: sub });
    expect(p).toMatchObject({ action: 'supersede', incomeId: 'dex', incomeType: IncomeStatus.ENTREGADO });
  });

  it('ya tiene ENTREGADO → nada', () => {
    const p = planRepairIncome({ status: ShipmentStatusType.ENTREGADO_EN_BODEGA, warehouseDeliveredAt: at, existingActive: [{ id: 'e', incomeType: IncomeStatus.ENTREGADO }], shipmentType: 'fedex', subsidiary: sub });
    expect(p.action).toBe('none');
    expect(p.reason).toContain('ya tiene');
  });

  it('hay registro de entrega en bodega aunque el estatus haya cambiado → sigue la regla de bodega', () => {
    const p = planRepairIncome({ status: ShipmentStatusType.ENTREGADO, warehouseDeliveredAt: at, existingActive: [{ id: 'dex', incomeType: IncomeStatus.NO_ENTREGADO }], shipmentType: 'fedex', subsidiary: sub });
    expect(p.action).toBe('supersede');
  });
});

describe('planRepairIncome — resto de estatus (comportamiento de siempre)', () => {
  const sub = { fedexCostPackage: 52 };
  it('con ingreso activo → nada', () => {
    const p = planRepairIncome({ status: ShipmentStatusType.ENTREGADO, warehouseDeliveredAt: null, existingActive: [{ id: 'x', incomeType: IncomeStatus.NO_ENTREGADO }], shipmentType: 'fedex', subsidiary: sub });
    expect(p.action).toBe('none');
  });
  it('entregado sin ingreso → crea ENTREGADO con costo FedEx', () => {
    const p = planRepairIncome({ status: ShipmentStatusType.ENTREGADO, warehouseDeliveredAt: null, existingActive: [], shipmentType: 'fedex', subsidiary: sub });
    expect(p).toMatchObject({ action: 'create', incomeType: IncomeStatus.ENTREGADO, cost: 52 });
  });
  it('en tránsito → no cobrable', () => {
    const p = planRepairIncome({ status: ShipmentStatusType.EN_RUTA, warehouseDeliveredAt: null, existingActive: [], shipmentType: 'fedex', subsidiary: sub });
    expect(p.action).toBe('none');
    expect(p.reason).toContain('no genera ingreso');
  });
});
