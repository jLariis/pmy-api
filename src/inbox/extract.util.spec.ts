import { extractCobros, extractConsolidations, numbersInFilename } from './extract.util';
import { cutQuotedHistory } from './text-normalize.util';
import { CABO, CABORCA, SIN_COBRO_TOP, SUR } from './__fixtures__/emails';

describe('extract.util', () => {
  it('Cabo: MASTER + F2 con guías anunciadas y 11 cobros', () => {
    expect(extractConsolidations(CABO.body)).toEqual([
      { consNumber: '305821242296', kind: 'master', announcedCount: 189 },
      { consNumber: '305821512729', kind: 'f2', announcedCount: 15 },
    ]);
    const cobros = extractCobros(CABO.body);
    expect(cobros).toHaveLength(11);
    expect(cobros[0]).toEqual({ trackingNumber: '383905050153', date: '09/28/2026', concept: 'COD-COLLECT CASH', amount: 2210 });
  });

  it('Sur: "CARGA YAQUI <cons>, N GUIAS" es master; cobros sin fecha incluyen FTC', () => {
    expect(extractConsolidations(SUR.body)).toEqual([
      { consNumber: '305821198046', kind: 'master', announcedCount: 87 },
    ]);
    const cobros = extractCobros(SUR.body);
    expect(cobros).toHaveLength(5);
    expect(cobros[4]).toEqual({ trackingNumber: '877713622069', date: null, concept: 'FTC-COLLECT CASH', amount: 579.64 });
  });

  it('Caborca: CONS + PAQUETES del mensaje superior únicamente', () => {
    const { top } = cutQuotedHistory(CABORCA.body);
    expect(extractConsolidations(top)).toEqual([
      { consNumber: '818861721255', kind: 'master', announcedCount: 123 },
    ]);
    expect(extractCobros(top).map((c) => c.trackingNumber)).toEqual(['383885282560', '383905025439', '383913948855']);
  });

  it('"NO PRECENTAN COBRO" → sin cobros', () => {
    expect(extractCobros(SIN_COBRO_TOP)).toEqual([]);
  });

  it('PIP NO AHS cuenta como cobro sin monto', () => {
    expect(extractCobros('875913990659\n\n08/21/2026\n\nPIP NO AHS')).toEqual([
      { trackingNumber: '875913990659', date: '08/21/2026', concept: 'PIP NO AHS', amount: null },
    ]);
  });

  it('números de consolidado en el nombre del archivo', () => {
    expect(numbersInFilename('CARGA_305821242296_YAQUI_SJDA.xlsx')).toEqual(['305821242296']);
    expect(numbersInFilename('F2.xlsx')).toEqual([]);
  });
});
