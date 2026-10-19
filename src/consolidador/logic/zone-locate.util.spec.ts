import { locateGuides } from './zone-locate.util';

const c = (tn: string, subsidiaryId: string, createdAt: string, kind: 'shipment' | 'charge' | 'novan' | 'collection' = 'shipment', consDay: string | null = null) =>
  ({ tn, subsidiaryId, kind, createdAt, consDay });

describe('locateGuides', () => {
  const scope = ['A', 'B'];

  it('guía solo en B → B', () => {
    const r = locateGuides(['1'], [c('1', 'B', '2026-10-14T10:00:00Z')], scope, '2026-10-15');
    expect(r.bySubsidiary.get('B')).toEqual(['1']);
    expect(r.unlocated).toEqual([]);
  });

  it('guía en A (01-oct) y B (14-oct), día 15-oct → B, la vigente', () => {
    const r = locateGuides(['1'], [c('1', 'A', '2026-10-01T10:00:00Z'), c('1', 'B', '2026-10-14T10:00:00Z')], scope, '2026-10-15');
    expect(r.bySubsidiary.get('B')).toEqual(['1']);
    expect(r.bySubsidiary.get('A')).toBeUndefined();
  });

  it('si todas son posteriores al día gana la más antigua', () => {
    const r = locateGuides(['1'], [c('1', 'A', '2026-10-20T10:00:00Z'), c('1', 'B', '2026-10-25T10:00:00Z')], scope, '2026-10-15');
    expect(r.bySubsidiary.get('A')).toEqual(['1']);
  });

  it('el día del consolidado manda sobre createdAt', () => {
    const r = locateGuides(['1'], [c('1', 'A', '2026-10-16T10:00:00Z', 'shipment', '2026-10-13'), c('1', 'B', '2026-10-14T10:00:00Z')], scope, '2026-10-15');
    expect(r.bySubsidiary.get('B')).toEqual(['1']);
  });

  it('guía de una sucursal fuera de la zona → sin sucursal', () => {
    const r = locateGuides(['1', '2'], [c('1', 'C', '2026-10-14T10:00:00Z')], scope, '2026-10-15');
    expect(r.unlocated).toEqual(['1', '2']);
  });

  it('ninguna guía sale en dos sucursales y no se repite', () => {
    const r = locateGuides(['1', '1', '2'], [c('1', 'A', '2026-10-14T10:00:00Z'), c('1', 'B', '2026-10-14T11:00:00Z', 'novan'), c('2', 'A', '2026-10-14T10:00:00Z')], scope, '2026-10-15');
    const all = [...r.bySubsidiary.values()].flat();
    expect(all.sort()).toEqual(['1', '2']);
  });
});
