import { ConsolidadorStatusService } from './consolidador-status.service';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';

function makeService(opts: {
  shipment?: any;
  fedex?: any;
  income?: any;
  saveSpy?: (s: any) => void;
}) {
  const shipmentRepo: any = {
    findOne: async () => opts.shipment ?? null,
    save: async (s: any) => {
      opts.saveSpy?.(s);
      return s;
    },
  };
  const incomeRepo: any = {
    findOne: async () => opts.income ?? null,
    save: async (x: any) => x,
  };
  const resolver: any = { getLatestStatus: async () => opts.fedex };
  return new ConsolidadorStatusService(shipmentRepo, incomeRepo, resolver);
}

describe('ConsolidadorStatusService.search', () => {
  it('devuelve estatus interno y de FedEx + sugerencia', async () => {
    const svc = makeService({
      shipment: { id: 's1', trackingNumber: 'T1', status: ShipmentStatusType.EN_RUTA },
      fedex: { found: true, status: ShipmentStatusType.ENTREGADO, error: undefined },
      income: null,
    });
    const r = await svc.search('T1');
    expect(r.internalStatus).toBe(ShipmentStatusType.EN_RUTA);
    expect(r.fedex.status).toBe(ShipmentStatusType.ENTREGADO);
    expect(r.suggestion?.newStatus).toBe(ShipmentStatusType.ENTREGADO);
  });
});

describe('ConsolidadorStatusService.fixStatus', () => {
  it('bloquea si FedEx no confirma', async () => {
    const svc = makeService({
      shipment: { id: 's1', trackingNumber: 'T1', status: ShipmentStatusType.EN_RUTA },
      fedex: { found: false, error: 'timeout' },
    });
    await expect(svc.fixStatus('s1', ShipmentStatusType.ENTREGADO, 'motivo', 'u1')).rejects.toThrow('No se pudo verificar');
  });

  it('bloquea si el estatus pedido no coincide con FedEx', async () => {
    const svc = makeService({
      shipment: { id: 's1', trackingNumber: 'T1', status: ShipmentStatusType.EN_RUTA },
      fedex: { found: true, status: ShipmentStatusType.ENTREGADO, error: undefined },
    });
    await expect(svc.fixStatus('s1', ShipmentStatusType.EN_BODEGA, 'motivo', 'u1')).rejects.toThrow('no coincide');
  });

  it('corrige shipment y reclasifica income cuando FedEx confirma entregado', async () => {
    let saved: any = null;
    const income: any = { id: 'i1', incomeType: 'no_entregado', cost: '100', date: new Date(), shipment: { id: 's1' }, charge: null };
    const svc = makeService({
      shipment: { id: 's1', trackingNumber: 'T1', status: ShipmentStatusType.EN_RUTA },
      fedex: { found: true, status: ShipmentStatusType.ENTREGADO, error: undefined },
      income,
      saveSpy: (s) => (saved = s),
    });
    const res = await svc.fixStatus('s1', ShipmentStatusType.ENTREGADO, 'confirmado', 'u1');
    expect(saved.status).toBe(ShipmentStatusType.ENTREGADO);
    expect(income.incomeType).toBe('entregado');
    expect(res.shipmentStatus).toBe(ShipmentStatusType.ENTREGADO);
  });
});
