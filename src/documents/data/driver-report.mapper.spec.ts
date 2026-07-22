import { buildDriverReportData, pctEffColor, pctRetColor } from './driver-report.mapper';

describe('pctEffColor (umbral % Efectividad, B3)', () => {
  it('verde >= 0.90', () => {
    expect(pctEffColor(0.9)).toBe('059669');
    expect(pctEffColor(1)).toBe('059669');
  });
  it('ámbar >= 0.75 y < 0.90', () => {
    expect(pctEffColor(0.75)).toBe('D97706');
    expect(pctEffColor(0.89)).toBe('D97706');
  });
  it('rojo < 0.75', () => {
    expect(pctEffColor(0.74)).toBe('E11D48');
    expect(pctEffColor(0)).toBe('E11D48');
  });
});

describe('pctRetColor (umbral % Retorno, B3)', () => {
  it('verde <= 0.05', () => {
    expect(pctRetColor(0.05)).toBe('059669');
    expect(pctRetColor(0)).toBe('059669');
  });
  it('ámbar > 0.05 y <= 0.15', () => {
    expect(pctRetColor(0.06)).toBe('D97706');
    expect(pctRetColor(0.15)).toBe('D97706');
  });
  it('rojo > 0.15', () => {
    expect(pctRetColor(0.16)).toBe('E11D48');
    expect(pctRetColor(1)).toBe('E11D48');
  });
});

describe('buildDriverReportData', () => {
  const summaryData = [
    {
      driverName: 'Juan Pérez', total: '10', delivered: '9', returned: '1',
      dex03: '0', dex07: '1', dex08: '0', pending: '0',
      fechaRequested: '0', returnedFedex: '0', unmapped: '0',
    },
    {
      // alias en minúsculas (fiel a como puede regresar la BD), y con más devoluciones -> rojo
      drivername: 'Ana López', total: '10', delivered: '5', returned: '4',
      dex03: '2', dex07: '1', dex08: '1', pending: '1',
      fecharequested: '0', returnedfedex: '0', unmapped: '0',
    },
  ];

  const detailsData = [
    { driverName: 'Juan Pérez', routeName: 'R1', subsidiaryName: 'Obregón', tracking: 'T1', status: 'entregado', realstatus: 'entregado', exceptionCode: '-', commitDate: '2026-07-20T10:00:00Z', cp: '85000', recipient: 'Cliente 1' },
    { drivername: 'ana lópez', routename: 'R2', subsidiaryname: 'Obregón', tracking: 'T2', status: 'devuelto_a_fedex', realstatus: 'direccion_incorrecta', exceptioncode: '03', commitDate: null, cp: '', recipient: '' },
  ];

  it('hoja 1: calcula pctEff/pctRet, arma pctEffFill/pctRetFill por umbral y zebra por posición', () => {
    const data = buildDriverReportData({ startDate: '2026-07-01T00:00:00Z', endDate: '2026-07-20T00:00:00Z', summaryData, detailsData: [] });
    expect(data.driverRows.length).toBe(3); // 2 choferes + fila de totales
    const juan = data.driverRows[0];
    expect(juan.driverName).toBe('Juan Pérez');
    expect(juan.total).toBe(10);
    expect(juan.pctEff).toBeCloseTo(0.9);
    expect(juan.pctRet).toBeCloseTo(0.1);
    expect(juan.pctEffFill).toBe('059669'); // 0.9 -> verde
    expect(juan.pctRetFill).toBe('D97706'); // 0.10 -> ámbar (>0.05 y <=0.15)
    expect(juan.rowFill).toBe('FFFFFF'); // fila 0 (par) -> blanco

    const ana = data.driverRows[1];
    expect(ana.driverName).toBe('Ana López'); // toma el alias en minúsculas
    expect(ana.pctEff).toBeCloseTo(0.5);
    expect(ana.pctRet).toBeCloseTo(0.4);
    expect(ana.pctEffFill).toBe('E11D48'); // 0.5 -> rojo
    expect(ana.pctRetFill).toBe('E11D48'); // 0.4 -> rojo
    expect(ana.rowFill).toBe('F8FAFC'); // fila 1 (impar) -> gris

    // Fila de totales
    const totales = data.driverRows[2];
    expect(totales.driverName).toBe('TOTALES GLOBALES');
    expect(totales.total).toBe(20);
    expect(totales.delivered).toBe(14);
    expect(totales.returned).toBe(5);
    expect(totales.rowFill).toBe('E2E8F0');
    // La fila de totales NO lleva semáforo por celda (fiel al legacy: fill uniforme, sin pctEffFill/pctRetFill)
    expect(totales.pctEffFill).toBeUndefined();
    expect(totales.pctRetFill).toBeUndefined();
  });

  it('sin choferes: no agrega fila de totales', () => {
    const data = buildDriverReportData({ startDate: '2026-07-01', endDate: '2026-07-20', summaryData: [], detailsData: [] });
    expect(data.driverRows).toEqual([]);
  });

  it('subtítulo de periodo (yyyy-MM-dd, fiel al legacy `split(\'T\')[0]`)', () => {
    const data = buildDriverReportData({ startDate: '2026-07-01T06:00:00.000Z', endDate: '2026-07-20T06:00:00.000Z', summaryData: [], detailsData: [] });
    expect(data.periodLabel).toBe('Periodo Analizado: 2026-07-01 al 2026-07-20');
  });

  it('hoja 2: normaliza alias, arma "displayStatus" con DEX oculto, dexColor solo si hay DEX, fecha es-MX o "Sin Fecha"', () => {
    const data = buildDriverReportData({ startDate: '2026-07-01', endDate: '2026-07-20', summaryData: [], detailsData });
    expect(data.detailRows.length).toBe(2);

    const r1 = data.detailRows[0];
    expect(r1.driver).toBe('Juan Pérez');
    expect(r1.route).toBe('R1');
    expect(r1.subsidiary).toBe('Obregón');
    expect(r1.status).toBe('ENTREGADO');
    expect(r1.dex).toBe('-');
    expect(r1.dexColor).toBeFalsy();
    expect(r1.commit).not.toBe('Sin Fecha');
    expect(r1.cp).toBe('85000');
    expect(r1.recipient).toBe('Cliente 1');
    expect(r1.rowFill).toBe('FFFFFF');

    const r2 = data.detailRows[1];
    expect(r2.driver).toBe('ana lópez'); // alias en minúsculas
    expect(r2.status).toBe('DEVUELTO A FEDEX (Era: DIRECCION INCORRECTA)');
    expect(r2.dex).toBe('03');
    expect(r2.dexColor).toBe('E11D48');
    expect(r2.commit).toBe('Sin Fecha');
    expect(r2.cp).toBe('S/C');
    expect(r2.recipient).toBe('Sin Nombre');
    expect(r2.rowFill).toBe('F8FAFC');
  });
});
