import { buildRouteClosureData, mapStatusToDex } from './route-closure.mapper';

const baseInput = () => ({
  subsidiaryName: 'Cd. Obregon',
  vehicleName: 'ECON-01',
  drivers: [{ name: 'Juan Perez' }],
  routes: [{ name: 'R1' }, { name: 'R2' }],
  trackingNumber: 'DESP-1',
  kmsInitial: '100',
  kmsFinal: '250',
  dispatchCreatedAt: '2026-07-18T15:00:00Z',
  now: new Date('2026-07-18T20:00:00Z'),
  allPackages: [
    { trackingNumber: 'A1', shipmentType: 'fedex' },
    { trackingNumber: 'A2', shipmentType: 'dhl' },
    { trackingNumber: 'A3', shipmentType: 'fedex' },
    { trackingNumber: 'A4', shipmentType: 'dhl', payment: { amount: 200, type: 'COD' } },
  ],
  returnedPackages: [
    { trackingNumber: 'A2', shipmentType: 'dhl', status: 'direccion_incorrecta', exceptionCode: '03', recipientName: 'Ana', recipientPhone: '662', recipientAddress: 'Calle 1', commitDateTime: '2026-07-18T19:00:00Z' },
    { trackingNumber: 'A4', shipmentType: 'dhl', status: 'no_entregado', exceptionCode: '12' },
  ],
  podPackages: [
    { trackingNumber: 'A1', shipmentType: 'fedex', payment: { amount: 500, type: 'COD' } },
    { trackingNumber: 'A3', shipmentType: 'fedex' },
  ],
  noVanPackages: [{ trackingNumber: 'X1', status: 'Entregado' }],
  collections: ['REC-1', 'REC-2'],
});

it('mapStatusToDex replica getDexCode del frontend', () => {
  expect(mapStatusToDex('direccion_incorrecta')).toBe('DEX03');
  expect(mapStatusToDex('cliente_no_disponible')).toBe('DEX08');
  expect(mapStatusToDex('rechazado')).toBe('DEX07');
  expect(mapStatusToDex('cambio_fecha_solicitado')).toBe('DEX17');
  expect(mapStatusToDex('entregado')).toBeNull();
  expect(mapStatusToDex(undefined)).toBeNull();
});

it('conteos DEX: 03/07/08 por status (PDF), y desglose completo por exceptionCode (Excel)', () => {
  const d = buildRouteClosureData(baseInput() as any);
  expect(d.stats.dex03CountPdf).toBe(1); // A2 status direccion_incorrecta
  expect(d.stats.dex07CountPdf).toBe(0);
  expect(d.stats.dex08CountPdf).toBe(0);
  expect(d.stats.dex12CountPdf).toBe(1); // A4 exceptionCode 12
  const byCode = (code: string) => d.dexCounts.find((r: any) => r.code === code).count;
  expect(byCode('DEX-03')).toBe(1);
  expect(byCode('DEX-12')).toBe(1);
  expect(byCode('OTROS DEX')).toBe(0);
  expect(byCode('SIN CÓDIGO DEX')).toBe(0);
  expect(byCode('TOTAL DEVOLUCIONES')).toBe(2);
});

it('desglose por paquetería (FedEx/DHL × total/entregado/devuelto)', () => {
  const d = buildRouteClosureData(baseInput() as any);
  expect(d.stats.fedexTotal).toBe(2);
  expect(d.stats.dhlTotal).toBe(2);
  expect(d.stats.fedexDelivered).toBe(2);
  expect(d.stats.dhlDelivered).toBe(0);
  expect(d.stats.fedexReturned).toBe(0);
  expect(d.stats.dhlReturned).toBe(2);
});

it('cobros: PDF solo POD con pago; Excel todos los del despacho con pago (+total)', () => {
  const d = buildRouteClosureData(baseInput() as any);
  expect(d.podCharges).toHaveLength(1);
  expect(d.podCharges[0]).toMatchObject({ trackingNumber: 'A1', type: 'COD', amountPdf: '$500' });
  // allCharges: A4 (devuelto, con pago) también cuenta -> 1 dato + 1 fila de total
  expect(d.allCharges).toHaveLength(2);
  expect(d.allCharges[0]).toMatchObject({ trackingNumber: 'A4', amount: 200, type: 'COD' });
  expect(d.allCharges[1]).toMatchObject({ index: 'TOTAL COBROS', amount: 200 });
  expect(d.allChargesTotal).toBe(200);
});

it('% devolución = devueltos / total original', () => {
  const d = buildRouteClosureData(baseInput() as any);
  expect(d.stats.originalCount).toBe(4);
  expect(d.stats.returnedCount).toBe(2);
  expect(d.stats.returnRateFmt).toBe('50.0%');
  expect(d.stats.returnRateHigh).toBe(true);
  expect(d.stats.deliveredCount).toBe(2); // max(0, 4 - 2)
});

it('collectionRows agrega fila de TOTAL solo cuando hay recolecciones (Excel-only, no afecta PDF)', () => {
  const d = buildRouteClosureData(baseInput() as any);
  expect(d.collectionRows).toHaveLength(3); // 2 + total
  expect(d.collectionRows[2]).toMatchObject({ index: 'TOTAL RECOLECCIONES', trackingNumber: '2' });
  expect(d.collections).toEqual(['REC-1', 'REC-2']); // usado crudo por el PDF (flex-wrap)

  const empty = buildRouteClosureData({ ...baseInput(), collections: [] } as any);
  expect(empty.collectionRows).toHaveLength(0);
  expect(empty.hasCollections).toBe(false);
});

it('returnedRows no lleva fila de total (compartido con PDF); el total va en `returnedTotalRow` (banda Excel)', () => {
  const d = buildRouteClosureData(baseInput() as any);
  expect(d.returnedRows).toHaveLength(2);
  expect(d.returnedRows[0]).toMatchObject({ trackingNumber: 'A2', motivoPdf: 'DEX03', motivoExcel: 'DEX-03', shipmentTypeLabel: 'DHL' });
  expect(d.returnedRows[1]).toMatchObject({ trackingNumber: 'A4', motivoPdf: 'N/A', motivoExcel: 'DEX-12' });
  expect(d.returnedTotalRow).toEqual(['TOTAL DEVOLUCIONES: 2']);
  expect(d.hasReturned).toBe(true);
});

it('sin devueltos/no-van/recolecciones/cobros: banderas `has*` en false, listas vacías', () => {
  const d = buildRouteClosureData({
    subsidiaryName: 'S', drivers: [], routes: [], trackingNumber: 'T',
    allPackages: [], returnedPackages: [], podPackages: [],
  } as any);
  expect(d.hasReturned).toBe(false);
  expect(d.hasNoVan).toBe(false);
  expect(d.hasCollections).toBe(false);
  expect(d.hasPodCharges).toBe(false);
  expect(d.hasAllCharges).toBe(false);
  expect(d.mainDriver).toBe('No asignado');
  expect(d.routeNames).toBe('No asignado');
  expect(d.stats.returnRateFmt).toBe('0.0%');
});

it('header/info vars', () => {
  const d = buildRouteClosureData(baseInput() as any);
  expect(d.title).toBe('CIERRE DE RUTA');
  expect(d.dispatchDate).toBe('2026-07-18');
  expect(d.generalInfoRows.find((r: any) => r.label === 'Total Paquetes').value).toBe(4);
  expect(d.generalInfoRows.find((r: any) => r.label === 'Km Inicial/Final').value).toBe('100 / 250 km');
});
