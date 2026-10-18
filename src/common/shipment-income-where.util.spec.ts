import { IsNull } from 'typeorm';
import { shipmentIncomeWhere } from './shipment-income-where.util';

describe('shipmentIncomeWhere', () => {
  it('busca por el shipment o por la guía sin shipment, solo vivos, con el filtro extra en ambos', () => {
    expect(shipmentIncomeWhere('sh-1', '878249671370', { sourceType: 'shipment' as any })).toEqual([
      { sourceType: 'shipment', active: true, shipmentId: 'sh-1' },
      { sourceType: 'shipment', active: true, trackingNumber: '878249671370', shipmentId: IsNull() },
    ]);
  });

  it('filtra por la columna shipmentId, no por la relación (la relación mete un join lento)', () => {
    const [byShipment, byTracking] = shipmentIncomeWhere('sh-1', 'TN');
    expect(byShipment).not.toHaveProperty('shipment');
    expect(byTracking).not.toHaveProperty('shipment');
  });
});
