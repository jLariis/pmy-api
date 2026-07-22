// src/warehouse/warehouse-excel.mapper.spec.ts
import { buildWarehouseExcelData } from './warehouse.service';

describe('buildWarehouseExcelData', () => {
  it('arma title/rutas/conductores/unidad/fecha/totalPackages + filas fieles al legacy', () => {
    const header: any = {
      title: 'Salida a Ruta',
      routes: [{ name: 'R1' }, { name: 'R2' }],
      drivers: [{ name: 'Juan' }, { name: 'Pedro' }],
      vehicle: { name: 'ECON-01' },
    };
    const pkgs: any[] = [
      {
        trackingNumber: 'G1', recipientName: 'Ana', recipientAddress: 'Calle 1',
        recipientZip: '85000', recipientPhone: '644', isCharge: true, payment: { amount: 100 },
      },
    ];
    const d = buildWarehouseExcelData(header, pkgs, 'America/Hermosillo');
    expect(d.title).toBe('Salida a Ruta');
    expect(d.rutas).toBe('R1 -> R2');
    expect(d.conductores).toBe('Juan - Pedro');
    expect(d.unidad).toBe('ECON-01');
    expect(d.totalPackages).toBe(1);
    expect(typeof d.fechaDateTime).toBe('string');
    expect(d.fechaDateTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].index).toBe(1);
    expect(d.rows[0].trackingNumber).toBe('G1');
    expect(d.rows[0].recipientName).toBe('Ana');
    expect(d.rows[0].recipientAddress).toBe('Calle 1');
    expect(d.rows[0].recipientZip).toBe('85000');
    expect(d.rows[0].payment).toBe(100);
    expect(d.rows[0].date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(d.rows[0].recipientPhone).toBe('644');
    expect(d.rows[0].signature).toBe('');
  });

  it('title/rutas/conductores/unidad con defaults cuando faltan', () => {
    const d = buildWarehouseExcelData({} as any, [], 'America/Hermosillo');
    expect(d.title).toBe('Salida a Ruta');
    expect(d.rutas).toBe('N/A');
    expect(d.conductores).toBe('N/A');
    expect(d.unidad).toBe('N/A');
    expect(d.totalPackages).toBe(0);
    expect(d.rows).toEqual([]);
  });

  it('usa dhlUniqueId cuando no hay trackingNumber', () => {
    const d = buildWarehouseExcelData({} as any, [{ dhlUniqueId: 'DHL1' }], 'America/Hermosillo');
    expect(d.rows[0].trackingNumber).toBe('DHL1');
  });

  it('paquete SIN cobro (isCharge:false) -> payment "N/A" aunque tenga payment.amount', () => {
    const d = buildWarehouseExcelData(
      {} as any,
      [{ trackingNumber: 'G2', isCharge: false, payment: { amount: 50 } }],
      'America/Hermosillo',
    );
    expect(d.rows[0].payment).toBe('N/A');
  });

  it('paquete de cobro (isCharge:true) sin payment ni paymentAmount -> payment 0', () => {
    const d = buildWarehouseExcelData(
      {} as any,
      [{ trackingNumber: 'G3', isCharge: true }],
      'America/Hermosillo',
    );
    expect(d.rows[0].payment).toBe(0);
  });

  it('usa paymentAmount cuando no hay payment.amount', () => {
    const d = buildWarehouseExcelData(
      {} as any,
      [{ trackingNumber: 'G4', isCharge: true, paymentAmount: 75 }],
      'America/Hermosillo',
    );
    expect(d.rows[0].payment).toBe(75);
  });

  it('recipientPhone cae a cadena vacía cuando falta', () => {
    const d = buildWarehouseExcelData(
      {} as any,
      [{ trackingNumber: 'G5' }],
      'America/Hermosillo',
    );
    expect(d.rows[0].recipientPhone).toBe('');
  });
});
