import { groupClosureProblem, splitGroupClosure } from './group-closure.util';

const d = (id: string, extra: any = {}) => ({
  id, subsidiaryId: 'S', routeDate: '2026-10-24', driverIds: ['JUAN'], status: 'En progreso', createdAt: '2026-10-24T14:00:00Z', ...extra,
});

describe('groupClosureProblem', () => {
  it('acepta 2+ rutas abiertas del mismo día, sucursal y chofer', () => {
    expect(groupClosureProblem([d('A'), d('B', { driverIds: ['JUAN', 'PEDRO'] })], ['A', 'B'])).toBeNull();
  });
  it('rechaza con mensajes en llano', () => {
    expect(groupClosureProblem([d('A')], ['A'])).toMatch(/al menos dos/);
    expect(groupClosureProblem([d('A'), d('B', { status: 'Completada' })], ['A', 'B'])).toMatch(/ya está cerrada/);
    expect(groupClosureProblem([d('A'), d('B', { routeDate: '2026-10-25' })], ['A', 'B'])).toMatch(/días distintos/);
    expect(groupClosureProblem([d('A'), d('B', { subsidiaryId: 'X' })], ['A', 'B'])).toMatch(/sucursales distintas/);
    expect(groupClosureProblem([d('A'), d('B', { driverIds: ['PEDRO'] })], ['A', 'B'])).toMatch(/chofer en común/);
  });
});

describe('splitGroupClosure', () => {
  const membership = new Map([['p1', 'A'], ['p2', 'B'], ['c1', 'B']]);
  const input: any = {
    podPackages: [{ id: 'p1' }, { id: 'c1', isCharge: true }, { id: 'novan-x' }],
    returnedPackages: [{ id: 'p2', code: 'NH' }],
    manualStatusChanges: [{ id: 'p2', trackingNumber: 'T2', isCharge: false, previousStatus: 'en_ruta', option: 'x' }],
    collections: ['R1'],
    noVanPackages: [{ trackingNumber: 'NV1' }],
    actualKms: '12345',
    preClosureGeneratedAt: '2026-10-24T22:00:00Z',
  };

  it('reparte cada paquete a su ruta; recolecciones/No VAN a la primera y km a la última', () => {
    const [a, b] = splitGroupClosure(input, ['A', 'B'], membership);
    expect(a.dto.podPackages.map((p: any) => p.id)).toEqual(['p1']);
    expect(b.dto.podPackages.map((p: any) => p.id)).toEqual(['c1']);
    expect(b.dto.returnedPackages.map((p: any) => p.id)).toEqual(['p2']);
    expect(b.dto.manualStatusChanges?.length).toBe(1);
    expect([a.dto.collections, b.dto.collections]).toEqual([['R1'], []]);
    expect([a.dto.noVanPackages.length, b.dto.noVanPackages.length]).toEqual([1, 0]);
    expect([a.dto.actualKms, b.dto.actualKms]).toEqual(['', '12345']);
    expect([a.dto.preClosureGeneratedAt, b.dto.preClosureGeneratedAt]).toEqual(['2026-10-24T22:00:00Z', null]);
    expect(a.dto.packageDispatch.id).toBe('A');
  });

  it('un paquete ajeno a las rutas del grupo es error', () => {
    expect(() => splitGroupClosure({ ...input, podPackages: [{ id: 'zz', trackingNumber: 'T9' }] }, ['A', 'B'], membership)).toThrow(/T9/);
  });

  it('una guía que salió en dos rutas del grupo cuenta una sola vez, en su ruta actual', () => {
    const m = new Map([['p1', 'B']]); // membership ya resuelta a la ruta más reciente
    const parts = splitGroupClosure({ ...input, podPackages: [{ id: 'p1' }, { id: 'p1' }], returnedPackages: [], manualStatusChanges: [] }, ['A', 'B'], m);
    expect(parts.map((p) => p.dto.podPackages.length)).toEqual([0, 1]);
  });
});
