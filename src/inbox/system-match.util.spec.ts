import { summarizeMatch, SystemHit } from './system-match.util';

const hit = (tracking: string, consNumber: string, subsidiaryId: string, at: string, type: 'paquete' | 'carga' = 'paquete'): SystemHit => ({
  tracking,
  consNumber,
  subsidiaryId,
  subsidiaryName: subsidiaryId === 'hmo' ? 'Hermosillo' : 'Bodega Hermosillo',
  at: new Date(at),
  byName: 'Ana',
  type,
});

describe('system-match.util', () => {
  it('todas las guías ya están: cobertura completa, un solo consolidado', () => {
    const r = summarizeMatch(['1', '2', '3', '4'], [hit('1', '0610263642', 'hmo', '2026-10-06T22:48:00Z'), hit('2', '0610263642', 'hmo', '2026-10-06T22:48:00Z'), hit('3', '0610263642', 'hmo', '2026-10-06T22:48:00Z'), hit('4', '0610263642', 'hmo', '2026-10-06T22:48:00Z')]);
    expect(r).toMatchObject({ total: 4, found: 4, complete: true });
    expect(r.groups).toEqual([expect.objectContaining({ consNumber: '0610263642', subsidiaryId: 'hmo', count: 4 })]);
  });

  it('una guía en dos consolidados (2a vuelta): cuenta el más antiguo; parcial si faltan', () => {
    const r = summarizeMatch(['1', '2', '3'], [
      hit('1', '051026365', 'hmo', '2026-10-05T18:11:00Z'),
      hit('1', '061026364', 'hmo', '2026-10-06T18:05:00Z'),
      hit('2', '051026365', 'hmo', '2026-10-05T18:11:00Z'),
    ]);
    expect(r).toMatchObject({ total: 3, found: 2, complete: false });
    expect(r.groups.map((g) => `${g.consNumber}:${g.count}`)).toEqual(['051026365:2']);
  });

  it('reparto por sucursal para la detección', () => {
    const r = summarizeMatch(['1', '2', '3', '4'], [hit('1', 'a', 'bhmo', '2026-10-05T18:00:00Z'), hit('2', 'a', 'bhmo', '2026-10-05T18:00:00Z'), hit('3', 'b', 'hmo', '2026-10-05T18:00:00Z')]);
    expect(r.bySubsidiary).toEqual([
      { subsidiaryId: 'bhmo', count: 2 },
      { subsidiaryId: 'hmo', count: 1 },
    ]);
  });

  it('sin guías encontradas', () => {
    expect(summarizeMatch(['1', '2'], [])).toMatchObject({ total: 2, found: 0, complete: false, groups: [] });
  });
});
