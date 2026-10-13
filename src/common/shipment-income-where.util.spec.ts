import { IsNull } from 'typeorm';
import { shipmentIncomeWhere } from './shipment-income-where.util';

describe('shipmentIncomeWhere', () => {
  it('busca por el shipment o por la guía sin shipment, solo vivos, con el filtro extra en ambos', () => {
    expect(shipmentIncomeWhere('sh-1', '878249671370', { sourceType: 'shipment' as any })).toEqual([
      { sourceType: 'shipment', active: true, shipment: { id: 'sh-1' } },
      { sourceType: 'shipment', active: true, trackingNumber: '878249671370', shipment: IsNull() },
    ]);
  });
});
