import { linkManualIncomeToShipment, resolveManualIncomeCost } from './manual-income.util';
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

describe('linkManualIncomeToShipment', () => {
  const shipment = { id: 'sh-1', shipmentType: 'fedex' };

  it('"Manual (otro)" con guía existente → ingreso de la guía (shipment), ligado y del carrier de la guía', () => {
    const base = resolveManualIncomeCost('manual', { cost: 52 });
    expect(linkManualIncomeToShipment(base, shipment)).toEqual({
      cost: 52,
      sourceType: IncomeSourceType.SHIPMENT,
      incomeType: IncomeStatus.ENTREGADO,
      shipmentId: 'sh-1',
      shipmentType: 'fedex',
    });
  });

  it('POD/DEX con guía existente → se liga al registro de la guía', () => {
    const base = resolveManualIncomeCost('dex', { cost: 52 });
    expect(linkManualIncomeToShipment(base, { id: 'sh-2', shipmentType: 'dhl' })).toMatchObject({
      sourceType: IncomeSourceType.SHIPMENT,
      incomeType: IncomeStatus.CLIENTE_NO_DISPONIBLE_3RA_VISITA,
      shipmentId: 'sh-2',
      shipmentType: 'dhl',
    });
  });

  it('"Manual (otro)" sin guía en el sistema → se queda como manual, sin liga', () => {
    const base = resolveManualIncomeCost('manual', { cost: 50 });
    expect(linkManualIncomeToShipment(base, null)).toEqual({ ...base, shipmentId: null, shipmentType: null });
  });

  it('recolección nunca se liga a un paquete', () => {
    const base = resolveManualIncomeCost('recoleccion', { cost: 30 });
    expect(linkManualIncomeToShipment(base, shipment)).toEqual({ ...base, shipmentId: null, shipmentType: null });
  });
});
