import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { isAuthorizer } from '../maintenance.permissions';

const baseOrder = (over: any = {}) => ({
  id: 'po1', folio: 'OC-000001', status: 'pendiente', subsidiaryId: 'sub1', requestId: 'r1', supplierId: 's1',
  createdById: 'creator', total: 0,
  items: [
    { id: 'i1', description: 'Balatas', quantity: 1, unitPrice: 1000, taxRate: 0.16, approved: true, amount: 1000 },
    { id: 'i2', description: 'Discos', quantity: 2, unitPrice: 500, taxRate: 0.16, approved: true, amount: 1000 },
  ],
  ...over,
});

function make(order: any, siblings: Array<{ id: string; status: string }> = []) {
  const updates: any[] = [];
  const savedItems: any[] = [];
  const m: any = {
    findOne: jest.fn(async (e: any) => (e?.name === 'Vehicle' ? { id: 'v1', kms: 90000 } : e?.name === 'ExpenseCategory' ? { id: 'cat1' } : null)),
    create: jest.fn((_e: any, x: any) => ({ ...x })),
    save: jest.fn(async (e: any, x: any) => {
      if (Array.isArray(x)) { savedItems.push(...x); return x; }
      savedItems.push({ entity: e?.name, ...x });
      return { id: 'exp1', ...x };
    }),
    update: jest.fn(async (e: any, _id: any, patch: any) => updates.push({ entity: e?.name, ...patch })),
    softDelete: jest.fn(async () => undefined),
  };
  const reqUpdates: any[] = [];
  const orders: any = {
    update: jest.fn(async (_id: any, patch: any) => updates.push(patch)),
    softDelete: jest.fn(async () => undefined),
    // Las órdenes de la solicitud después del cambio (para decidir el estado de la solicitud).
    find: jest.fn(async () => siblings),
  };
  const repo = (name: string) => ({ update: jest.fn(async (_w: any, patch: any) => reqUpdates.push({ entity: name, ...patch })) });
  const dataSource: any = {
    transaction: (fn: any) => fn(m),
    query: jest.fn(async () => [{ userId: 'edgardo' }]),
    getRepository: jest.fn((e: any) => repo(e?.name)),
  };
  const notifier: any = { emit: jest.fn(async () => undefined) };
  const svc = new PurchaseOrdersService(orders, {} as any, dataSource, notifier);
  jest.spyOn(svc, 'findOne').mockImplementation(async () => order);
  return { svc, updates, savedItems, notifier, m, orders, reqUpdates };
}

const edgardo = { userId: 'edgardo', role: 'admin', permissions: ['mttoVehiculos.autorizar'] };
const admin = { userId: 'a1', role: 'admin', permissions: ['mttoVehiculos.ordenes'], subsidiaryIds: ['sub1'] };

describe('isAuthorizer', () => {
  it('superadmin y quien tiene el permiso sí; admin no', () => {
    expect(isAuthorizer({ role: 'superadmin' })).toBe(true);
    expect(isAuthorizer(edgardo)).toBe(true);
    expect(isAuthorizer(admin)).toBe(false);
  });
});

