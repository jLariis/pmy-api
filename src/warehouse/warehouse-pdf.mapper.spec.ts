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

  it('paquete NO cobro (isCharge:false) con payment.amount -> muestra $amount y rowClass "pago"', () => {
    const header: any = { title: 'SALIDA A RUTA', subsidiary: { name: 'Cd. Obregón' }, vehicle: { name: 'V1' }, trackingNumber: 'T1' };
    const pkgs: any[] = [
      {
        trackingNumber: 'G2',
        recipientName: 'Luis',
        recipientAddress: 'Calle 2',
        recipientZip: '85001',
        recipientPhone: '644',
        isCharge: false,
        payment: { amount: 50 },
        // fecha de compromiso lejos de hoy para no disparar vencehoy
        commitDateTime: new Date('2000-01-01T00:00:00Z'),
      },
    ];
    const d = buildWarehousePdfData(header, pkgs, 'America/Hermosillo');
    expect(d.rows[0].payment).toBe('$50');
    expect(d.rows[0].rowClass).toBe('pago');
  });

  it('paquete de cobro (isCharge:true) SIN payment -> payment "N/A" y rowClass ""', () => {
    const header: any = { title: 'SALIDA A RUTA', subsidiary: { name: 'Cd. Obregón' }, vehicle: { name: 'V1' }, trackingNumber: 'T1' };
    const pkgs: any[] = [
      {
        trackingNumber: 'G3',
        recipientName: 'Marta',
        recipientAddress: 'Calle 3',
        recipientZip: '85002',
        recipientPhone: '644',
        isCharge: true,
        payment: null,
        paymentAmount: null,
        commitDateTime: new Date('2000-01-01T00:00:00Z'),
      },
    ];
    const d = buildWarehousePdfData(header, pkgs, 'America/Hermosillo');
    expect(d.rows[0].payment).toBe('N/A');
    expect(d.rows[0].rowClass).toBe('');
  });

  it('paquete que vence hoy Y con pago -> rowClass "vencehoy" (vence-hoy tiene precedencia sobre pago)', () => {
    const header: any = { title: 'SALIDA A RUTA', subsidiary: { name: 'Cd. Obregón' }, vehicle: { name: 'V1' }, trackingNumber: 'T1' };
    const pkgs: any[] = [
      {
        trackingNumber: 'G4',
        recipientName: 'Carlos',
        recipientAddress: 'Calle 4',
        recipientZip: '85003',
        recipientPhone: '644',
        isCharge: true,
        payment: { amount: 200 },
        commitDateTime: new Date(), // hoy
      },
    ];
    const d = buildWarehousePdfData(header, pkgs, 'America/Hermosillo');
    expect(d.rows[0].payment).toBe('$200');
    expect(d.rows[0].rowClass).toBe('vencehoy');
  });
});
