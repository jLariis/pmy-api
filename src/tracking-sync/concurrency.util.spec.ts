import { createLimit } from './concurrency.util';

describe('createLimit', () => {
  it('never runs more than `concurrency` tasks at once and resolves all', async () => {
    const limit = createLimit(2);
    let active = 0;
    let maxActive = 0;
    const task = () =>
      limit(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return 'ok';
      });

    const results = await Promise.all([task(), task(), task(), task(), task()]);
    expect(results).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('propagates rejection without blocking the queue', async () => {
    const limit = createLimit(1);
    await expect(limit(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(limit(async () => 'after')).resolves.toBe('after');
  });
});
