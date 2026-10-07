import { ShipmentStatusType as S } from 'src/common/enums/shipment-status-type.enum';
import { ClosureDoctorService } from './closure-doctor.service';

/** Snapshot FedEx: entregado el 30-sep (ruta del 06-oct) → estatus + evento + ingreso. */
function deliveredSnapshot() {
  const occurredAt = new Date('2026-09-30T18:05:00.000Z');
  return {
    events: [{
      occurredAt, status: S.ENTREGADO, exceptionCode: null, description: 'Delivered', location: 'LORETO',
      eventKey: 'k1', shadowKey: `${occurredAt.getTime()}||entregado`,
    }],
    vetoedEventKeys: new Set<string>(),
    shieldedStatus: S.EN_RUTA,
    rawStatus: S.ENTREGADO,
    headerDeliveredAt: null,
  };
}

function setup(opts: { snapshotFor?: (id: string) => any } = {}) {
  const dispatch = {
    id: 'd1', is315: false, routeDate: new Date('2026-10-06T15:00:00.000Z'), createdAt: new Date('2026-10-06T15:00:00.000Z'),
    subsidiary: { id: 'sub', name: 'Loreto', fedexCostPackage: 59 },
  };
  const items = [
    { kind: 'shipment', entity: { id: 'a', trackingNumber: '111', status: S.EN_RUTA } },
    { kind: 'shipment', entity: { id: 'b', trackingNumber: '222', status: S.EN_RUTA } },
  ];
  const compare = {
    listRouteItems: jest.fn().mockResolvedValue(items),
    buildDoctorSnapshot: jest.fn(async (e: any) => (opts.snapshotFor ? opts.snapshotFor(e.id) : deliveredSnapshot())),
  };
  const tx = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue({}),
    create: jest.fn((_e: any, v: any) => v),
    update: jest.fn().mockResolvedValue({}),
  };
  const dataSource = {
    getRepository: jest.fn(() => ({ find: jest.fn().mockResolvedValue([]) })),
    transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const dispatchRepo = { findOne: jest.fn().mockResolvedValue(dispatch) };
  const svc = new ClosureDoctorService(dispatchRepo as any, dataSource as any, compare as any);
  return { svc, compare, tx, dataSource };
}

describe('ClosureDoctorService', () => {
  it('diagnoseRoute regresa solo los paquetes con problema', async () => {
    const { svc } = setup({ snapshotFor: (id) => (id === 'a' ? deliveredSnapshot() : null) });
    const r = await svc.diagnoseRoute('d1');
    // 'b' sin datos FedEx también aparece (aviso), 'a' trae arreglos.
    expect(r.packages.map((p) => p.trackingNumber).sort()).toEqual(['111', '222']);
    expect(r.packages.find((p) => p.trackingNumber === '111')!.plan).not.toBeNull();
  });

  it('applyFixes con huella distinta → changed, sin escribir', async () => {
    const { svc, dataSource } = setup();
    const r = await svc.applyFixes('d1', [{ shipmentId: 'a', kind: 'shipment', fingerprint: 'vieja' }], { userId: 'u1' });
    expect(r.results[0].status).toBe('changed');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('applyFixes con huella vigente aplica estatus, evento e ingreso', async () => {
    const { svc, tx } = setup();
    const diag = await svc.diagnoseRoute('d1');
    const a = diag.packages.find((p) => p.shipmentId === 'a')!;
    const r = await svc.applyFixes('d1', [{ shipmentId: 'a', kind: 'shipment', fingerprint: a.fingerprint! }], { userId: 'u1' });
    expect(r.results[0].status).toBe('applied');
    expect(tx.update).toHaveBeenCalledWith(expect.anything(), { id: 'a' }, { status: S.ENTREGADO });
    // 1 evento + 1 ingreso
    expect(tx.save).toHaveBeenCalledTimes(2);
  });

  it('un error en un paquete no frena a los demás', async () => {
    const { svc, dataSource } = setup();
    const diag = await svc.diagnoseRoute('d1');
    const fp = (id: string) => diag.packages.find((p) => p.shipmentId === id)!.fingerprint!;
    dataSource.transaction.mockRejectedValueOnce(new Error('boom'));
    const r = await svc.applyFixes(
      'd1',
      [
        { shipmentId: 'a', kind: 'shipment', fingerprint: fp('a') },
        { shipmentId: 'b', kind: 'shipment', fingerprint: fp('b') },
      ],
      { userId: 'u1' },
    );
    expect(r.results.map((x) => x.status)).toEqual(['error', 'applied']);
  });

  it('paquete ajeno a la salida → error', async () => {
    const { svc } = setup();
    const r = await svc.applyFixes('d1', [{ shipmentId: 'zzz', kind: 'shipment', fingerprint: 'x' }], {});
    expect(r.results[0].status).toBe('error');
  });
});
