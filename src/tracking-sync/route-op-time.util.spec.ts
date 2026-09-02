import { computeEffectiveLastOpTime } from './route-op-time.util';

/**
 * Reproduce el caso real 383295956902 (Caborca): ruta capturada el 01-sep pero fechada el
 * 31-ago. El EN_RUTA de la salida a ruta se estampó a la hora de captura (01-sep 15:42) y
 * blindaba al paquete contra el DEX08 real de FedEx del 31-ago 17:20.
 */
describe('computeEffectiveLastOpTime', () => {
  const routeDate = new Date('2026-08-31T07:00:00.000Z'); // día operativo (00:00 HMO)
  const captureAt = new Date('2026-09-01T15:42:27.000Z'); // se creó el despacho HOY (retroactivo)

  const dex08At = new Date('2026-08-31T17:20:00.000Z');

  it('re-ancla el EN_RUTA de una ruta RETROACTIVA al inicio del routeDate', () => {
    const rows = [
      { status: 'en_bodega', timestamp: new Date('2026-08-26T23:34:41.000Z') },
      { status: 'en_ruta', timestamp: captureAt }, // salida a ruta (retroactiva)
    ];
    const eff = computeEffectiveLastOpTime(rows, [{ routeDate, createdAt: captureAt }]);

    // El lastOpTime efectivo cae al 31-ago 07:00Z, ANTES del DEX08 → FedEx puede ganar.
    expect(eff).toBe(routeDate.getTime());
    expect(eff).toBeLessThan(dex08At.getTime());
  });

  it('sin el fix, el timestamp de captura blindaría contra el DEX08 (regresión que evitamos)', () => {
    const rows = [{ status: 'en_ruta', timestamp: captureAt }];
    const raw = computeEffectiveLastOpTime(rows, []); // sin anclas → comportamiento crudo
    expect(raw).toBe(captureAt.getTime());
    expect(raw).toBeGreaterThan(dex08At.getTime()); // esto es lo que hoy deja el paquete atascado
  });

  it('NO toca rutas del MISMO día (conserva la hora real, sin regresión)', () => {
    const sameDayCapture = new Date('2026-09-01T18:00:00.000Z');
    const sameDayRoute = new Date('2026-09-01T07:00:00.000Z');
    const rows = [{ status: 'en_ruta', timestamp: sameDayCapture }];
    const eff = computeEffectiveLastOpTime(rows, [{ routeDate: sameDayRoute, createdAt: sameDayCapture }]);
    expect(eff).toBe(sameDayCapture.getTime());
  });

  it('ignora estatus no operativos y toma el máximo operativo', () => {
    const rows = [
      { status: 'entregado', timestamp: new Date('2026-09-02T00:00:00.000Z') }, // no operativo
      { status: 'pendiente', timestamp: new Date('2026-08-20T00:00:00.000Z') },
      { status: 'en_bodega', timestamp: new Date('2026-08-27T00:00:00.000Z') },
    ];
    const eff = computeEffectiveLastOpTime(rows, []);
    expect(eff).toBe(new Date('2026-08-27T00:00:00.000Z').getTime());
  });

  it('con varias salidas, cada EN_RUTA retroactivo se re-ancla a SU routeDate', () => {
    const cap1 = new Date('2026-09-01T15:42:27.000Z');
    const cap2 = new Date('2026-09-01T16:10:00.000Z');
    const rows = [
      { status: 'en_ruta', timestamp: cap1 },
      { status: 'en_ruta', timestamp: cap2 },
    ];
    const eff = computeEffectiveLastOpTime(rows, [
      { routeDate: new Date('2026-08-30T07:00:00.000Z'), createdAt: cap1 },
      { routeDate: new Date('2026-08-31T07:00:00.000Z'), createdAt: cap2 },
    ]);
    // El más nuevo tras re-anclar es el routeDate del 31-ago.
    expect(eff).toBe(new Date('2026-08-31T07:00:00.000Z').getTime());
  });
});
