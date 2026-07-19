import { buildInventoryData } from './inventory.mapper';

const baseInput = () => ({
  subsidiaryName: 'Cd. Obregon',
  trackingNumber: 'INV-1',
  inventoryDate: '2026-07-18T18:30:00Z', // 11:30 Hermosillo
  now: new Date('2026-07-18T20:00:00Z'),  // 13:00 Hermosillo (UTC-7)
  packages: [
    { trackingNumber: 'T1', recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000',
      recipientPhone: '6620000000', isCharge: true, payment: { amount: 500, type: 'COD' },
      commitDateTime: '2026-07-18T20:15:00Z' },
    { trackingNumber: 'T2', recipientName: 'Beto', isHighValue: true },
  ],
  missingTrackings: ['X1', 'X2'],
  unScannedTrackings: ['Y1'],
});

it('header/info vars: sucursal, seguimiento, total, fecha inventario (Hermosillo)', () => {
  const d = buildInventoryData(baseInput() as any);
  expect(d.subsidiaryName).toBe('Cd. Obregon');
  expect(d.trackingNumber).toBe('INV-1');
  expect(d.totalPackages).toBe(2);
  expect(d.inventoryDate).toBe('2026-07-18'); // yyyy-MM-dd, fiel a C5 (reportDate)
  expect(d.inventoryDateTime).toBe('2026-07-18 11:30'); // yyyy-MM-dd HH:mm, fiel a C6
  expect(d.generatedDate).toBe('2026-07-18'); // now, Hermosillo
  expect(d.generatedTime).toBe('13:00:00');
});

it('subsidiaryName por defecto N/A si falta', () => {
  const d = buildInventoryData({ packages: [] } as any);
  expect(d.subsidiaryName).toBe('N/A');
});

it('rows: badges booleans (isCharge/hasPayment/isHighValue), truncado 20/22, cobro crudo "${type} $${amount}", fecha yyyy-MM-dd / hora HH:mm / HH:mm:ss (Hermosillo)', () => {
  const d = buildInventoryData(baseInput() as any);
  const t1 = d.rows.find((r: any) => r.trackingNumber === 'T1');
  const t2 = d.rows.find((r: any) => r.trackingNumber === 'T2');
  expect(t1.isCharge).toBe(true);
  expect(t1.hasPayment).toBe(true);
  expect(t1.isHighValue).toBe(false);
  expect(t2.isCharge).toBe(false);
  expect(t2.hasPayment).toBe(false);
  expect(t2.isHighValue).toBe(true);
  expect(t1.payment).toBe('COD $500'); // crudo, sin Intl (fiel a C5/C6)
  expect(t2.payment).toBe('');
  expect(t1.date).toBe('2026-07-18');
  expect(t1.time).toBe('13:15');
  expect(t1.timeXlsx).toBe('13:15:00');
  expect(t1.recipientName).toBe('Ana');
  expect(t1.recipientNameXlsx).toBe('Ana');
  expect(t1.recipientAddress).toBe('Calle 1');
  expect(t1.recipientAddressXlsx).toBe('Calle 1');
});

it('trunca recipientName a 20 y recipientAddress a 22 para el PDF (Xlsx sin truncar)', () => {
  const d = buildInventoryData({
    subsidiaryName: 'S', packages: [
      { trackingNumber: 'P1', recipientName: 'x'.repeat(30), recipientAddress: 'y'.repeat(30) },
    ],
  } as any);
  const r = d.rows[0];
  expect(r.recipientName).toHaveLength(20);
  expect(r.recipientName.endsWith('...')).toBe(true);
  expect(r.recipientNameXlsx).toHaveLength(30);
  expect(r.recipientAddress).toHaveLength(22);
  expect(r.recipientAddress.endsWith('...')).toBe(true);
  expect(r.recipientAddressXlsx).toHaveLength(30);
});

it('rows: zebra rowFill F2F2F2 / rowClass even en índices pares (0-based)', () => {
  const d = buildInventoryData(baseInput() as any);
  expect(d.rows[0].rowFill).toBe('F2F2F2');
  expect(d.rows[0].rowClass).toBe('even');
  expect(d.rows[1].rowFill).toBeNull();
  expect(d.rows[1].rowClass).toBe('');
});

it('sin commitDateTime -> date/time/timeXlsx vacíos', () => {
  const d = buildInventoryData({ subsidiaryName: 'S', packages: [{ trackingNumber: 'P1' }] } as any);
  expect(d.rows[0].date).toBe('');
  expect(d.rows[0].time).toBe('');
  expect(d.rows[0].timeXlsx).toBe('');
});

it('stats: total, válidos (isValid !== false, default true), carga, alto valor', () => {
  const d = buildInventoryData({
    subsidiaryName: 'S',
    packages: [
      { trackingNumber: 'P1', isCharge: true },
      { trackingNumber: 'P2', isHighValue: true },
      { trackingNumber: 'P3', isValid: false },
      { trackingNumber: 'P4' },
    ],
  } as any);
  expect(d.stats.total).toBe(4);
  expect(d.stats.valid).toBe(3); // P3 explícitamente inválido
  expect(d.stats.carga).toBe(1);
  expect(d.stats.highValue).toBe(1);
});

it('missingTrackings/unScannedTrackings: listas planas + hasMissing/hasUnScanned', () => {
  const d = buildInventoryData(baseInput() as any);
  expect(d.missingTrackings).toEqual(['X1', 'X2']);
  expect(d.hasMissing).toBe(true);
  expect(d.unScannedTrackings).toEqual(['Y1']);
  expect(d.hasUnScanned).toBe(true);
});

it('sin faltantes ni sobrantes -> hasMissing/hasUnScanned en false, listas vacías', () => {
  const d = buildInventoryData({ subsidiaryName: 'S', packages: [] } as any);
  expect(d.hasMissing).toBe(false);
  expect(d.missingTrackings).toEqual([]);
  expect(d.hasUnScanned).toBe(false);
  expect(d.unScannedTrackings).toEqual([]);
});

it('missingPreview/unScannedPreview: máx 15 + contador de resto (fiel a C5, slice(0,15))', () => {
  const many = Array.from({ length: 18 }, (_, i) => `M${i + 1}`);
  const d = buildInventoryData({ subsidiaryName: 'S', packages: [], missingTrackings: many } as any);
  expect(d.missingPreview).toHaveLength(15);
  expect(d.missingPreview[0]).toBe('M1');
  expect(d.missingExtra).toBe(3);
  expect(d.hasMissingExtra).toBe(true);
});

it('missingExtra en 0 y hasMissingExtra false cuando hay <=15', () => {
  const d = buildInventoryData({ subsidiaryName: 'S', packages: [], missingTrackings: ['A', 'B'] } as any);
  expect(d.missingExtra).toBe(0);
  expect(d.hasMissingExtra).toBe(false);
  expect(d.missingPreview).toEqual(['A', 'B']);
});
