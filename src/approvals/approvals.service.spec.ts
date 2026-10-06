import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';

function makeSvc(overrides: any = {}) {
  const updated: any = { consolidated: [], shipment: [], charge: [], dispatch: [], request: [] };
  const saved: any[] = [];
  const audits: any[] = [];
  const approvalRepo = {
    create: (x: any) => ({ ...x }),
    save: async (x: any) => { const row = { id: x.id ?? 'req-1', ...x }; saved.push(row); return row; },
    findOne: async ({ where }: any) => {
      if (where?.targetKey) return overrides.pendingForKey ?? null;
      return overrides.request ?? { id: where.id, type: 'delete_route_dispatch', targetId: 'd1', status: 'pendiente', approverId: 'sup-1', requestedById: 'req-user', impactSnapshot: { label: 'Salida X' } };
    },
    update: async (id: any, patch: any) => { updated.request.push({ id, patch }); },
    find: async () => [],
  };
  const subsidiaryRepo = {
    findOne: async ({ where }: any) => ({ id: where.id, supervisorUserId: overrides.supervisors?.[where.id] ?? overrides.supervisorUserId ?? null }),
  };
  const userRepo = {
    findOne: async ({ where }: any) => {
      if (where?.id === 'sup-1') return { id: 'sup-1', name: 'Sup', email: 's@x.com' };
      if (where?.id === 'sup-dest') return { id: 'sup-dest', name: 'Sup Destino', email: 'd@x.com' };
      if (where?.role) return overrides.superUser ?? { id: 'super-9', name: 'Admin Principal', email: 'a@x.com' };
      return null;
    },
  };
  const consRepo = { findOne: async () => ({ id: 'c1', active: true, subsidiary: { id: 's1' } }), update: async (id: any, patch: any) => updated.consolidated.push({ id, patch }) };
  const dispatchRepo = { findOne: async () => ({ id: 'd1', active: true, subsidiary: { id: 's1' } }), update: async (id: any, patch: any) => updated.dispatch.push({ id, patch }) };
  const shipmentRepo = { update: async (crit: any, patch: any) => updated.shipment.push({ crit, patch }) };
  const chargeRepo = { update: async (crit: any, patch: any) => updated.charge.push({ crit, patch }) };
  const impact = { build: async () => ({ type: 'delete_route_dispatch', targetId: 'd1', label: 'Salida X', subsidiaryId: 's1', counts: { shipments: 5, charges: 1, enRuta: 0, withIncome: 0 } }) };
  const notifier = { emit: jest.fn(async () => {}) };
  const consImpact = {
    type: 'change_subsidiary_consolidado', targetId: 'c1', label: 'Consolidado 305', consNumber: '305', subsidiaryId: 's1',
    subsidiaryName: 'Obregón', targetKey: '305|s1', counts: { shipments: 26, charges: 0, enRuta: 0, withIncome: 26, withRoute: 0, devoluciones: 0 },
    summary: {}, warnings: [], change: { from: 'Obregón', to: 'Cabo' }, approverSubsidiaryId: 's-dest',
  };
  const consolidatedActions = {
    impact: jest.fn(async () => consImpact),
    execute: overrides.execute ?? jest.fn(async () => ({ impactAfter: consImpact, summary: { incomesMoved: 26 } })),
  };
  const audit = { log: jest.fn((e: any) => audits.push(e)) };
  const changeLogRepo = { find: async () => [] };
  const svc = new ApprovalsService(
    approvalRepo as any, subsidiaryRepo as any, userRepo as any,
    consRepo as any, dispatchRepo as any, shipmentRepo as any, chargeRepo as any,
    impact as any, notifier as any, consolidatedActions as any, audit as any, changeLogRepo as any,
  );
  return { svc, updated, saved, audits, consolidatedActions, notifier };
}

