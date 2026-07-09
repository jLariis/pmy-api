import { ExpenseCategoriesService } from './expense-categories.service';

function makeService(overrides: any = {}) {
  const catRepo: any = {
    create: (d: any) => d,
    save: (e: any) => Promise.resolve({ id: 'c1', ...e }),
    findOne: overrides.catFindOne ?? (() => Promise.resolve(null)),
    remove: jest.fn(() => Promise.resolve()),
    find: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
  };
  const groupRepo: any = {
    create: (d: any) => d,
    save: (e: any) => Promise.resolve({ id: 'g1', ...e }),
    findOne: () => Promise.resolve(null),
    remove: jest.fn(() => Promise.resolve()),
    find: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
  };
  // The in-use check for a category counts EXPENSES referencing it.
  const expenseRepo: any = { count: overrides.inUseCount ?? (() => Promise.resolve(0)) };
  const svc = new ExpenseCategoriesService(catRepo, groupRepo, expenseRepo);
  return { svc, catRepo, groupRepo, expenseRepo };
}

describe('ExpenseCategoriesService', () => {
  it('create forces isSystem=false', async () => {
    const { svc } = makeService();
    const created = await svc.createCategory({ name: 'Nueva' } as any);
    expect(created.isSystem).toBe(false);
  });

  it('cannot delete a system category', async () => {
    const { svc } = makeService({ catFindOne: () => Promise.resolve({ id: 'c1', isSystem: true }) });
    await expect(svc.removeCategory('c1')).rejects.toThrow();
  });

  it('cannot delete a user category that is in use', async () => {
    const { svc } = makeService({
      catFindOne: () => Promise.resolve({ id: 'c1', isSystem: false }),
      inUseCount: () => Promise.resolve(3),
    });
    await expect(svc.removeCategory('c1')).rejects.toThrow();
  });

  it('deletes an unused user category', async () => {
    const { svc, catRepo } = makeService({
      catFindOne: () => Promise.resolve({ id: 'c1', isSystem: false }),
      inUseCount: () => Promise.resolve(0),
    });
    await svc.removeCategory('c1');
    expect(catRepo.remove).toHaveBeenCalled();
  });
});
