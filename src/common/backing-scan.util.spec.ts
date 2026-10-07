import { ShipmentStatusType as S } from 'src/common/enums/shipment-status-type.enum';
import { needsBackingHistory, selectBackingScan } from './backing-scan.util';

describe('needsBackingHistory', () => {
  it('estatus cambia y ninguna fila lo respalda → sí', () => {
    expect(needsBackingHistory({ prevStatus: S.EN_RUTA, finalStatus: S.ENTREGADO, historyStatuses: [S.EN_RUTA] })).toBe(true);
  });
  it('ya hay una fila con el estatus final → no', () => {
    expect(needsBackingHistory({ prevStatus: S.EN_RUTA, finalStatus: S.ENTREGADO, historyStatuses: [S.ENTREGADO] })).toBe(false);
  });
  it('DEX (no entrega) → nunca se respalda, aunque falte en el historial', () => {
    expect(needsBackingHistory({ prevStatus: S.PENDIENTE, finalStatus: S.CLIENTE_NO_DISPONIBLE, historyStatuses: [] })).toBe(false);
    expect(needsBackingHistory({ prevStatus: S.EN_RUTA, finalStatus: S.RECHAZADO, historyStatuses: [S.EN_RUTA] })).toBe(false);
  });
  it('el estatus no cambia → no', () => {
    expect(needsBackingHistory({ prevStatus: S.ENTREGADO, finalStatus: S.ENTREGADO, historyStatuses: [] })).toBe(false);
  });
});

describe('selectBackingScan', () => {
  it('entrega: toma el DL real más reciente', () => {
    const ev = [
      { date: '2026-10-07T17:00:00Z', eventType: 'OD', derivedStatusCode: 'IT' },
      { date: '2026-10-07T18:06:00Z', eventType: 'DL', derivedStatusCode: 'DL' },
    ];
    expect(selectBackingScan(ev, S.ENTREGADO)?.date).toBe('2026-10-07T18:06:00Z');
  });
  it('entrega fantasma (movimiento después) → null', () => {
    const ev = [
      { date: '2026-10-07T18:06:00Z', eventType: 'DL', derivedStatusCode: 'DL' },
      { date: '2026-10-07T19:00:00Z', eventType: 'AR', derivedStatusCode: 'IT' },
    ];
    expect(selectBackingScan(ev, S.ENTREGADO)).toBeNull();
  });
  it('DEX07: último escaneo que mapea a rechazado', () => {
    const ev = [
      { date: '2026-10-06T18:00:00Z', eventType: 'DE', derivedStatusCode: 'DE', exceptionCode: '07' },
      { date: '2026-10-05T18:00:00Z', eventType: 'DE', derivedStatusCode: 'DE', exceptionCode: '07' },
    ];
    expect(selectBackingScan(ev, S.RECHAZADO)?.date).toBe('2026-10-06T18:00:00Z');
  });
});
