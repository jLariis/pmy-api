// src/warehouse/warehouse-rollback-decision.spec.ts
import { decideShipmentRollback } from './warehouse.service';

describe('decideShipmentRollback', () => {
  it('revierte cuando el estatus actual sigue siendo el objetivo y hay historial previo', () => {
    const d = decideShipmentRollback({
      targetStatus: 'EN_RUTA',
      currentStatus: 'EN_RUTA',
      history: [{ status: 'EN_RUTA' }, { status: 'EN_BODEGA' }],
    });
    expect(d).toEqual({ revert: true, priorStatus: 'EN_BODEGA' });
  });

  it('OMITE si el paquete ya avanzó (estatus actual != objetivo)', () => {
    const d = decideShipmentRollback({
      targetStatus: 'EN_RUTA',
      currentStatus: 'ENTREGADO',
      history: [{ status: 'ENTREGADO' }, { status: 'EN_RUTA' }, { status: 'EN_BODEGA' }],
    });
    expect(d.revert).toBe(false);
    if (d.revert === false) expect(d.reason).toMatch(/avanz/i);
  });

  it('traspaso: OMITE si el paquete ya no está en la sucursal destino', () => {
    const d = decideShipmentRollback({
      targetStatus: 'EN_RUTA',
      currentStatus: 'EN_RUTA',
      currentSubsidiaryId: 'otra-suc',
      expectedDestinationId: 'destino-1',
      history: [{ status: 'EN_RUTA' }, { status: 'EN_BODEGA' }],
    });
    expect(d.revert).toBe(false);
    if (d.revert === false) expect(d.reason).toMatch(/destino/i);
  });

  it('traspaso: revierte si sigue en la sucursal destino', () => {
    const d = decideShipmentRollback({
      targetStatus: 'EN_RUTA',
      currentStatus: 'EN_RUTA',
      currentSubsidiaryId: 'destino-1',
      expectedDestinationId: 'destino-1',
      history: [{ status: 'EN_RUTA' }, { status: 'EN_BODEGA' }],
    });
    expect(d).toEqual({ revert: true, priorStatus: 'EN_BODEGA' });
  });

  it('OMITE si no hay estatus previo en el historial', () => {
    const d = decideShipmentRollback({
      targetStatus: 'EN_RUTA',
      currentStatus: 'EN_RUTA',
      history: [{ status: 'EN_RUTA' }],
    });
    expect(d.revert).toBe(false);
    if (d.revert === false) expect(d.reason).toMatch(/previo|historial/i);
  });

  it('entrada: revierte EN_BODEGA al estatus previo', () => {
    const d = decideShipmentRollback({
      targetStatus: 'EN_BODEGA',
      currentStatus: 'EN_BODEGA',
      history: [{ status: 'EN_BODEGA' }, { status: 'PENDIENTE' }],
    });
    expect(d).toEqual({ revert: true, priorStatus: 'PENDIENTE' });
  });
});
