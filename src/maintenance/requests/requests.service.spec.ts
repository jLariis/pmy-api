import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RequestsService } from './requests.service';

const gerardo = { userId: 'g1', role: 'admin', permissions: ['mttoVehiculos.revisar'], subsidiaryIds: ['s1'] };
const juan = { userId: 'u1', role: 'auxiliar', permissions: [], subsidiaryIds: ['s1', 's2'] };

function make(opts: { request?: any; vehicle?: any; hasOrders?: boolean } = {}) {
  const saved: any[] = [];
  const updates: any[] = [];
  const m: any = {
    create: jest.fn((_e: any, x: any) => x),
    save: jest.fn(async (_e: any, x: any) => { saved.push(x); return { id: 'r-new', ...x }; }),
    query: jest.fn(async () => [{ lastValue: 4 }]),
  };
  const requests: any = {
    findOne: jest.fn(async () => opts.request ?? null),
    update: jest.fn(async (_id: any, patch: any) => updates.push(patch)),
    save: jest.fn(async (x: any) => x),
  };
  const orders: any = { exist: jest.fn(async () => !!opts.hasOrders), find: jest.fn(async () => []) };
  const vehicles: any = { findOne: jest.fn(async () => opts.vehicle ?? null) };
  const dataSource: any = { transaction: (fn: any) => fn(m), manager: m, query: jest.fn(async () => [{ userId: 'g1' }]) };
  const folios: any = { next: jest.fn(async () => 'SOL-000005') };
  const kms: any = { bump: jest.fn() };
  const notifier: any = { emit: jest.fn(async () => undefined) };
  const svc = new RequestsService(requests, orders, vehicles, dataSource, folios, kms, notifier);
  jest.spyOn(svc, 'findOne').mockImplementation(async () => ({} as any));
  return { svc, saved, updates, notifier };
}

const item = { description: 'Balero doble', quantity: 2 };

describe('RequestsService (v3)', () => {
  it('cualquier usuario crea para su sucursal; nace "por revisar" y se avisa a Compras', async () => {
    const { svc, saved, notifier } = make({ vehicle: { id: 'v1', subsidiary: { id: 's2' } } });
    await svc.create({ type: 'reparacion', subsidiaryId: 's2', vehicleId: 'v1', description: 'Ruido en rueda', priority: 'alta', items: [item] }, juan);
    expect(saved[0]).toMatchObject({ folio: 'SOL-000005', status: 'por_revisar', type: 'reparacion', createdById: 'u1' });
    expect(saved[0].items[0]).toMatchObject({ description: 'Balero doble', quantity: 2, sortOrder: 0 });
    expect(notifier.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'compras.solicitud_nueva', audience: { userIds: ['g1'] } }));
  });

  it('mantenimiento/servicio/reparación sin unidad → 400; compra sin unidad sí', async () => {
    await expect(make().svc.create({ type: 'servicio', subsidiaryId: 's1', description: 'xxx', priority: 'media', items: [item] }, juan))
      .rejects.toBeInstanceOf(BadRequestException);
    const { svc, saved } = make();
    await svc.create({ type: 'compra', subsidiaryId: 's1', description: 'Sillas', priority: 'baja', items: [item] }, juan);
    expect(saved[0]).toMatchObject({ type: 'compra', vehicleId: null });
  });

  it('no puede pedir para una sucursal que no tiene asignada', async () => {
    await expect(make().svc.create({ type: 'compra', subsidiaryId: 's9', description: 'xxx', priority: 'baja', items: [item] }, juan))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('la unidad debe ser de la sucursal elegida', async () => {
    const { svc } = make({ vehicle: { id: 'v1', subsidiary: { id: 's2' } } });
    await expect(svc.create({ type: 'mantenimiento', subsidiaryId: 's1', vehicleId: 'v1', description: 'xxx', priority: 'baja', items: [item] }, juan))
      .rejects.toThrow(/no pertenece/);
  });

  it('solo Compras autoriza/rechaza; al autorizar pasa a cotizar y se avisa al solicitante', async () => {
    const req = { id: 'r1', folio: 'SOL-1', status: 'por_revisar', createdById: 'u1', subsidiaryId: 's1' };
    await expect(make({ request: req }).svc.approve('r1', juan)).rejects.toBeInstanceOf(ForbiddenException);
    const { svc, updates, notifier } = make({ request: req });
    await svc.approve('r1', gerardo);
    expect(updates[0]).toMatchObject({ status: 'abierta', reviewedById: 'g1' });
    expect(notifier.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'compras.solicitud_autorizada', audience: { userId: 'u1' } }));
  });

  it('rechazar guarda el motivo', async () => {
    const { svc, updates } = make({ request: { id: 'r1', folio: 'SOL-1', status: 'por_revisar', createdById: 'u1', subsidiaryId: 's1' } });
    await svc.reject('r1', ' No hay presupuesto ', gerardo);
    expect(updates[0]).toMatchObject({ status: 'rechazada', rejectionReason: 'No hay presupuesto' });
  });

  it('quien la levantó edita solo mientras está por revisar', async () => {
    await expect(make({ request: { id: 'r1', status: 'por_revisar', createdById: 'u1' } }).svc.loadEditable('r1', juan)).resolves.toBeTruthy();
    await expect(make({ request: { id: 'r1', status: 'abierta', createdById: 'u1' } }).svc.loadEditable('r1', juan)).rejects.toThrow(/ya la revisó/);
    await expect(make({ request: { id: 'r1', status: 'abierta', createdById: 'u1' }, hasOrders: true }).svc.loadEditable('r1', gerardo))
      .rejects.toThrow(/órdenes/);
  });
});
