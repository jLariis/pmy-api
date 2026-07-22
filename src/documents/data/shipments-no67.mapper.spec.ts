import { buildShipmentsNo67Data, ShipmentsNo67Input } from './shipments-no67.mapper';

function baseInput(overrides: Partial<ShipmentsNo67Input> = {}): ShipmentsNo67Input {
  return {
    shipments: [],
    now: new Date('2026-07-22T15:00:00Z'), // 08:00 America/Hermosillo
    ...overrides,
  };
}

describe('buildShipmentsNo67Data', () => {
  it('hoja1: encabezado (fecha/hora de generación Hermosillo + total)', () => {
    const data = buildShipmentsNo67Data(baseInput({ shipments: [{ trackingNumber: 'T1' } as any] }));
    expect(data.generatedDateLabel).toBe('22/07/2026');
    expect(data.generatedTimeLabel).toBe('08:00:00');
    expect(data.totalCount).toBe(1);
  });

  it('hoja1: mapea datos de fila (tracking, estado formateado, historial, códigos, fechas, comentario)', () => {
    const data = buildShipmentsNo67Data(baseInput({
      shipments: [{
        trackingNumber: 'T1', currentStatus: 'en_bodega', statusHistoryCount: 2,
        exceptionCodes: ['03', '08'], firstStatusDate: '2026-07-01T12:00:00Z',
        lastStatusDate: '2026-07-05T12:00:00Z', comment: 'Sin novedad',
      }],
    }));
    expect(data.detailRows[0]).toMatchObject({
      index: 1, trackingNumber: 'T1', estadoActual: 'En Bodega', statusHistoryCount: 2,
      exceptionCodesLabel: '03, 08', fechaPrimerEstado: '01/07/2026', fechaUltimoEstado: '05/07/2026',
      observaciones: 'Sin novedad',
    });
  });

  it('hoja1: valores por defecto cuando faltan datos (N/A, Ninguno, Sin observaciones)', () => {
    const data = buildShipmentsNo67Data(baseInput({
      shipments: [{ trackingNumber: 'T2' } as any],
    }));
    expect(data.detailRows[0]).toMatchObject({
      estadoActual: 'N/A', exceptionCodesLabel: 'Ninguno', fechaPrimerEstado: 'N/A',
      fechaUltimoEstado: 'N/A', observaciones: 'Sin observaciones', diasSinCodigo67: 'N/A',
      statusHistoryCount: 0,
    });
  });

  describe('semáforo por días sin código 67', () => {
    function shipmentWithDays(days: number, now: Date): any {
      const firstStatusDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
      return { trackingNumber: `T-${days}`, currentStatus: 'en_bodega', firstStatusDate };
    }

    it('>7 días: fila completa FFE6E6/990000 bold, sin overrides de columna', () => {
      const now = new Date('2026-07-22T15:00:00Z');
      const data = buildShipmentsNo67Data(baseInput({ shipments: [shipmentWithDays(8, now)], now }));
      const row = data.detailRows[0];
      expect(row.diasSinCodigo67).toBe('8');
      expect(row.rowFill).toBe('FFE6E6');
      expect(row.rowFont).toBe('990000');
      expect(row.rowBold).toBe(true);
      expect(row.estadoFill).toBeFalsy();
      expect(row.diasFill).toBeFalsy();
    });

    it('3-7 días (moderado): fila completa FFF0F0/CC0000 bold', () => {
      const now = new Date('2026-07-22T15:00:00Z');
      const data = buildShipmentsNo67Data(baseInput({ shipments: [shipmentWithDays(5, now)], now }));
      const row = data.detailRows[0];
      expect(row.rowFill).toBe('FFF0F0');
      expect(row.rowFont).toBe('CC0000');
      expect(row.rowBold).toBe(true);
      expect(row.estadoFill).toBeFalsy();
      expect(row.diasFill).toBeFalsy();
    });

    it('exactamente 3 días (no crítico): sin fill de fila (fila impar), col Días resaltada FFEB9C/9C6500', () => {
      const now = new Date('2026-07-22T15:00:00Z');
      const data = buildShipmentsNo67Data(baseInput({ shipments: [shipmentWithDays(0, now), shipmentWithDays(3, now)], now }));
      const row = data.detailRows[1]; // índice impar -> sin zebra
      expect(row.rowFill).toBeFalsy();
      expect(row.rowFont).toBeFalsy();
      expect(row.rowBold).toBeFalsy();
      expect(row.diasFill).toBe('FFEB9C');
      expect(row.diasFont).toBe('9C6500');
    });

    it('0-2 días: sin fill de fila (fila impar) ni de columna Días', () => {
      const now = new Date('2026-07-22T15:00:00Z');
      const data = buildShipmentsNo67Data(baseInput({ shipments: [shipmentWithDays(0, now), shipmentWithDays(2, now)], now }));
      const row = data.detailRows[1]; // índice impar -> sin zebra
      expect(row.rowFill).toBeFalsy();
      expect(row.diasFill).toBeFalsy();
      expect(row.diasFont).toBeFalsy();
    });

    it('sin firstStatusDate: 0 días -> "N/A" y sin fill de columna Días', () => {
      const data = buildShipmentsNo67Data(baseInput({ shipments: [{ trackingNumber: 'T0' } as any] }));
      const row = data.detailRows[0];
      expect(row.diasSinCodigo67).toBe('N/A');
      expect(row.diasFill).toBeFalsy();
    });

    it('zebra: filas pares (no críticas) F2F2F2 alternado', () => {
      const now = new Date('2026-07-22T15:00:00Z');
      const data = buildShipmentsNo67Data(baseInput({
        shipments: [shipmentWithDays(0, now), shipmentWithDays(0, now), shipmentWithDays(0, now)],
        now,
      }));
      expect(data.detailRows[0].rowFill).toBe('F2F2F2');
      expect(data.detailRows[1].rowFill).toBeFalsy();
      expect(data.detailRows[2].rowFill).toBe('F2F2F2');
    });
  });

  describe('color por estado (col 3)', () => {
    const now = new Date('2026-07-22T15:00:00Z');
    function mkStatus(status: string): any {
      return { trackingNumber: 'T', currentStatus: status, firstStatusDate: now.toISOString() }; // 0 días -> no crítico
    }

    it('en ruta -> FFF2CC/7F6000', () => {
      const data = buildShipmentsNo67Data(baseInput({ shipments: [mkStatus('en_ruta')], now }));
      expect(data.detailRows[0].estadoFill).toBe('FFF2CC');
      expect(data.detailRows[0].estadoFont).toBe('7F6000');
    });

    it('entregado -> E2F0D9/385723', () => {
      const data = buildShipmentsNo67Data(baseInput({ shipments: [mkStatus('entregado')], now }));
      expect(data.detailRows[0].estadoFill).toBe('E2F0D9');
      expect(data.detailRows[0].estadoFont).toBe('385723');
    });

    it('en bodega -> DEEBF7/2F5597', () => {
      const data = buildShipmentsNo67Data(baseInput({ shipments: [mkStatus('en_bodega')], now }));
      expect(data.detailRows[0].estadoFill).toBe('DEEBF7');
      expect(data.detailRows[0].estadoFont).toBe('2F5597');
    });

    it('devuelto y devuelto_a_fedex -> F2F2F2/666666', () => {
      const data = buildShipmentsNo67Data(baseInput({
        shipments: [mkStatus('devuelto'), mkStatus('devuelto_a_fedex')], now,
      }));
      expect(data.detailRows[0].estadoFill).toBe('F2F2F2');
      expect(data.detailRows[0].estadoFont).toBe('666666');
      expect(data.detailRows[1].estadoFill).toBe('F2F2F2');
      expect(data.detailRows[1].estadoFont).toBe('666666');
    });

    it('estado sin match (p.ej. pendiente): sin override de columna', () => {
      const data = buildShipmentsNo67Data(baseInput({ shipments: [mkStatus('pending')], now }));
      expect(data.detailRows[0].estadoFill).toBeFalsy();
      expect(data.detailRows[0].estadoFont).toBeFalsy();
    });

    it('crítico (>3 días) con estado "en ruta": NO se aplica color de estado (gana el gradiente de fila)', () => {
      const critico = { trackingNumber: 'T', currentStatus: 'en_ruta', firstStatusDate: new Date(now.getTime() - 8 * 86400000).toISOString() };
      const data = buildShipmentsNo67Data(baseInput({ shipments: [critico], now }));
      expect(data.detailRows[0].estadoFill).toBeFalsy();
      expect(data.detailRows[0].rowFill).toBe('FFE6E6');
    });
  });

  describe('hoja 2: resumen', () => {
    it('estadísticas generales: conteos por estado y promedio de días', () => {
      const now = new Date('2026-07-22T15:00:00Z');
      const data = buildShipmentsNo67Data(baseInput({
        now,
        shipments: [
          { trackingNumber: 'T1', currentStatus: 'en_bodega', firstStatusDate: new Date(now.getTime() - 2 * 86400000).toISOString() },
          { trackingNumber: 'T2', currentStatus: 'en_ruta', firstStatusDate: new Date(now.getTime() - 4 * 86400000).toISOString() },
          { trackingNumber: 'T3', currentStatus: 'entregado', firstStatusDate: new Date(now.getTime() - 6 * 86400000).toISOString() },
          { trackingNumber: 'T4', currentStatus: 'devuelto', firstStatusDate: new Date(now.getTime() - 8 * 86400000).toISOString() },
        ],
      }));
      expect(data.totalCount).toBe(4);
      expect(data.enBodegaCount).toBe(1);
      expect(data.enRutaCount).toBe(1);
      expect(data.entregadosCount).toBe(1);
      expect(data.devueltosCount).toBe(1);
      expect(data.promedioDiasLabel).toBe('5.0');
    });

    it('alertas por tiempo: críticos (>3), alerta (2-3, exclusivo >1 y <=3), normales (<=1)', () => {
      const now = new Date('2026-07-22T15:00:00Z');
      function mk(days: number) {
        return { trackingNumber: `T${days}`, currentStatus: 'en_bodega', firstStatusDate: new Date(now.getTime() - days * 86400000).toISOString() };
      }
      const data = buildShipmentsNo67Data(baseInput({ now, shipments: [mk(0), mk(1), mk(2), mk(3), mk(4)] }));
      expect(data.normalesCount).toBe(2); // 0,1
      expect(data.alertaCount).toBe(2); // 2,3
      expect(data.criticosCount).toBe(1); // 4
    });

    it('códigos de excepción: ordenados por frecuencia descendente', () => {
      const data = buildShipmentsNo67Data(baseInput({
        shipments: [
          { trackingNumber: 'T1', exceptionCodes: ['03'] } as any,
          { trackingNumber: 'T2', exceptionCodes: ['03', '08'] } as any,
          { trackingNumber: 'T3', exceptionCodes: ['08'] } as any,
          { trackingNumber: 'T4', exceptionCodes: ['08'] } as any,
        ],
      }));
      expect(data.codigosRows).toEqual([
        { codigo: '08', frecuencia: 3 },
        { codigo: '03', frecuencia: 2 },
      ]);
    });

    it('códigos de excepción: fallback cuando no hay ninguno', () => {
      const data = buildShipmentsNo67Data(baseInput({ shipments: [{ trackingNumber: 'T1' } as any] }));
      expect(data.codigosRows).toEqual([{ codigo: 'No se encontraron códigos de excepción', frecuencia: '-' }]);
    });

    it('top 5 más antiguos: ordenados desc por días, máximo 5', () => {
      const now = new Date('2026-07-22T15:00:00Z');
      function mk(days: number) {
        return { trackingNumber: `T${days}`, currentStatus: 'en_bodega', firstStatusDate: new Date(now.getTime() - days * 86400000).toISOString() };
      }
      const data = buildShipmentsNo67Data(baseInput({ now, shipments: [mk(1), mk(9), mk(3), mk(20), mk(0), mk(15)] }));
      expect(data.topRows).toHaveLength(5);
      expect(data.topRows[0]).toEqual({ label: '1. T20', diasLabel: '20 días' });
      expect(data.topRows[1]).toEqual({ label: '2. T15', diasLabel: '15 días' });
      expect(data.topRows[4].diasLabel).toBe('1 días');
    });
  });
});
