import { buildNeeds, matchKeywords, normalize, similar } from './needs.util';

describe('normalize', () => {
  it('quita acentos, mayúsculas y signos', () => expect(normalize('¡Truena al FRENAR, líquido!')).toBe('truena al frenar liquido'));
});

describe('similar', () => {
  it('raíces parecidas sí, palabras distintas no', () => {
    expect(similar('frenar', 'frenos')).toBe(true);
    expect(similar('balata', 'balatas')).toBe(true);
    expect(similar('freno', 'frente')).toBe(false);
    expect(similar('aceite', 'aceite')).toBe(true);
    expect(similar('sol', 'solo')).toBe(false);
  });
});

describe('matchKeywords', () => {
  const cats = [
    { id: 'bal', name: 'BALATAS', keywords: 'frenos, rechina' },
    { id: 'liq', name: 'LIQUIDO DE FRENOS', keywords: 'liquido de frenos' },
    { id: 'fre', name: 'FRENTE', keywords: null },
  ];
  it('coincide por nombre o sinónimo y regresa la palabra que coincidió', () => {
    expect(matchKeywords('truena al frenar', cats)).toEqual([{ id: 'bal', matched: 'frenar' }]);
    expect(matchKeywords('cambiar la balata', cats).map((m) => m.id)).toEqual(['bal']);
  });
  it('sinónimo de varias palabras requiere todas', () => {
    expect(matchKeywords('le falta liquido de frenos', cats).map((m) => m.id).sort()).toEqual(['bal', 'liq']);
    expect(matchKeywords('liquido del radiador', cats)).toEqual([]);
  });
});

describe('buildNeeds', () => {
  const s10k = {
    id: 's10', name: 'Servicio de 10,000 km', keywords: 'servicio',
    items: [{ categoryId: 'ace', quantity: 5, unitId: 'L' }, { categoryId: 'fac', quantity: 1, unitId: null }],
  };
  const frenos = { id: 'sfr', name: 'Revisión de frenos', keywords: 'frenar, rechina', items: [{ categoryId: 'bal', quantity: 1, unitId: 'J' }] };
  const categories = [
    { id: 'ace', name: 'ACEITE' }, { id: 'fac', name: 'FILTRO DE ACEITE' },
    { id: 'bal', name: 'BALATAS', keywords: 'frenos' }, { id: 'amo', name: 'AMORTIGUADOR', keywords: 'rebota' },
  ];

  it('receta + palabras, sin duplicados; la ficha manda producto y cantidad', () => {
    const out = buildNeeds({
      chosen: [s10k], text: 'rechina al frenar y rebota', serviceCatalog: [s10k, frenos], categories,
      spec: [{ categoryId: 'ace', productId: 'mobil', quantity: 6, unitId: 'L' }],
    });
    expect(out.map((n) => [n.categoryId, n.source, n.quantity, n.productId])).toEqual([
      ['ace', 'receta', 6, 'mobil'], ['fac', 'receta', 1, null], ['bal', 'palabra', 1, null], ['amo', 'palabra', 1, null],
    ]);
    expect(out[0].sourceLabel).toBe('Del servicio "Servicio de 10,000 km"');
    expect(out[2].sourceLabel).toBe('Por lo que escribió: "frenar"');
    expect(out[2].unitId).toBe('J');
  });

  it('un servicio elegido no se repite por palabra clave', () => {
    const out = buildNeeds({ chosen: [frenos], text: 'rechina', serviceCatalog: [frenos], categories, spec: [] });
    expect(out.map((n) => [n.categoryId, n.source])).toEqual([['bal', 'receta']]);
  });

  it('sin servicios ni coincidencias: vacío', () => {
    expect(buildNeeds({ chosen: [], text: 'hola', serviceCatalog: [], categories, spec: [] })).toEqual([]);
  });
});
