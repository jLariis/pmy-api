import { isCutoverEnabled, cutoverSubsidiaryIds, isSubsidiaryInCutover, cutoverMode, legacyFedexScope, isEngineHour, hermosilloHour } from './cutover.config';

describe('cutover.config', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });

  it('default OFF', () => {
    delete process.env.TRACKING_SYNC_CUTOVER;
    expect(isCutoverEnabled()).toBe(false);
    expect(isSubsidiaryInCutover('s1')).toBe(false);
  });

  it('global ON sin allowlist → todas', () => {
    process.env.TRACKING_SYNC_CUTOVER = 'true';
    delete process.env.TRACKING_SYNC_CUTOVER_SUBSIDIARIES;
    expect(isCutoverEnabled()).toBe(true);
    expect(isSubsidiaryInCutover('s1')).toBe(true);
    expect(isSubsidiaryInCutover(null)).toBe(true);
  });

  it('allowlist restringe a las sucursales listadas', () => {
    process.env.TRACKING_SYNC_CUTOVER = 'true';
    process.env.TRACKING_SYNC_CUTOVER_SUBSIDIARIES = ' s1 , s2 ';
    expect(cutoverSubsidiaryIds()).toEqual(['s1', 's2']);
    expect(isSubsidiaryInCutover('s1')).toBe(true);
    expect(isSubsidiaryInCutover('s3')).toBe(false);
    expect(isSubsidiaryInCutover(null)).toBe(false);
  });

  it('modos: off / coexist (piloto con lista) / full (sin lista)', () => {
    delete process.env.TRACKING_SYNC_CUTOVER;
    expect(cutoverMode()).toBe('off');
    process.env.TRACKING_SYNC_CUTOVER = 'true';
    process.env.TRACKING_SYNC_CUTOVER_SUBSIDIARIES = 'cabo';
    expect(cutoverMode()).toBe('coexist');
    delete process.env.TRACKING_SYNC_CUTOVER_SUBSIDIARIES;
    expect(cutoverMode()).toBe('full');
  });

  it('el legacy cede solo las rutas del piloto en horario del motor; en full deja FedEx (DHL sigue)', () => {
    expect(legacyFedexScope('off', 10)).toBe('all');
    expect(legacyFedexScope('coexist', 10)).toBe('except-cutover-routes');
    expect(legacyFedexScope('coexist', 23)).toBe('all'); // fuera de horario el motor no corre
    expect(legacyFedexScope('coexist', 6)).toBe('all');
    expect(legacyFedexScope('full', 10)).toBeNull();
  });

  it('horario del motor 07–22 y hora de Hermosillo', () => {
    expect(isEngineHour(7)).toBe(true);
    expect(isEngineHour(21)).toBe(true);
    expect(isEngineHour(22)).toBe(false);
    expect(hermosilloHour(new Date('2026-10-19T21:36:00Z'))).toBe(14);
  });
});
