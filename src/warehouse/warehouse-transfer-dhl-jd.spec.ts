// src/warehouse/warehouse-transfer-dhl-jd.spec.ts
import {
  buildTransferNotificationHeader,
  buildWarehouseExcelData,
  buildWarehousePdfData,
} from './warehouse.service';
import { warehousePackageCode } from './warehouse.helpers';

const pkgs: any[] = [
  { trackingNumber: '794512345678', shipmentType: 'fedex' },
  { trackingNumber: '1234567890', dhlUniqueId: 'JD014600012345678901', shipmentType: 'dhl' },
  { trackingNumber: 'F2-CARGA', isCharge: true },
];

describe('JD de DHL en archivos de traspaso', () => {
  it('warehousePackageCode: JD solo cuando se pide y el paquete lo trae', () => {
    expect(warehousePackageCode(pkgs[1], true)).toBe('JD014600012345678901');
    expect(warehousePackageCode(pkgs[1], false)).toBe('1234567890');
    expect(warehousePackageCode(pkgs[0], true)).toBe('794512345678');
    expect(warehousePackageCode({ dhlUniqueId: 'JD1' }, false)).toBe('JD1');
  });

  it('traspaso: PDF y Excel imprimen el JD para DHL y la guía para FedEx/cargas', () => {
    const header = buildTransferNotificationHeader({ warehouse: { name: 'Bodega Hermosillo' } }, 'Cd. Obregón');
    expect(header.dhlShowsUniqueId).toBe(true);
    const pdf = buildWarehousePdfData(header, pkgs, 'America/Hermosillo');
    const xls = buildWarehouseExcelData(header, pkgs, 'America/Hermosillo');
    for (const d of [pdf, xls]) {
      expect(d.rows.map((r: any) => r.trackingNumber)).toEqual([
        '794512345678',
        'JD014600012345678901',
        'F2-CARGA',
      ]);
    }
  });

  it('salida a ruta: DHL sigue con la guía', () => {
    const header = { subsidiary: { name: 'Hermosillo' }, title: 'SALIDA A RUTA' };
    const pdf = buildWarehousePdfData(header, pkgs, 'America/Hermosillo');
    expect(pdf.rows[1].trackingNumber).toBe('1234567890');
  });
});
