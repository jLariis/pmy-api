import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DailyTasksController } from './daily-tasks.controller';

const svc: any = {
  week: jest.fn(async () => ({ ok: 'week' })),
  day: jest.fn(async () => ({ ok: 'day' })),
  packageDetail: jest.fn(async () => ({ ok: 'detail' })),
  refreshDay: jest.fn(async () => []),
  subsidiaryOfRef: jest.fn(async () => 'S1'),
};
const ctrl = new DailyTasksController(svc);
const user = (o: any) => ({ user: { role: 'user', subsidiaryIds: ['S1'], ...o } });

describe('DailyTasksController', () => {
  it('sucursal fuera de su alcance → 403 en español', async () => {
    await expect(ctrl.day(user({}), 'S2', '2026-10-17')).rejects.toThrow(new ForbiddenException('No tienes acceso a esa sucursal'));
  });

  it('superadmin ve cualquier sucursal', async () => {
    await expect(ctrl.day(user({ role: 'superadmin', subsidiaryIds: [] }), 'S2', '2026-10-17')).resolves.toEqual({ ok: 'day' });
  });

  it('la sucursal principal del token también cuenta', async () => {
    await expect(ctrl.week(user({ subsidiaryIds: [], subsidiary: { id: 'S3' } }), 'S3', '2026-10-12')).resolves.toEqual({ ok: 'week' });
  });

  it('día con formato inválido → 400', async () => {
    await expect(ctrl.day(user({}), 'S1', '17/10/2026')).rejects.toThrow(new BadRequestException('Fecha no válida (usa AAAA-MM-DD)'));
  });

  it('tipo de consolidado inválido → 400', async () => {
    await expect(ctrl.detail(user({}), 'otro', 'x')).rejects.toThrow(new BadRequestException('Tipo de consolidado no válido'));
  });

  it('el detalle valida la sucursal del consolidado', async () => {
    svc.subsidiaryOfRef.mockResolvedValueOnce('S9');
    await expect(ctrl.detail(user({}), 'consolidated', 'c1')).rejects.toThrow(ForbiddenException);
  });
});
