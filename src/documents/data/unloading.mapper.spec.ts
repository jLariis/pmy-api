import { buildUnloadingData, truncate, formatPaymentLabel } from './unloading.mapper';

const baseInput = () => ({
  subsidiaryName: 'Cd. Obregon',
  vehicleName: 'ECON-01',
  trackingNumber: 'DESEMB-1',
  now: new Date('2026-07-18T20:00:00Z'),       // 13:00 Hermosillo (UTC-7)
  createdAt: '2026-07-18T18:30:00Z',            // 11:30 Hermosillo
  packages: [
    { trackingNumber: 'T1', recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000',
      recipientPhone: '6620000000', isCharge: true, payment: { amount: 500, type: 'COD' },
      commitDateTime: '2026-07-18T20:15:00Z' },
    { trackingNumber: 'T2', recipientName: 'Beto', isHighValue: true },
  ],
  missingPackages: ['X1', { trackingNumber: 'X2', recipientName: 'Carlos' }],
  unScannedTrackings: ['Y1', 'Y2'],
});

it('header/info vars: sucursal, unidad, total, seguimiento, fechas Hermosillo', () => {
  const d = buildUnloadingData(baseInput() as any);
  expect(d.subsidiaryName).toBe('Cd. Obregon');
  expect(d.vehicleName).toBe('ECON-01');
  expect(d.trackingNumber).toBe('DESEMB-1');
  expect(d.totalPackages).toBe(2);
  expect(d.nowDateTime).toBe('18/07/2026 13:00');       // render-time (now), Hermosillo
  expect(d.createdDateTime).toBe('18/07/2026 11:30');   // createdAt, Hermosillo
});

it('vehicleName por defecto N/A si falta', () => {
  const d = buildUnloadingData({ subsidiaryName: 'S', trackingNumber: 'T', packages: [] } as any);
  expect(d.vehicleName).toBe('N/A');
});

it('rows: icons [C][$][H], truncado 32/38, cobro con Intl es-MX, fecha/hora Hermosillo (dd/MM/yyyy, HH:mm y HH:mm:ss)', () => {
  const d = buildUnloadingData(baseInput() as any);
  const t1 = d.rows.find((r: any) => r.trackingNumber === 'T1');
  const t2 = d.rows.find((r: any) => r.trackingNumber === 'T2');
  expect(t1.icons).toBe('[C][$]');
  expect(t2.icons).toBe('[H]');
  expect(t1.payment).toBe('COD $500.00');
  expect(t2.payment).toBe('');
  expect(t1.date).toBe('18/07/2026');
  expect(t1.time).toBe('13:15');
  expect(t1.timeXlsx).toBe('13:15:00');
  expect(t1.recipientName).toBe('Ana');
  expect(t1.recipientNameXlsx).toBe('Ana');
  expect(t1.recipientAddress).toBe('Calle 1');
  expect(t1.recipientAddressXlsx).toBe('Calle 1');
});

it('rows: zebra rowFill F2F2F2 en índices pares (0-based)', () => {
  const d = buildUnloadingData(baseInput() as any);
  expect(d.rows[0].rowFill).toBe('F2F2F2');
  expect(d.rows[1].rowFill).toBeNull();
});

it('truncate a 32 y 38 con "..." al exceder', () => {
  expect(truncate('x'.repeat(40), 32)).toHaveLength(32);
  expect(truncate('x'.repeat(40), 32).endsWith('...')).toBe(true);
  expect(truncate('corto', 38)).toBe('corto');
  expect(truncate('', 32)).toBe('');
});

it('formatPaymentLabel: vacío sin payment, formateado con payment', () => {
  expect(formatPaymentLabel(null)).toBe('');
  expect(formatPaymentLabel({ amount: 1234.5, type: 'ROD' })).toBe('ROD $1,234.50');
});

it('missingPackages: normaliza strings y objetos, defaults para PDF, lista plana para Excel', () => {
  const d = buildUnloadingData(baseInput() as any);
  expect(d.hasMissing).toBe(true);
  expect(d.missingTrackings).toEqual(['X1', 'X2']);
  const m1 = d.missingRows.find((r: any) => r.trackingNumber === 'X1');
  const m2 = d.missingRows.find((r: any) => r.trackingNumber === 'X2');
  expect(m1.recipientName).toBe('Sin Nombre');
  expect(m1.recipientAddress).toBe('Sin Dirección');
  expect(m1.recipientZip).toBe('No CP');
  expect(m1.recipientPhone).toBe('Sin Teléfono');
  expect(m2.recipientName).toBe('Carlos');
  expect(m2.recipientAddress).toBe('Sin Dirección');
});

it('sin faltantes ni sobrantes -> hasMissing/hasUnScanned en false', () => {
  const d = buildUnloadingData({ subsidiaryName: 'S', trackingNumber: 'T', packages: [] } as any);
  expect(d.hasMissing).toBe(false);
  expect(d.missingTrackings).toEqual([]);
  expect(d.missingRows).toEqual([]);
  expect(d.hasUnScanned).toBe(false);
  expect(d.unScannedTrackings).toEqual([]);
});

it('unScannedTrackings pasa tal cual (solo tracking, sin objeto)', () => {
  const d = buildUnloadingData(baseInput() as any);
  expect(d.unScannedTrackings).toEqual(['Y1', 'Y2']);
  expect(d.hasUnScanned).toBe(true);
});