const consRequest = (over: any = {}) => ({
  id: 'req-1', type: 'change_subsidiary_consolidado', targetId: 'c1', status: 'pendiente', approverId: 'sup-dest',
  requestedById: 'req-user', requestedByName: 'Marisol', subsidiaryId: 's1', justification: 'Se subió en la sucursal equivocada',
  payload: { newSubsidiaryId: 's-dest' }, targetKey: '305|s1', targetLabel: 'Consolidado 305',
  impactSnapshot: { label: 'Consolidado 305', change: { from: 'Obregón', to: 'Cabo' } }, ...over,
});

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

  it('approve de una salida a ruta la da de baja (flujo existente)', async () => {
    const { svc, updated } = makeSvc();
    await svc.approve('req-1', { userId: 'sup-1', name: 'Sup', role: 'user' });
    expect(updated.dispatch[0].patch.active).toBe(false);
    expect(updated.request.some((u: any) => u.patch.status === 'aprobado')).toBe(true);
  });

  it('approve throws when actor is neither approver nor superadmin', async () => {
    const { svc } = makeSvc();
    await expect(svc.approve('req-1', { userId: 'other', role: 'user' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('nadie autoriza su propia solicitud (aunque sea el aprobador)', async () => {
    const { svc } = makeSvc({ request: consRequest({ approverId: 'sup-dest', requestedById: 'sup-dest' }) });
    await expect(svc.approve('req-1', { userId: 'sup-dest', role: 'user' })).rejects.toThrow('No puedes autorizar tu propia solicitud.');
  });

  it('un superadmin sí puede autorizar su propia solicitud', async () => {
    const { svc, consolidatedActions } = makeSvc({ request: consRequest({ requestedById: 'super-9' }) });
    await svc.approve('req-1', { userId: 'super-9', role: 'superadmin' });
    expect(consolidatedActions.execute).toHaveBeenCalled();
  });

  describe('acciones sobre consolidado', () => {
    it('exige justificación de al menos 10 caracteres', async () => {
      const { svc } = makeSvc();
      await expect(
        svc.createRequest({ type: 'change_subsidiary_consolidado', targetId: 'c1', actor: { userId: 'u1' }, justification: 'corto', payload: { newSubsidiaryId: 's-dest' } }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cambio de sucursal: lo autoriza el supervisor del DESTINO; guarda justificación, payload y llave', async () => {
      const { svc, saved, audits } = makeSvc({ supervisors: { 's-dest': 'sup-dest', s1: 'sup-1' } });
      await svc.createRequest({
        type: 'change_subsidiary_consolidado', targetId: 'c1', actor: { userId: 'u1', name: 'Marisol' },
        justification: 'Se subió en la sucursal equivocada', payload: { newSubsidiaryId: 's-dest' },
      });
      expect(saved[0]).toMatchObject({
        approverId: 'sup-dest', subsidiaryId: 's1', targetKey: '305|s1', justification: 'Se subió en la sucursal equivocada',
        payload: { newSubsidiaryId: 's-dest' }, status: 'pendiente',
      });
      expect(audits[0].description).toContain('pidió cambiar de sucursal Consolidado 305 (Obregón → Cabo)');
    });

    it('una sola solicitud pendiente por consolidado', async () => {
      const { svc } = makeSvc({ pendingForKey: { id: 'otra' } });
      await expect(
        svc.createRequest({ type: 'delete_consolidado', targetId: 'c1', actor: { userId: 'u1' }, justification: 'Duplicado de Vía Larga' }),
      ).rejects.toThrow('Ya hay una solicitud pendiente para este consolidado.');
    });

    it('al autorizar aplica el cambio y guarda resultado + bitácora', async () => {
      const { svc, updated, audits, consolidatedActions } = makeSvc({ request: consRequest() });
      await svc.approve('req-1', { userId: 'sup-dest', name: 'Sup Destino', role: 'user' });
      expect(consolidatedActions.execute).toHaveBeenCalled();
      const done = updated.request.find((u: any) => u.patch.status === 'aprobado');
      expect(done.patch.executedAt).toBeInstanceOf(Date);
      expect(done.patch.resultSummary).toEqual({ incomesMoved: 26 });
      expect(audits[0].description).toContain('autorizó cambiar de sucursal');
    });

    it('si falla al aplicar: sigue pendiente, guarda el error y lo registra', async () => {
      const execute = jest.fn(async () => { throw new Error('se cayó la BD'); });
      const { svc, updated, audits } = makeSvc({ request: consRequest(), execute });
      await expect(svc.approve('req-1', { userId: 'sup-dest', role: 'user' })).rejects.toThrow('No se pudo aplicar el cambio: se cayó la BD');
      expect(updated.request).toEqual([{ id: 'req-1', patch: { executionError: 'se cayó la BD' } }]);
      expect(audits[0].result).toBe('error');
    });
  });
});
