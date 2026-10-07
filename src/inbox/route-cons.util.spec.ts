import { buildConsNumber, detectRoutePattern, patternOf, routeOf, summarizeRoutes } from './route-cons.util';

describe('route-cons.util', () => {
  it('ruta desde el nombre del archivo', () => {
    expect(routeOf('364.xlsx')).toBe('364');
    expect(routeOf('364 2da vuelta.xlsx')).toBe('364');
    expect(routeOf('PREALERTA DEL YAQUI LOCAL RUTA 365 10-06.xls')).toBe('365');
    expect(routeOf('PREALERTA DEL YAQUI RUTA 364 10-005.xls')).toBe('364');
    expect(routeOf('CP367.xlsx')).toBe('367');
    expect(routeOf('CARGA_305821242296_YAQUI_SJDA.xlsx')).toBeNull();
    expect(routeOf('YAQUI.xlsx')).toBeNull();
  });

  it('formato de cada número', () => {
    expect(patternOf('071026364', '2026-10-07')).toEqual({ pattern: 'fecha+ruta', route: '364' }); // Hermosillo
    expect(patternOf('0710263642', '2026-10-07')).toEqual({ pattern: 'fecha+ruta', route: '364' }); // 2a vuelta
    expect(patternOf('36405102026', '2026-10-05')).toEqual({ pattern: 'ruta+fecha', route: '364' }); // Bodega Hermosillo
    expect(patternOf('305821242296', '2026-10-01')).toBeNull(); // número de FedEx
    expect(patternOf('071026364', '2026-10-06')).toBeNull(); // la fecha no coincide
  });

  it('el formato que más usa la sucursal (mínimo 3 casos)', () => {
    expect(
      detectRoutePattern([
        { consNumber: '061026364', day: '2026-10-06' },
        { consNumber: '061026365', day: '2026-10-06' },
        { consNumber: '051026367', day: '2026-10-05' },
        { consNumber: '305821242296', day: '2026-10-01' },
      ]),
    ).toBe('fecha+ruta');
    expect(detectRoutePattern([{ consNumber: '061026364', day: '2026-10-06' }])).toBeNull();
  });

  it('arma el número', () => {
    expect(buildConsNumber('fecha+ruta', '364', '2026-10-07')).toBe('071026364');
    expect(buildConsNumber('ruta+fecha', '364', '2026-10-05')).toBe('36405102026');
  });
});

describe('summarizeRoutes', () => {
  const d = (route: string, day: string, found: number, total: number, type: 'paquete' | 'carga' | null, sub: string | null, cons: string | null) => ({ route, day, found, total, complete: found / total >= 0.9, type, subsidiaryName: sub, consNumber: cons });
  it('por ruta: días recibidos/subidos, cómo se sube, sucursales y días sin subir', () => {
    const r = summarizeRoutes([
      d('364', '2026-10-05', 31, 31, 'paquete', 'Bodega Hermosillo', '36405102026'),
      d('364', '2026-10-05', 31, 31, 'paquete', 'Bodega Hermosillo', '36405102026'), // archivo repetido
      d('364', '2026-10-06', 35, 35, 'paquete', 'Hermosillo', '061026364'),
      d('369', '2026-10-05', 70, 70, 'carga', 'Hermosillo', '051026369'),
      d('369', '2026-10-06', 0, 93, null, null, null),
    ]);
    const r364 = r.find((x) => x.route === '364')!;
    expect(r364).toMatchObject({ daysReceived: 2, daysUploaded: 2, asPackage: 2, missingDays: [] });
    expect(r364.subsidiaries).toEqual([{ name: 'Bodega Hermosillo', days: 1 }, { name: 'Hermosillo', days: 1 }]);
    const r369 = r.find((x) => x.route === '369')!;
    expect(r369).toMatchObject({ daysReceived: 2, daysUploaded: 1, asCharge: 1, missingDays: ['2026-10-06'] });
    expect(r[0].route).toBe('369'); // primero las que tienen días sin subir
  });
});
