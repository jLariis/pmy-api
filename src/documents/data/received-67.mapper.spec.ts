import { buildReceived67Data, Received67Input } from './received-67.mapper';

function baseInput(overrides: Partial<Received67Input> = {}): Received67Input {
  return { rows: [], ...overrides };
}

describe('buildReceived67Data', () => {
  it('mapea una fila envío (isCharge falsy -> tipo Envío) con fecha67 formateada es-MX/Hermosillo', () => {
    const data = buildReceived67Data(baseInput({
      rows: [{
        trackingNumber: 'T1',
        fecha67: '2026-07-20T18:00:00Z', // 11:00 America/Hermosillo
        diasDesde67: 2,
        status: 'en_bodega',
        recipientName: 'Juan Pérez',
        recipientAddress: 'Calle 1 #23',
        recipientCity: 'Hermosillo',
        recipientZip: '83000',
        isCharge: false,
      }],
    }));
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toMatchObject({
      trackingNumber: 'T1',
      diasDesde67: 2,
      status: 'en_bodega',
      recipientName: 'Juan Pérez',
      recipientAddress: 'Calle 1 #23',
      recipientCity: 'Hermosillo',
      recipientZip: '83000',
      tipo: 'Envío',
    });
    expect(data.rows[0].fecha67).toBe(new Date('2026-07-20T18:00:00Z').toLocaleString('es-MX', { timeZone: 'America/Hermosillo' }));
  });

  it('mapea una fila carga (isCharge true -> tipo Carga)', () => {
    const data = buildReceived67Data(baseInput({
      rows: [{ trackingNumber: 'T2', isCharge: true } as any],
    }));
    expect(data.rows[0].tipo).toBe('Carga');
  });

  it('fecha67 ausente -> cadena vacía (fiel al legacy)', () => {
    const data = buildReceived67Data(baseInput({
      rows: [{ trackingNumber: 'T3', fecha67: null } as any],
    }));
    expect(data.rows[0].fecha67).toBe('');
  });

  it('rows vacío -> data.rows vacío', () => {
    const data = buildReceived67Data(baseInput());
    expect(data.rows).toEqual([]);
  });
});