describe('PurchaseOrdersService', () => {
  it('admin no puede autorizar', async () => {
    const { svc } = make(baseOrder());
    await expect(svc.authorize('po1', {}, admin)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('autorizar sin partidas aprobadas → 400', async () => {
    const { svc } = make(baseOrder());
    await expect(svc.authorize('po1', { items: [{ id: 'i1', approved: false }, { id: 'i2', approved: false }] }, edgardo))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('autorizar recalcula totales SOLO con las aprobadas y notifica al creador', async () => {
    const { svc, updates, notifier } = make(baseOrder());
    await svc.authorize('po1', { items: [{ id: 'i2', approved: false }] }, edgardo);
    expect(updates[0]).toMatchObject({ status: 'autorizada', subtotal: 1000, tax: 160, total: 1160, authorizedById: 'edgardo' });
    expect(notifier.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'mtto.oc_autorizada', audience: { userId: 'creator' } }));
  });

  it('rechazar regresa a borrador con el motivo', async () => {
    const { svc, updates } = make(baseOrder());
    await svc.reject('po1', '  Falta cotizar llantas ', edgardo);
    expect(updates[0]).toMatchObject({ status: 'borrador', rejectionReason: 'Falta cotizar llantas' });
  });

  it('enviar a autorización notifica a los autorizadores', async () => {
    const { svc, notifier } = make(baseOrder({ status: 'borrador' }));
    await svc.submit('po1', admin);
    expect(notifier.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'mtto.oc_por_autorizar', audience: { userIds: ['edgardo'] } }));
  });

  it('eliminar una autorizada → 400; borrador → baja lógica y solicitud vuelve a cotización', async () => {
    await expect(make(baseOrder({ status: 'autorizada' })).svc.remove('po1', admin)).rejects.toBeInstanceOf(BadRequestException);
    // Era la única orden activa → la solicitud regresa a cotización.
    const { svc, orders, reqUpdates } = make(baseOrder({ status: 'borrador' }), []);
    await svc.remove('po1', admin);
    expect(orders.softDelete).toHaveBeenCalledWith('po1');
    expect(reqUpdates).toContainEqual(expect.objectContaining({ entity: 'MaintenanceRequest', status: 'en_cotizacion' }));
  });

  it('quien captura no edita una orden pendiente', async () => {
    const { svc } = make(baseOrder({ status: 'pendiente' }));
    await expect(svc.update('po1', { notes: 'x' }, admin)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('completar actualiza la unidad, crea el gasto con el monto final y cierra la solicitud', async () => {
    const { svc, updates, savedItems, reqUpdates } = make(baseOrder({
      status: 'enviada', vehicleId: 'v1', total: 2320, vehicle: { name: 'PMY 13' }, supplier: { name: 'Taller X' }, request: { type: 'reparacion' },
    }), [{ id: 'po1', status: 'completada' }, { id: 'po2', status: 'cancelada' }]);
    await svc.complete('po1', { completedAt: '2026-09-20', completedKms: 90500, finalAmount: 2500, nextMaintenanceDate: '2026-12-20' }, admin);
    expect(updates.find((u) => u.entity === 'Vehicle')).toMatchObject({
      lastMaintenanceKms: 90500, kms: 90500, lastMaintenanceDate: new Date('2026-09-20T07:00:00.000Z'),
      nextMaintenanceDate: new Date('2026-12-20T07:00:00.000Z'),
    });
    expect(savedItems.find((x) => x.entity === 'Expense')).toMatchObject({
      subsidiaryId: 'sub1', categoryId: 'cat1', vehicleId: 'v1', date: '2026-09-20', amount: 2500,
    });
    expect(updates.find((u) => u.entity === 'PurchaseOrder')).toMatchObject({ status: 'completada', expenseId: 'exp1', finalAmount: 2500 });
    expect(reqUpdates).toContainEqual(expect.objectContaining({ entity: 'MaintenanceRequest', status: 'completada' }));
  });

  it('completar una orden mientras otra sigue en proceso NO cierra la solicitud', async () => {
    const { svc, reqUpdates } = make(baseOrder({ status: 'enviada', vehicleId: 'v1', total: 100, request: { type: 'reparacion' } }),
      [{ id: 'po1', status: 'completada' }, { id: 'po2', status: 'enviada' }]);
    await svc.complete('po1', { completedAt: '2026-09-20', completedKms: 90500 }, admin);
    expect(reqUpdates.find((u) => u.entity === 'MaintenanceRequest')).toBeUndefined();
  });

  it('compra de material: sin km, no toca la unidad y el gasto va a Compras', async () => {
    const { svc, updates, savedItems, m } = make(baseOrder({ status: 'enviada', vehicleId: null, total: 500, request: { type: 'compra' } }),
      [{ id: 'po1', status: 'completada' }]);
    m.findOne.mockImplementation(async (e: any, q: any) => (e?.name === 'ExpenseCategory' && q?.where?.name === 'Compras' ? { id: 'catCompras' } : null));
    await svc.complete('po1', { completedAt: '2026-09-20' }, admin);
    expect(updates.find((u) => u.entity === 'Vehicle')).toBeUndefined();
    expect(savedItems.find((x) => x.entity === 'Expense')).toMatchObject({ categoryId: 'catCompras', vehicleId: null, amount: 500 });
  });

  it('completar desde autorizada (sin enviar) → 400', async () => {
    const { svc } = make(baseOrder({ status: 'autorizada' }));
    await expect(svc.complete('po1', { completedAt: '2026-09-20', completedKms: 1 }, admin)).rejects.toBeInstanceOf(BadRequestException);
  });
});
