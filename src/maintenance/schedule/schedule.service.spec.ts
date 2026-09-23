import { ScheduleService, sortSchedule } from './schedule.service';

const today = new Date('2026-09-22T12:00:00Z');

describe('ScheduleService', () => {
  it('ordena vencido → próximo → sin datos → al día y marca solicitud abierta', async () => {
    const vehicles: any = {
      find: jest.fn(async () => [
        { id: 'ok', name: 'A', kms: 11000, lastMaintenanceKms: 10000, maintenanceIntervalKms: 5000 },
        { id: 'none', name: 'B', kms: 5 },
        { id: 'due', name: 'C', kms: 16000, lastMaintenanceKms: 10000, maintenanceIntervalKms: 5000 },
        { id: 'soon', name: 'D', kms: 14500, lastMaintenanceKms: 10000, maintenanceIntervalKms: 5000 },
      ]),
    };
    const requests: any = {
      find: jest.fn(async () => [
        { id: 'r2', folio: 'SM-000002', status: 'en_cotizacion', vehicleId: 'due' },
        { id: 'r1', folio: 'SM-000001', status: 'abierta', vehicleId: 'due' },
      ]),
    };
    const rows = await new ScheduleService(vehicles, requests).bySubsidiary('s1', today);
    expect(rows.map((r) => r.vehicle.id)).toEqual(['due', 'soon', 'none', 'ok']);
    expect(rows[0].openRequest).toEqual({ id: 'r2', folio: 'SM-000002', status: 'en_cotizacion' });
    expect(rows[1].openRequest).toBeNull();
  });

  it('sortSchedule desempata por km faltante', () => {
    const mk = (id: string, kmsRemaining: number) => ({ vehicle: { id } as any, openRequest: null,
      status: { light: 'proximo' as const, nextKms: 0, kmsRemaining, daysRemaining: null } });
    expect(sortSchedule([mk('a', 900), mk('b', 100)]).map((r) => r.vehicle.id)).toEqual(['b', 'a']);
  });

  it('updateVehicle ancla fechas-día a 07:00Z y permite corregir km', async () => {
    const vehicles: any = { findOne: jest.fn(async () => ({ id: 'v1' })), update: jest.fn(async () => undefined) };
    await new ScheduleService(vehicles, {} as any).updateVehicle('v1', { kms: 90000, nextMaintenanceDate: '2026-12-01' });
    expect(vehicles.update).toHaveBeenCalledWith('v1', { kms: 90000, nextMaintenanceDate: new Date('2026-12-01T07:00:00.000Z') });
  });
});
