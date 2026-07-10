import { ExpensesService } from './expenses.service';

describe('ExpensesService.create date coercion', () => {
  const makeService = () => {
    const saved: any[] = [];
    const repo: any = {
      create: (dto: any) => dto,
      save: (e: any) => { saved.push(e); return Promise.resolve(e); },
    };
    const service = new ExpensesService(repo, {} as any, {} as any, {} as any);
    return { service, saved };
  };

  it('stores the picked wall-clock day when front sends Central-anchored ISO', async () => {
    const { service, saved } = makeService();
    await service.create({ date: '2026-07-06T06:00:00.000Z', amount: 100 } as any);
    expect(saved[0].date).toBe('2026-07-06');
  });

  it('defaults a missing date to today in Hermosillo', async () => {
    const { service, saved } = makeService();
    await service.create({ amount: 50 } as any);
    expect(saved[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('coerces period bounds to Hermosillo day strings', async () => {
    const { service, saved } = makeService();
    await service.create({
      date: '2026-07-04',
      amount: 7000,
      periodStart: '2026-06-27T06:00:00.000Z',
      periodEnd: '2026-07-03T06:00:00.000Z',
    } as any);
    expect(saved[0].periodStart).toBe('2026-06-27');
    expect(saved[0].periodEnd).toBe('2026-07-03');
  });

  it('rejects a period with only one bound', async () => {
    const { service } = makeService();
    await expect(
      service.create({ date: '2026-07-04', amount: 100, periodStart: '2026-07-01' } as any),
    ).rejects.toThrow();
  });

  it('rejects an inverted period', async () => {
    const { service } = makeService();
    await expect(
      service.create({ date: '2026-07-04', amount: 100, periodStart: '2026-07-10', periodEnd: '2026-07-01' } as any),
    ).rejects.toThrow();
  });
});
