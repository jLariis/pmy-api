import { buildRouteDispatchData, truncateDouble, formatPhone } from './route-dispatch.mapper';

const baseInput = () => ({
  subsidiaryName: 'Cd. Obregon', vehicleName: 'ECON-01',
  drivers: [{ name: 'Juan Perez' }], routes: [{ name: 'R1' }, { name: 'R2' }],
  trackingNumber: 'SEG-123', sortByPostalCode: true,
  now: new Date('2026-07-18T20:00:00Z'),        // 13:00 Hermosillo (UTC-7)
  createdAt: '2026-07-18T20:00:00Z',
  packages: [
    { trackingNumber: 'T1', recipientName: 'Ana', recipientZip: '85000', recipientPhone: '5216621234567',
      isCharge: true, payment: { amount: 500, type: 'COD' }, shipmentType: 'fedex', commitDateTime: '2026-07-18T20:00:00Z' },
    { trackingNumber: 'T2', recipientName: 'Beto', recipientZip: '83000', isHighValue: true, shipmentType: 'dhl',
      consolidated: { type: 'aereo' } },
  ],
  invalidTrackings: ['X1', 'X2'],
});

it('stats: cuenta F2/alto valor/cobro/fedex/dhl/vence-hoy y monto', () => {
  const d = buildRouteDispatchData(baseInput() as any);
  expect(d.stats.total).toBe(2);
  expect(d.stats.f2Count).toBe(1);
  expect(d.stats.highValueCount).toBe(1);
  expect(d.stats.cargaCount).toBe(1);
  expect(d.stats.regularCount).toBe(0);         // 2 - 1 - 1
  expect(d.stats.withPaymentCount).toBe(1);
  expect(d.stats.totalPaymentAmount).toBe(500);
  expect(d.stats.montoFmt).toBe('$500.00');
  expect(d.stats.fedexCount).toBe(1);
  expect(d.stats.dhlCount).toBe(1);
  expect(d.stats.expiringTodayCount).toBe(1);   // T1 vence hoy Hermosillo
});

it('orden por CP ascendente (83000 antes que 85000)', () => {
  const d = buildRouteDispatchData(baseInput() as any);
  expect(d.rows.map((r: any) => r.trackingNumber)).toEqual(['T2', 'T1']);
});

it('icons y clases de fila', () => {
  const d = buildRouteDispatchData(baseInput() as any);
  const t1 = d.rows.find((r: any) => r.trackingNumber === 'T1');
  const t2 = d.rows.find((r: any) => r.trackingNumber === 'T2');
  expect(t1.icons).toBe('[C][$]');              // carga + payment (objeto existe)
  expect(t2.icons).toBe('[A][H]');              // aereo + alto valor
  expect(t1.rowClass).toContain('pago');
  expect(t1.rowClass).toContain('vencehoy');
  expect(t1.rowFill).toBe('fff2cc');
  expect(t1.paymentPdf).toBe('COD $500');
  expect(t1.paymentXlsx).toBe('COD $ 500');
});

it('invalidChunks (Excel) e invalidRows (PDF)', () => {
  const d = buildRouteDispatchData(baseInput() as any);
  expect(d.hasInvalid).toBe(true);
  expect(d.invalidChunks).toEqual(['📦 X1    📦 X2']);
  expect(d.invalidRows).toEqual([{ index: 3, trackingNumber: 'X1' }, { index: 4, trackingNumber: 'X2' }]);
});

it('header/info vars', () => {
  const d = buildRouteDispatchData(baseInput() as any);
  expect(d.title).toBe('SALIDA A RUTA');
  expect(d.routeNamesArrow).toBe('R1 -> R2');
  expect(d.driverNames).toBe('Juan Perez');
  expect(d.isHermosillo).toBe(false);
  expect(d.generatedDate).toBe('2026-07-18');
});

it('isHermosillo detecta la sucursal', () => {
  const d = buildRouteDispatchData({ subsidiaryName: 'Hermosillo Centro', drivers: [], routes: [], trackingNumber: 'S', packages: [] } as any);
  expect(d.isHermosillo).toBe(true);
  expect(d.mainDriver).toBe('No asignado');
  expect(d.routeNames).toBe('No asignado');
});

it('truncateDouble aplica 25→22 y 28→26', () => {
  expect(truncateDouble('x'.repeat(30), 25, 22)).toHaveLength(22);
  expect(truncateDouble('corto', 25, 22)).toBe('corto');
});

it('formatPhone', () => {
  expect(formatPhone('')).toBe('N/A');
  expect(formatPhone(undefined)).toBe('N/A');
  expect(formatPhone('Sin Teléfono')).toBe('-');
  expect(formatPhone('(662) 123 4567')).toBe('6621234567');
  expect(formatPhone('5216621234567')).toBe('5216621234567'); // 13 díg → no altera
  expect(formatPhone('526621234567')).toBe('6621234567');     // 12 díg con 52 → quita lada
});
