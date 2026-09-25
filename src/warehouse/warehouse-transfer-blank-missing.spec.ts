// src/warehouse/warehouse-transfer-blank-missing.spec.ts
// Traspaso: Administración procesa el PDF/Excel en otro sistema que espera las
// celdas VACÍAS cuando falta el dato (no "N/A" / "Sin Teléfono").
import { blankIfMissing } from './warehouse.helpers';
import {
  buildTransferNotificationHeader,
  buildWarehouseExcelData,
  buildWarehousePdfData,
} from './warehouse.service';

describe('blankIfMissing', () => {
  it.each([
    [null], [undefined], [''], ['   '], ['N/A'], ['n/a'], ['NA'], ['N/D'],
    ['Sin Teléfono'], ['sin telefono'], ['SIN  TELÉFONO'], ['S/Tel'], ['null'], ['-'],
  ])('%p -> ""', (v) => {
    expect(blankIfMissing(v)).toBe('');
  });

  it('conserva los datos reales (con trim)', () => {
    expect(blankIfMissing(' Calle 1 ')).toBe('Calle 1');
    expect(blankIfMissing('6441234567')).toBe('6441234567');
    expect(blankIfMissing(85000)).toBe('85000');
    expect(blankIfMissing('Nadia')).toBe('Nadia');
  });
});

const emptyPkg: any = {
  trackingNumber: 'G1', recipientName: 'N/A', recipientAddress: 'N/A',
  recipientZip: 'N/A', recipientPhone: 'Sin Teléfono', commitDateTime: null,
};
const fullPkg: any = {
  trackingNumber: 'G2', recipientName: 'Ana', recipientAddress: 'Calle 1',
  recipientZip: '85000', recipientPhone: '644', payment: { amount: 100, type: 'COD' },
  commitDateTime: null,
};

describe('archivos de traspaso con datos faltantes', () => {
  const header = buildTransferNotificationHeader(
    { warehouse: { name: 'Bodega Hermosillo' }, vehicle: null, drivers: [], routes: [], trackingNumber: 'T1' },
    'Cabo San Lucas',
  );

  it('el header de traspaso activa blankMissing', () => {
    expect(header.blankMissing).toBe(true);
  });

  it('PDF: destinatario, cobro y vehículo faltantes van vacíos; los reales se conservan', () => {
    const d = buildWarehousePdfData(header, [emptyPkg, fullPkg], 'America/Hermosillo');
    expect(d.rows[0]).toMatchObject({
      recipientName: '', recipientAddress: '', recipientZip: '', recipientPhone: '', payment: '',
    });
    expect(d.rows[1]).toMatchObject({
      recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000',
      recipientPhone: '644', payment: 'COD $100.00',
    });
    expect(d.vehicleName).toBe('');
    expect(d.subsidiaryName).toBe('Cabo San Lucas');
    expect(d.subsidiaryLabel).toBe('SUCURSAL DESTINO');
  });

  it('Excel: destinatario, cobro, rutas/conductores/unidad faltantes van vacíos', () => {
    const d = buildWarehouseExcelData(header, [emptyPkg, fullPkg], 'America/Hermosillo');
    expect(d.rows[0]).toMatchObject({
      recipientName: '', recipientAddress: '', recipientZip: '', recipientPhone: '', payment: '',
    });
    expect(d.rows[1]).toMatchObject({ recipientName: 'Ana', recipientPhone: '644', payment: 'COD $100.00' });
    expect(d.rutas).toBe('');
    expect(d.conductores).toBe('');
    expect(d.unidad).toBe('');
  });

  it('salida a ruta (no traspaso) conserva el comportamiento actual con "N/A"', () => {
    const ruta: any = { title: 'SALIDA A RUTA', subsidiary: { name: 'Cd. Obregón' } };
    const pdf = buildWarehousePdfData(ruta, [emptyPkg], 'America/Hermosillo');
    expect(pdf.vehicleName).toBe('N/A');
    expect(pdf.rows[0].payment).toBe('N/A');
    const xls = buildWarehouseExcelData(ruta, [emptyPkg], 'America/Hermosillo');
    expect(xls.unidad).toBe('N/A');
  });
});
