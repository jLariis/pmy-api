import { OfferCandidate, rankOffers } from './rank-offers.util';

const c = (id: string, price: number, quality: number | null, purchases = 0, productId = id): OfferCandidate => ({
  offerId: id, productId, productName: id, brand: null, supplierId: 's' + id, supplierName: 'S' + id, unitName: null, price, quality, purchases,
});

describe('rankOffers', () => {
  it('cada etiqueta a su ganador, en orden fijo', () => {
    // relación: a=4/(180/150)=3.33, b=3/1=3, c=5/(260/150)=2.88, d=4/(155/150)=3.87 → d
    const out = rankOffers([c('a', 180, 4, 7), c('b', 150, 3), c('c', 260, 5), c('d', 155, 4)]);
    expect(out.map((o) => [o.offerId, o.labels])).toEqual([
      ['a', ['mas_comprado']], ['b', ['mejor_precio']], ['c', ['mejor_calidad']], ['d', ['mejor_relacion']],
    ]);
  });

  it('una oferta puede ganar varias etiquetas (sale una sola vez) y se completa con otras opciones', () => {
    const out = rankOffers([c('a', 100, 5, 3), c('b', 120, 2)]);
    expect(out.map((o) => [o.offerId, o.labels])).toEqual([['a', ['mas_comprado', 'mejor_precio', 'mejor_calidad', 'mejor_relacion']], ['b', []]]);
  });

  it('completa hasta 4 tarjetas con las siguientes mejores en relación calidad-precio', () => {
    // g gana todo; relleno por relación: h=4/(110/100)=3.6, i=5/(200/100)=2.5, j=3/(105/100)=2.86, k=1/(101/100)=0.99
    const out = rankOffers([c('g', 100, 5, 2), c('h', 110, 4), c('i', 200, 5), c('j', 105, 3), c('k', 101, 1)]);
    expect(out.map((o) => o.offerId)).toEqual(['g', 'h', 'j', 'i']);
    expect(out.slice(1).every((o) => o.labels.length === 0)).toBe(true);
  });

  it('sin compras no hay "más comprado"; sin estrellas no hay "mejor calidad"; empate → preferido de la ficha', () => {
    const out = rankOffers([c('x', 100, null), c('y', 100, null, 0, 'pref')], { preferredProductId: 'pref' });
    expect(out[0].offerId).toBe('y');
    const labels = out.flatMap((o) => o.labels);
    expect(labels).not.toContain('mas_comprado');
    expect(labels).not.toContain('mejor_calidad');
    expect(labels).toEqual(['mejor_precio', 'mejor_relacion']);
  });

  it('calidad empatada: gana el más barato', () => {
    const out = rankOffers([c('a', 300, 5), c('b', 200, 5), c('z', 100, 1)]);
    expect(out.find((o) => o.labels.includes('mejor_calidad'))!.offerId).toBe('b');
  });

  it('sin estrellas cuenta como 3 en la relación calidad-precio', () => {
    // n=3/(110/100)=2.73 ; m=2/1=2 → n
    const out = rankOffers([c('m', 100, 2), c('n', 110, null)]);
    expect(out.find((o) => o.labels.includes('mejor_relacion'))!.offerId).toBe('n');
  });

  it('sin candidatos → []', () => expect(rankOffers([])).toEqual([]));
});
