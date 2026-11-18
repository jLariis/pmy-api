import { buildCcList, escapeHtml, pickCriticalPackages } from './inventory-critical.util';

describe('pickCriticalPackages', () => {
  // 2026-11-17 10:00 en Hermosillo = 17:00Z
  const now = new Date('2026-11-17T17:00:00Z');

  it('toma los que vencen hoy en hora Hermosillo aunque en UTC ya sea mañana', () => {
    const pkgs = [
      { id: 'a', status: 'en_bodega', commitDateTime: '2026-11-18T01:00:00Z' }, // 17-nov 18:00 local
      { id: 'b', status: 'en_bodega', commitDateTime: '2026-11-17T06:30:00Z' }, // 16-nov 23:30 local
    ];
    expect(pickCriticalPackages(pkgs, now).map((p) => p.id)).toEqual(['a']);
  });

  it('acepta cualquier estatus activo (no solo en_ruta) y descarta los finales', () => {
    const pkgs = [
      { id: 'bodega', status: 'en_bodega', commitDateTime: '2026-11-17T20:00:00Z' },
      { id: 'pendiente', status: 'pendiente', commitDateTime: '2026-11-17T20:00:00Z' },
      { id: 'entregado', status: 'entregado', commitDateTime: '2026-11-17T20:00:00Z' },
      { id: 'devuelto', status: 'devuelto_a_fedex', commitDateTime: '2026-11-17T20:00:00Z' },
      { id: 'sinFecha', status: 'en_bodega', commitDateTime: null },
    ];
    expect(pickCriticalPackages(pkgs, now).map((p) => p.id)).toEqual(['bodega', 'pendiente']);
  });
});

describe('buildCcList', () => {
  it('quita null/vacíos y repetidos', () => {
    expect(buildCcList(null, 'a@x.com, b@x.com', 'null', 'a@x.com', 'sistemas@x.com')).toBe('a@x.com, b@x.com, sistemas@x.com');
  });
});

describe('escapeHtml', () => {
  it('escapa los caracteres de HTML', () => {
    expect(escapeHtml('<b>"A&B"</b>')).toBe('&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
  });
});
