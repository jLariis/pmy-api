import { buildReturningData, mapReasonToDex } from './returning.mapper';

const baseInput = () => ({
  subsidiaryName: 'Cd. Obregon',
  now: new Date('2026-07-22T18:00:00Z'),
  devolutions: [
    { trackingNumber: 'D1', reason: '03' },
    { trackingNumber: 'D2', reason: '07' },
  ],
  collections: [
    { trackingNumber: 'C1' },
    { trackingNumber: 'C2' },
    { trackingNumber: 'C3' },
  ],
});

it('mapReasonToDex replica STATUS_TO_DEX_CODE (subconjunto numérico) del frontend', () => {
  expect(mapReasonToDex('03')).toBe('DEX03');
  expect(mapReasonToDex('07')).toBe('DEX07');
  expect(mapReasonToDex('08')).toBe('DEX08');
  expect(mapReasonToDex('12')).toBe('DEX12');
  expect(mapReasonToDex('17')).toBe('DEX17');
  expect(mapReasonToDex('DEX03')).toBe('DEX03'); // ya viene con prefijo
  expect(mapReasonToDex(undefined)).toBe('N/A');
  expect(mapReasonToDex(null)).toBe('N/A');
  expect(mapReasonToDex('')).toBe('N/A');
  expect(mapReasonToDex('otro motivo')).toBe('OTRO MOTIVO'); // fallback fiel a getStatusCode: regresa tal cual
});

it('summary: totales de recolecciones/devoluciones/general', () => {
  const d = buildReturningData(baseInput() as any);
  expect(d.totalDevoluciones).toBe(2);
  expect(d.totalRecolecciones).toBe(3);
  expect(d.totalGeneral).toBe(5);
});

it('header: localidad en mayúsculas y fecha dd/MM/yyyy (Hermosillo)', () => {
  const d = buildReturningData(baseInput() as any);
  expect(d.subsidiaryNameUpper).toBe('CD. OBREGON');
  expect(d.generatedDate).toBe('22/07/2026');
});

it('recoleccionRows: sucursal = primeras 3 letras en mayúsculas', () => {
  const d = buildReturningData(baseInput() as any);
  expect(d.recoleccionRows[0]).toMatchObject({ trackingNumber: 'C1', sucursal: 'CD.', index: 1 });
  expect(d.recoleccionRows[2]).toMatchObject({ trackingNumber: 'C3', sucursal: 'CD.', index: 3 });
});

it('devolucionRows: motivo vía mapReasonToDex, isDex=true cuando el motivo contiene DEX', () => {
  const d = buildReturningData(baseInput() as any);
  expect(d.devolucionRows[0]).toMatchObject({ index: 1, trackingNumber: 'D1', motivo: 'DEX03', isDex: true });
  expect(d.devolucionRows[1]).toMatchObject({ index: 2, trackingNumber: 'D2', motivo: 'DEX07', isDex: true });
});

it('Excel: filas SIN relleno (tal cual, sin padding a 15)', () => {
  const d = buildReturningData(baseInput() as any);
  expect(d.devolucionRows).toHaveLength(2);
  expect(d.recoleccionRows).toHaveLength(3);
});

it('PDF: filas con relleno hasta 15 SOLO si hay datos (fiel a renderEmptyRows del frontend)', () => {
  const d = buildReturningData(baseInput() as any);
  expect(d.devolucionRowsPdf).toHaveLength(15);
  expect(d.devolucionRowsPdf[2]).toMatchObject({ index: '', trackingNumber: '', motivo: '' });
  expect(d.recoleccionRowsPdf).toHaveLength(15);
  expect(d.recoleccionRowsPdf[3]).toMatchObject({ trackingNumber: '', sucursal: '', index: '' });

  const empty = buildReturningData({ ...baseInput(), devolutions: [], collections: [] } as any);
  expect(empty.devolucionRowsPdf).toHaveLength(0);
  expect(empty.recoleccionRowsPdf).toHaveLength(0);
  expect(empty.devolucionRows).toHaveLength(0);
  expect(empty.recoleccionRows).toHaveLength(0);
});

it('rowClass alterna par/impar (fiel al zebra del frontend, incluso en filas de relleno)', () => {
  const d = buildReturningData(baseInput() as any);
  expect(d.devolucionRowsPdf[0].rowClass).toBe('even');
  expect(d.devolucionRowsPdf[1].rowClass).toBe('');
  expect(d.devolucionRowsPdf[2].rowClass).toBe('even'); // fila de relleno también alterna
});

it('sin devoluciones/recolecciones: 0/0/0 y arreglos vacíos (gap de datos -> vacío, no inventa)', () => {
  const d = buildReturningData({ subsidiaryName: 'S', devolutions: [], collections: [] } as any);
  expect(d.totalDevoluciones).toBe(0);
  expect(d.totalRecolecciones).toBe(0);
  expect(d.totalGeneral).toBe(0);
  expect(d.devolucionRows).toEqual([]);
  expect(d.recoleccionRows).toEqual([]);
});

it('dexLegend: leyenda fija DEX 03/07/08/17 (fiel al footer del frontend)', () => {
  const d = buildReturningData(baseInput() as any);
  expect(d.dexLegend).toEqual([
    'DEX 03: DATOS INCORRECTOS / DOM NO EXISTE',
    'DEX 07: RECHAZO DE PAQUETES POR EL CLIENTE',
    'DEX 08: VISITA / DOMICILIO CERRADO',
    'DEX 17: CAMBIO DE FECHA SOLICITADO',
  ]);
});
