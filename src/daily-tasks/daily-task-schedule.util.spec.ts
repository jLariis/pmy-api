import { DEFAULT_SCHEDULE, resolveSchedule } from './daily-task-schedule.util';
import { OpsSettings } from '../ops-alerts/ops-alerts.util';

const global: OpsSettings = {
  enabled: true, uploadMinutes: 30, unloadingTime: '21:00', dispatchTime: '10:00', closureTime: '21:00', inventoryTime: '19:00',
  escalate1Min: 30, escalate2Min: 60, completePct: 100, lookbackDays: 3, activeFrom: '06:00', activeTo: '21:30',
};

describe('resolveSchedule', () => {
  it('sin configuración de sucursal usa los predefinidos acordados', () => {
    expect(resolveSchedule(global, null)).toEqual({
      uploadMinutes: 30, unloadingTime: '21:00', dispatchAfterUnloadMinutes: 120, dispatchNextDayTime: '10:00', closureTime: '21:00',
      inventoryInitialTime: '10:00', devolutionsTime: '19:30', inventoryFinalTime: '20:00', activeTo: '21:30', completePct: 100,
    });
  });

  it('el valor de la sucursal gana sobre el general', () => {
    expect(resolveSchedule(global, { inventoryFinalTime: '19:45', dispatchAfterUnloadMinutes: 90 })).toMatchObject({ inventoryFinalTime: '19:45', dispatchAfterUnloadMinutes: 90 });
  });

  it('una columna nula de la sucursal usa el general', () => {
    expect(resolveSchedule({ ...global, closureTime: '20:30' }, { closureTime: null as any }).closureTime).toBe('20:30');
  });

  it('el inventario final NO toma inventoryTime general (19:00): su predefinido es 20:00', () => {
    expect(resolveSchedule(global, null).inventoryFinalTime).toBe(DEFAULT_SCHEDULE.inventoryFinalTime);
  });
});
