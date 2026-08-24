import { ForbiddenException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';

function makeSvc(overrides: any = {}) {
  const updated: any = { consolidated: [], shipment: [], charge: [], dispatch: [], request: [] };
  const approvalRepo = {
    create: (x: any) => ({ ...x }),
    save: async (x: any) => ({ id: x.id ?? 'req-1', ...x }),
    findOne: async ({ where }: any) =>
      overrides.request ?? { id: where.id, type: 'delete_consolidado', targetId: 'c1', status: 'pendiente', approverId: 'sup-1', requestedById: 'req-user', impactSnapshot: { label: 'Consolidado CONS-1' } },
    update: async (id: any, patch: any) => { updated.request.push({ id, patch }); },
    find: async () => [],
  };
  const subsidiaryRepo = { findOne: async () => overrides.subsidiary ?? { id: 's1', supervisorUserId: overrides.supervisorUserId ?? null } };
  const userRepo = {
    findOne: async ({ where }: any) => {
      if (where?.id === 'sup-1') return { id: 'sup-1', name: 'Sup', email: 's@x.com' };
      if (where?.role) return overrides.superUser ?? { id: 'super-9', name: 'Admin Principal', email: 'a@x.com' };
      return null;
    },
  };
  const consRepo = { findOne: async () => ({ id: 'c1', active: true, subsidiary: { id: 's1' } }), update: async (id: any, patch: any) => updated.consolidated.push({ id, patch }) };
  const dispatchRepo = { findOne: async () => ({ id: 'd1', active: true, subsidiary: { id: 's1' } }), update: async (id: any, patch: any) => updated.dispatch.push({ id, patch }) };
  const shipmentRepo = { update: async (crit: any, patch: any) => updated.shipment.push({ crit, patch }) };
  const chargeRepo = { update: async (crit: any, patch: any) => updated.charge.push({ crit, patch }) };
  const impact = { build: async () => ({ type: 'delete_consolidado', targetId: 'c1', label: 'Consolidado CONS-1', subsidiaryId: 's1', counts: { shipments: 5, charges: 1, enRuta: 0, withIncome: 0 } }) };
  const notifier = { emit: async () => {} };
  const svc = new ApprovalsService(
    approvalRepo as any, subsidiaryRepo as any, userRepo as any,
    consRepo as any, dispatchRepo as any, shipmentRepo as any, chargeRepo as any,
    impact as any, notifier as any,
  );
  return { svc, updated };
}

describe('ApprovalsService', () => {
  it('resolveSupervisor falls back to first superadmin when subsidiary has none', async () => {
    const { svc } = makeSvc({ supervisorUserId: null });
    const sup = await svc.resolveSupervisor('s1');
    expect(sup?.id).toBe('super-9');
  });

  it('resolveSupervisor uses the subsidiary supervisor when configured', async () => {
    const { svc } = makeSvc({ supervisorUserId: 'sup-1' });
    const sup = await svc.resolveSupervisor('s1');
    expect(sup?.id).toBe('sup-1');
  });

  it('approve of a consolidado logically deletes it and its children', async () => {
    const { svc, updated } = makeSvc();
    await svc.approve('req-1', { userId: 'sup-1', name: 'Sup', role: 'user' });
    expect(updated.consolidated[0].patch.active).toBe(false);
    expect(updated.shipment[0].patch.active).toBe(false);
    expect(updated.charge[0].patch.active).toBe(false);
    expect(updated.request.some((u: any) => u.patch.status === 'aprobado')).toBe(true);
  });

  it('approve throws when actor is neither approver nor superadmin', async () => {
    const { svc } = makeSvc({ request: { id: 'req-1', type: 'delete_consolidado', targetId: 'c1', status: 'pendiente', approverId: 'sup-1', requestedById: 'req-user' } });
    await expect(svc.approve('req-1', { userId: 'other', role: 'user' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
