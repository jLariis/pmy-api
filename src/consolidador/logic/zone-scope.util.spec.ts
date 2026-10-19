import { pickScopeSubsidiaries, runWithLimit } from './zone-scope.util';

describe('pickScopeSubsidiaries', () => {
  const rows = [
    { id: 'a', name: 'La Paz', zoneId: 'z1', active: true },
    { id: 'b', name: 'Cabo San Lucas', zoneId: 'z1', active: true },
    { id: 'c', name: 'Loreto', zoneId: 'z1', active: false },
    { id: 'd', name: 'Hermosillo', zoneId: 'z2', active: true },
  ];

  it('global ve todas las activas de la zona, por nombre', () => {
    expect(pickScopeSubsidiaries(rows, 'z1', { role: 'superadmin' }).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('no global solo ve las asignadas', () => {
    expect(pickScopeSubsidiaries(rows, 'z1', { role: 'admin', subsidiaryIds: ['a', 'd'] }).map((s) => s.id)).toEqual(['a']);
  });

  it('zona sin sucursales → []', () => {
    expect(pickScopeSubsidiaries(rows, 'z9', { role: 'superadmin' })).toEqual([]);
  });

  it('devuelve solo id y nombre', () => {
    expect(pickScopeSubsidiaries(rows, 'z2', { role: 'owner' })).toEqual([{ id: 'd', name: 'Hermosillo' }]);
  });
});

describe('runWithLimit', () => {
  it('nunca corre más de 2 a la vez y conserva el orden', async () => {
    let active = 0;
    let peak = 0;
    const r = await runWithLimit([30, 5, 20, 1, 10], 2, async (ms) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((res) => setTimeout(res, ms));
      active--;
      return ms * 2;
    });
    expect(peak).toBe(2);
    expect(r.map((x) => (x as PromiseFulfilledResult<number>).value)).toEqual([60, 10, 40, 2, 20]);
  });

  it('un rechazo no tumba a los demás', async () => {
    const r = await runWithLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('x');
      return n;
    });
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('lista vacía → []', async () => {
    expect(await runWithLimit([], 2, async () => 1)).toEqual([]);
  });
});
