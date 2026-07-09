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
});
