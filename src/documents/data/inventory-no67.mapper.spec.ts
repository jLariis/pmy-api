import { buildInventoryNo67Data, InventoryNo67Input } from './inventory-no67.mapper';

function baseInput(overrides: Partial<InventoryNo67Input> = {}): InventoryNo67Input {
  return {
    summary: {
      totalShipments: 0,
      withoutCode67: 0,
      withCode67: 0,
      percentageWithout67: 0,
    },
    details: [],
    now: new Date('2026-07-22T15:00:00Z'), // 08:00 America/Hermosillo
    ...overrides,
  };
}

describe('buildInventoryNo67Data', () => {
  it('hoja1: pares etiqueta/valor con % sin 67 y fecha de generación formateada', () => {
    const data = buildInventoryNo67Data(baseInput({
      summary: {
        totalShipments: 40,
        withoutCode67: 10,
        withCode67: 30,
        percentageWithout67: 25,
        inventoryDate: '2026-07-20T12:00:00Z',
        inventoryId: 'INV-1',
      },
    }));
    expect(data.generatedAt).toBe('22/07/2026 08:00');
    expect(data.inventoryDateLabel).toBe('20/07/2026 05:00');
    expect(data.inventoryId).toBe('INV-1');
    expect(data.totalShipments).toBe(40);
    expect(data.withoutCode67).toBe(10);
    expect(data.withCode67).toBe(30);
    expect(data.percentageWithout67Label).toBe('25%');
  });

  it('hoja1: sin inventoryDate/inventoryId, usa N/A', () => {
    const data = buildInventoryNo67Data(baseInput());
    expect(data.inventoryDateLabel).toBe('N/A');
    expect(data.inventoryId).toBe('N/A');
  });

  it('hoja2: detailRows formatea fechas, une exceptionCodes, alterna rowFill', () => {
    const data = buildInventoryNo67Data(baseInput({
      details: [
        {
          trackingNumber: 'T1', currentStatus: 'en_bodega', statusHistoryCount: 2,
          exceptionCodes: ['03', '08'], firstStatusDate: '2026-07-01T12:00:00Z',
          lastStatusDate: '2026-07-05T12:00:00Z', daysInSystem: 21, comment: 'No tiene exceptionCode 67',
        },
        {
          trackingNumber: 'T2', currentStatus: 'en_bodega', statusHistoryCount: 0,
          exceptionCodes: [], firstStatusDate: null, lastStatusDate: null, daysInSystem: null,
          comment: 'Sin historial de estados',
        },
      ],
    }));
    expect(data.detailRows).toHaveLength(2);
    expect(data.detailRows[0]).toMatchObject({
      index: 1, trackingNumber: 'T1', currentStatus: 'en_bodega', statusHistoryCount: 2,
      exceptionCodes: '03, 08', firstStatusDate: '01/07/2026 05:00', lastStatusDate: '05/07/2026 05:00',
      daysInSystem: 21, comment: 'No tiene exceptionCode 67', rowFill: null,
    });
    expect(data.detailRows[1]).toMatchObject({
      index: 2, firstStatusDate: '', lastStatusDate: '', daysInSystem: '', rowFill: 'F2F2F2',
    });
  });

  it('hoja3: distribución por estado (conteo + porcentaje)', () => {
    const data = buildInventoryNo67Data(baseInput({
      details: [
        { trackingNumber: 'T1', currentStatus: 'en_bodega', statusHistoryCount: 1, exceptionCodes: [], firstStatusDate: null, lastStatusDate: null, daysInSystem: 5, comment: '' },
        { trackingNumber: 'T2', currentStatus: 'en_bodega', statusHistoryCount: 1, exceptionCodes: [], firstStatusDate: null, lastStatusDate: null, daysInSystem: 5, comment: '' },
        { trackingNumber: 'T3', currentStatus: 'en_ruta', statusHistoryCount: 1, exceptionCodes: [], firstStatusDate: null, lastStatusDate: null, daysInSystem: 5, comment: '' },
      ],
    }));
    expect(data.statusStatsRows).toEqual(
      expect.arrayContaining([
        { status: 'en_bodega', count: 2, percentage: '66.7%' },
        { status: 'en_ruta', count: 1, percentage: '33.3%' },
      ]),
    );
  });

  it('hoja3: distribución por días (rangos 0-7/8-30/31-90/91-180/>180/sin fecha)', () => {
    const mk = (daysInSystem: number | null) => ({
      trackingNumber: 't', currentStatus: 's', statusHistoryCount: 0, exceptionCodes: [],
      firstStatusDate: null, lastStatusDate: null, daysInSystem, comment: '',
    });
    const data = buildInventoryNo67Data(baseInput({
      details: [mk(3), mk(15), mk(45), mk(120), mk(200), mk(null)],
    }));
    expect(data.dayStatsRows).toEqual([
      { range: '0-7 días', count: 1 },
      { range: '8-30 días', count: 1 },
      { range: '31-90 días', count: 1 },
      { range: '91-180 días', count: 1 },
      { range: 'Más de 180 días', count: 1 },
      { range: 'Sin fecha', count: 1 },
    ]);
  });
});
