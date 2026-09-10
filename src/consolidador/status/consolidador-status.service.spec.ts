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
  return new ConsolidadorStatusService(shipmentRepo, incomeRepo, resolver, { record: async () => undefined } as any);
}

function makeBatchService(opts: { shipments: any[]; fedexList: any[]; incomes?: any[] }) {
  const shipmentRepo: any = { find: async () => opts.shipments };
  const incomeRepo: any = { find: async () => opts.incomes ?? [] };
  const resolver: any = { getLatestStatusBatch: async () => opts.fedexList };
  return new ConsolidadorStatusService(shipmentRepo, incomeRepo, resolver, { record: async () => undefined } as any);
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

describe('ConsolidadorStatusService.searchBatch', () => {
  it('dedup + cap 30 y arma un resultado por guía con sugerencia', async () => {
    const svc = makeBatchService({
      shipments: [{ id: 's1', trackingNumber: 'T1', status: ShipmentStatusType.EN_RUTA }],
      fedexList: [
        { trackingNumber: 'T1', found: true, status: ShipmentStatusType.ENTREGADO },
        { trackingNumber: 'T2', found: false, status: null, error: 'no encontrado' },
      ],
    });
    const { results } = await svc.searchBatch(['T1', 'T1', 'T2']); // T1 duplicado
    expect(results).toHaveLength(2);
    const r1 = results.find((r) => r.tracking === 'T1');
    expect(r1?.internalStatus).toBe(ShipmentStatusType.EN_RUTA);
    expect(r1?.suggestion?.newStatus).toBe(ShipmentStatusType.ENTREGADO);
    const r2 = results.find((r) => r.tracking === 'T2');
    expect(r2?.shipment).toBeNull();
    expect(r2?.fedex.found).toBe(false);
  });

  it('lista vacía → results vacío', async () => {
    const svc = makeBatchService({ shipments: [], fedexList: [] });
    const { results } = await svc.searchBatch(['   ', '']);
    expect(results).toEqual([]);
  });
});

describe('ConsolidadorStatusService.repairIncome', () => {
  function makeRepair(opts: { shipment?: any; existingIncome?: any }) {
    let created: any = null;
    const shipmentRepo: any = { findOne: async () => opts.shipment ?? null };
    const incomeRepo: any = {
      findOne: async () => opts.existingIncome ?? null,
      create: (x: any) => { created = { ...x, id: 'inc-new' }; return created; },
      save: async (x: any) => x,
    };
    const audit: any = { record: async () => undefined };
    const svc = new ConsolidadorStatusService(shipmentRepo, incomeRepo, { getLatestStatus: async () => ({}) } as any, audit);
    return { svc, getCreated: () => created };
  }

  it('crea income con fedexCostPackage cuando el estatus es cobrable y no hay ingreso', async () => {
    const { svc, getCreated } = makeRepair({
      shipment: { id: 's1', trackingNumber: 'T1', status: ShipmentStatusType.ENTREGADO, shipmentType: 'fedex', subsidiary: { id: 'sub', fedexCostPackage: 85 } },
    });
    const res = await svc.repairIncome('s1', 'reparar', 'u1');
    expect(res.created).toBe(true);
    expect(getCreated().cost).toBe(85);
    expect(getCreated().incomeType).toBe('entregado');
    expect(getCreated().sourceType).toBe('shipment');
  });

  it('no crea si ya tiene ingreso activo', async () => {
    const { svc } = makeRepair({
      shipment: { id: 's1', trackingNumber: 'T1', status: ShipmentStatusType.ENTREGADO, subsidiary: { fedexCostPackage: 85 } },
      existingIncome: { id: 'i1', cost: '85', date: new Date(), shipment: { id: 's1' }, charge: null },
    });
    const res = await svc.repairIncome('s1', 'reparar', 'u1');
    expect(res.created).toBe(false);
    expect(res.reason).toContain('ya tiene');
  });

  it('no crea si el estatus no es cobrable', async () => {
    const { svc } = makeRepair({
      shipment: { id: 's1', trackingNumber: 'T1', status: ShipmentStatusType.EN_RUTA, subsidiary: { fedexCostPackage: 85 } },
    });
    const res = await svc.repairIncome('s1', 'reparar', 'u1');
    expect(res.created).toBe(false);
    expect(res.reason).toContain('no genera ingreso');
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
