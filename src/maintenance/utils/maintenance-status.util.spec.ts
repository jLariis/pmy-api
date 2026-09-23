import { maintenanceStatus } from './maintenance-status.util';

const today = new Date('2026-09-22T12:00:00Z');

describe('maintenanceStatus', () => {
  it('sin datos', () => expect(maintenanceStatus({ kms: 100 }, today).light).toBe('sin_datos'));
  it('vencido por km', () =>
    expect(maintenanceStatus({ kms: 15100, lastMaintenanceKms: 10000, maintenanceIntervalKms: 5000 }, today).light).toBe('vencido'));
  it('proximo por km', () =>
    expect(maintenanceStatus({ kms: 14200, lastMaintenanceKms: 10000 }, today)).toMatchObject({ light: 'proximo', nextKms: 15000, kmsRemaining: 800 }));
  it('vencido por fecha', () =>
    expect(maintenanceStatus({ kms: 1, lastMaintenanceKms: 0, nextMaintenanceDate: '2026-09-01' }, today).light).toBe('vencido'));
  it('proximo por fecha', () => expect(maintenanceStatus({ nextMaintenanceDate: '2026-10-01' }, today).light).toBe('proximo'));
  it('al dia', () =>
    expect(maintenanceStatus({ kms: 11000, lastMaintenanceKms: 10000, nextMaintenanceDate: '2026-12-01' }, today).light).toBe('al_dia'));
});
