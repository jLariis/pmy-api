// La suite corre en TZ=UTC (ver test/jest.global-setup.js), replicando el server.
import {
  effectiveLocalDay,
  effectiveLocalInstant,
  effectiveLocalDaySql,
  rawUtcBounds,
} from './income-window.util';

describe('income-window.util — día local efectivo', () => {
  it('charge: toma la fecha TAL CUAL (00:00Z = día operativo)', () => {
    // Una carga del 17 se guarda a medianoche local = 00:00Z.
    const charge = { sourceType: 'charge', date: new Date('2026-08-17T00:00:00.000Z') };
    expect(effectiveLocalDay(charge)).toBe('2026-08-17');
    expect(effectiveLocalInstant(charge).toISOString()).toBe('2026-08-17T00:00:00.000Z');
  });

  it('traslado (07:00Z) cae en su día local, no un día antes', () => {
    // Los traslados se anclan a la medianoche de Hermosillo = 07:00Z.
    const transfer = { sourceType: 'tyco', date: new Date('2026-07-15T07:00:00.000Z') };
    expect(effectiveLocalDay(transfer)).toBe('2026-07-15');
  });

  it('shipment (instante UTC real) usa el día de Hermosillo', () => {
    // 2026-08-18 02:00Z = 2026-08-17 19:00 en Hermosillo (UTC-7) → día local 17.
    const shipment = { sourceType: 'shipment', date: new Date('2026-08-18T02:00:00.000Z') };
    expect(effectiveLocalDay(shipment)).toBe('2026-08-17');
  });

  it('collection temprano en UTC cuenta al día local anterior', () => {
    // 2026-08-17 03:00Z = 2026-08-16 20:00 Hermosillo → día 16.
    const collection = { sourceType: 'collection', date: new Date('2026-08-17T03:00:00.000Z') };
    expect(effectiveLocalDay(collection)).toBe('2026-08-16');
  });

  it('effectiveLocalDaySql arma el CASE por sourceType con el alias dado', () => {
    const sql = effectiveLocalDaySql('income');
    expect(sql).toContain("income.sourceType = 'charge'");
    expect(sql).toContain('income.date - INTERVAL 7 HOUR');
    expect(sql.startsWith('DATE(')).toBe(true);
  });

  it('rawUtcBounds cubre cargas del primer día (00:00Z) y envíos del último (+7h)', () => {
    const { rawStart, rawEnd } = rawUtcBounds('2026-08-17', '2026-08-22');
    expect(rawStart.toISOString()).toBe('2026-08-17T00:00:00.000Z');
    // 22 23:59:59.999Z + 7h = 23 06:59:59.999Z
    expect(rawEnd.toISOString()).toBe('2026-08-23T06:59:59.999Z');
  });
});
