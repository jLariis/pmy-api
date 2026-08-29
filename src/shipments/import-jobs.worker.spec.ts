// p-limit v7 es ESM puro y rompe el transform de jest al colarse por el chain de imports.
jest.mock('p-limit', () => ({ __esModule: true, default: () => (fn: any) => fn() }));

import { ImportJobsWorker } from './import-jobs.worker';

describe('ImportJobsWorker', () => {
  it('reclama un job pending y lo despacha por kind (master)', async () => {
    const master = jest.fn().mockResolvedValue(undefined);
    const claimed = [{ id: 'J1', kind: 'master' }];
    const repo: any = { find: jest.fn().mockResolvedValue(claimed), update: jest.fn() };
    const ds: any = { query: jest.fn().mockResolvedValue([]) };
    const svc: any = { processMasterJob: master, processChargeJob: jest.fn() };
    const worker = new ImportJobsWorker(repo, ds, svc);
    jest.spyOn<any, any>(worker, 'recoverStuck').mockResolvedValue(undefined);
    await worker.tick();
    expect(master).toHaveBeenCalledWith(claimed[0]);
  });

  it('despacha charge por kind', async () => {
    const charge = jest.fn().mockResolvedValue(undefined);
    const claimed = [{ id: 'J2', kind: 'charge' }];
    const repo: any = { find: jest.fn().mockResolvedValue(claimed), update: jest.fn() };
    const ds: any = { query: jest.fn().mockResolvedValue([]) };
    const svc: any = { processMasterJob: jest.fn(), processChargeJob: charge };
    const worker = new ImportJobsWorker(repo, ds, svc);
    jest.spyOn<any, any>(worker, 'recoverStuck').mockResolvedValue(undefined);
    await worker.tick();
    expect(charge).toHaveBeenCalledWith(claimed[0]);
  });

  it('recuperar colgados ejecuta re-encolar (<MAX) y failed (>=MAX)', async () => {
    const ds: any = { query: jest.fn().mockResolvedValue([]) };
    const repo: any = { find: jest.fn().mockResolvedValue([]), update: jest.fn() };
    const worker = new ImportJobsWorker(repo, ds, { processMasterJob: jest.fn(), processChargeJob: jest.fn() } as any);
    await worker.recoverStuck();
    expect(ds.query.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('marca failed si la estrategia truena', async () => {
    const claimed = [{ id: 'J3', kind: 'master' }];
    const repo: any = { find: jest.fn().mockResolvedValue(claimed), update: jest.fn() };
    const ds: any = { query: jest.fn().mockResolvedValue([]) };
    const svc: any = { processMasterJob: jest.fn().mockRejectedValue(new Error('boom')), processChargeJob: jest.fn() };
    const worker = new ImportJobsWorker(repo, ds, svc);
    jest.spyOn<any, any>(worker, 'recoverStuck').mockResolvedValue(undefined);
    await worker.tick();
    expect(repo.update).toHaveBeenCalledWith('J3', expect.objectContaining({ status: 'failed' }));
  });
});
