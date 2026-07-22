import { buildPendingShipmentsData, PendingShipmentsInput } from './pending-shipments.mapper';

function baseInput(overrides: Partial<PendingShipmentsInput> = {}): PendingShipmentsInput {
  return { shipments: [], ...overrides };
}

describe('buildPendingShipmentsData', () => {
  it('mapea tipo fedex -> FedEx (fiel a tipoXls del legacy)', () => {
    const data = buildPendingShipmentsData(baseInput({ shipments: [{ trackingNumber: 'T1', shipmentType: 'fedex' } as any] }));
    expect(data.rows[0].tipo).toBe('FedEx');
  });

  it('mapea tipo dhl -> DHL', () => {
    const data = buildPendingShipmentsData(baseInput({ shipments: [{ trackingNumber: 'T2', shipmentType: 'dhl' } as any] }));
    expect(data.rows[0].tipo).toBe('DHL');
  });

  it('mapea tipo desconocido -> Otro (upper-case si viene con valor, "Otro" si no)', () => {
    const withValue = buildPendingShipmentsData(baseInput({ shipments: [{ trackingNumber: 'T3', shipmentType: 'ups' } as any] }));
    expect(withValue.rows[0].tipo).toBe('UPS');
    const withoutValue = buildPendingShipmentsData(baseInput({ shipments: [{ trackingNumber: 'T4', shipmentType: null } as any] }));
    expect(withoutValue.rows[0].tipo).toBe('Otro');
  });

  it('isCharge true -> carga "Carga", isCharge false -> "Normal"', () => {
    const data = buildPendingShipmentsData(baseInput({
      shipments: [
        { trackingNumber: 'T5', isCharge: true } as any,
        { trackingNumber: 'T6', isCharge: false } as any,
      ],
    }));
    expect(data.rows[0].carga).toBe('Carga');
    expect(data.rows[1].carga).toBe('Normal');
  });

  it('isHighValue true -> altoValor "Sí", falsy -> "No"', () => {
    const data = buildPendingShipmentsData(baseInput({
      shipments: [
        { trackingNumber: 'T7', isHighValue: true } as any,
        { trackingNumber: 'T8', isHighValue: false } as any,
      ],
    }));
    expect(data.rows[0].isHighValue).toBe('Sí');
    expect(data.rows[1].isHighValue).toBe('No');
  });

  it('formatea commitDateTime y createdAt en America/Hermosillo (fiel a formatToHermosillo)', () => {
    const data = buildPendingShipmentsData(baseInput({
      shipments: [{
        trackingNumber: 'T9',
        commitDateTime: '2026-07-20T18:00:00Z',
        createdAt: '2026-07-18T15:00:00Z',
      } as any],
    }));
    const expectedFormatter = (d: string) => new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Hermosillo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(d));
    expect(data.rows[0].commitDateTime).toBe(expectedFormatter('2026-07-20T18:00:00Z'));
    expect(data.rows[0].createdAt).toBe(expectedFormatter('2026-07-18T15:00:00Z'));
  });

  it('fechas ausentes -> cadena vacía', () => {
    const data = buildPendingShipmentsData(baseInput({ shipments: [{ trackingNumber: 'T10', commitDateTime: null, createdAt: null } as any] }));
    expect(data.rows[0].commitDateTime).toBe('');
    expect(data.rows[0].createdAt).toBe('');
  });

  it('propaga los campos de negocio tal cual (status, priority, destinatario, dirección, etc.)', () => {
    const data = buildPendingShipmentsData(baseInput({
      shipments: [{
        trackingNumber: 'T11', status: 'PENDIENTE', priority: 'ALTA',
        recipientName: 'Ana', recipientAddress: 'Calle 1', recipientCity: 'Hermosillo',
        recipientZip: '83000', recipientPhone: '6620000000', receivedByName: 'Juan',
        consolidatedId: 'C-1',
      } as any],
    }));
    expect(data.rows[0]).toMatchObject({
      trackingNumber: 'T11', status: 'PENDIENTE', priority: 'ALTA',
      recipientName: 'Ana', recipientAddress: 'Calle 1', recipientCity: 'Hermosillo',
      recipientZip: '83000', recipientPhone: '6620000000', receivedByName: 'Juan',
      consolidatedId: 'C-1',
    });
  });

  it('shipments vacío -> rows vacío', () => {
    const data = buildPendingShipmentsData(baseInput());
    expect(data.rows).toEqual([]);
  });
});
