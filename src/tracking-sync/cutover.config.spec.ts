import { isCutoverEnabled, cutoverSubsidiaryIds, isSubsidiaryInCutover } from './cutover.config';

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
});
