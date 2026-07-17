// src/warehouse/warehouse-pdf.mapper.spec.ts
import { buildWarehousePdfData } from './warehouse.service';

describe('buildWarehousePdfData', () => {
  it('arma title, flags e isHermosillo + filas con rowClass/payment', () => {
    const header: any = { title: 'SALIDA A RUTA', subsidiary: { name: 'Cd. Obregón' }, vehicle: { name: 'V1' }, trackingNumber: 'T1' };
    const pkgs: any[] = [
      { trackingNumber: 'G1', recipientName: 'Ana', recipientAddress: 'Calle 1', recipientZip: '85000', recipientPhone: '644', isCharge: true, payment: { amount: 100 }, commitDateTime: new Date() },
    ];
    const d = buildWarehousePdfData(header, pkgs, 'America/Hermosillo');
    expect(d.title).toBe('SALIDA A RUTA');
    expect(d.subsidiaryName).toBe('Cd. Obregón');
    expect(d.isHermosillo).toBe(false);
    expect(d.totalPackages).toBe(1);
    expect(d.rows[0].trackingNumber).toBe('G1');
    expect(d.rows[0].payment).toContain('100');   // cobro formateado
    expect(['pago', '', 'vencehoy']).toContain(d.rows[0].rowClass);
    expect(d.rows[0].index).toBe(1);
  });

  it('isHermosillo true cuando la sucursal contiene hermosillo', () => {
    const d = buildWarehousePdfData({ title: 'X', subsidiary: { name: 'Hermosillo Centro' }, vehicle: {}, trackingNumber: '' } as any, [], 'America/Hermosillo');
    expect(d.isHermosillo).toBe(true);
  });
});
