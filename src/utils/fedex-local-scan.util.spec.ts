import { resolveCode44ScanTime, localFacilityScanTimes, is44LocalScan } from './fedex-local-scan.util';

/**
 * Código 44 = el paquete está en la ESTACIÓN LOCAL de FedEx, de nuestro lado. FedEx lo
 * entrega como CÓDIGO en `latestStatusDetail.ancillaryDetails.reason = '44'` ("At FedEx
 * destination facility"). Verificado en 80 guías reales: el 44 NUNCA aparece en los
 * scanEvents, solo en el ancillary del estatus. NO basta el escaneo "At local FedEx
 * facility" por sí solo (estatus interno de FedEx): se EXIGE el código 44, y el escaneo
 * local solo sirve para FECHAR el día.
 */
describe('is44LocalScan', () => {
  it('detecta el 44 literal en exceptionCode', () => {
    expect(is44LocalScan({ exceptionCode: '44' })).toBe(true);
  });
  it('detecta el 44 literal en eventType', () => {
    expect(is44LocalScan({ eventType: '44' })).toBe(true);
  });
  it('NO marca el escaneo "At local FedEx facility" por sí solo (sin el código)', () => {
    expect(is44LocalScan({ eventType: 'AR', eventDescription: 'At local FedEx facility' })).toBe(false);
  });
});

describe('localFacilityScanTimes', () => {
  const lsd44 = { code: 'FD', derivedCode: 'OW', ancillaryDetails: [{ reason: '44' }] };
  const localScan = (date: string) => ({ date, eventType: 'AR', eventDescription: 'At local FedEx facility' });
  const otherScan = (date: string) => ({ date, eventType: 'OD', eventDescription: 'On FedEx vehicle for delivery' });

  it('CON reason 44 + escaneos locales: devuelve los tiempos de los escaneos locales', () => {
    const events = [localScan('2026-08-24T17:26:00-07:00'), localScan('2026-08-25T17:40:00-07:00'), otherScan('2026-08-19T10:00:00-07:00')];
    const times = localFacilityScanTimes(lsd44, events).sort();
    expect(times).toEqual([
      new Date('2026-08-24T17:26:00-07:00').getTime(),
      new Date('2026-08-25T17:40:00-07:00').getTime(),
    ].sort());
  });

  it('SIN el código 44: devuelve [] aunque haya escaneo "At local FedEx facility"', () => {
    const lsd07 = { ancillaryDetails: [{ reason: '07' }] };
    expect(localFacilityScanTimes(lsd07, [localScan('2026-08-25T17:40:00-07:00')])).toEqual([]);
    expect(localFacilityScanTimes({}, [localScan('2026-08-25T17:40:00-07:00')])).toEqual([]);
  });

  it('44 LITERAL en un scanEvent: lo detecta aunque el ancillary no lo traiga', () => {
    const events = [{ date: '2026-08-25T17:40:00-07:00', exceptionCode: '44', eventDescription: 'X' }];
    expect(localFacilityScanTimes({}, events)).toEqual([new Date('2026-08-25T17:40:00-07:00').getTime()]);
  });

  it('reason 44 sin escaneo local: ancla al scan más reciente', () => {
    const events = [otherScan('2026-08-24T10:00:00-07:00'), otherScan('2026-08-26T10:00:00-07:00')];
    expect(localFacilityScanTimes(lsd44, events)).toEqual([new Date('2026-08-26T10:00:00-07:00').getTime()]);
  });
});

describe('resolveCode44ScanTime', () => {
  const lsd44 = { ancillaryDetails: [{ reason: '44' }] };
  const localScan = (date: string) => ({ date, eventType: 'AR', eventDescription: 'At local FedEx facility' });

  it('con código 44: devuelve el escaneo local MÁS RECIENTE (para anclar la persistencia)', () => {
    const events = [localScan('2026-08-24T17:26:00-07:00'), localScan('2026-08-25T17:40:00-07:00')];
    expect(resolveCode44ScanTime(lsd44, events)).toBe(new Date('2026-08-25T17:40:00-07:00').getTime());
  });

  it('sin el código 44: null (aunque haya escaneo local)', () => {
    expect(resolveCode44ScanTime({ ancillaryDetails: [{ reason: '07' }] }, [localScan('2026-08-25T17:40:00-07:00')])).toBeNull();
  });
});
