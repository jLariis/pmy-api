import {
  configuredScanCode,
  daysWithoutLocalScan,
  hermosilloCalendarDays,
  isLocalScanCode,
  lastLocalScanOf,
  latestLocalScan,
  localScanCategory,
  localScanLabel,
} from './local-scan-visibility.util';

describe('local-scan-visibility.util', () => {
  // 10-oct-2026 09:00 Hermosillo = 16:00Z
  const now = new Date('2026-10-10T16:00:00Z');

  it('44 y 67 son escaneo local; otros no', () => {
    expect(isLocalScanCode('44')).toBe(true);
    expect(isLocalScanCode('67')).toBe(true);
    expect(isLocalScanCode(' 67 ')).toBe(true);
    expect(isLocalScanCode('07')).toBe(false);
    expect(isLocalScanCode(null)).toBe(false);
  });

  it('el último escaneo local toma 44 o 67, el más reciente, sin importar la config', () => {
    const last = lastLocalScanOf([
      { exceptionCode: '67', timestamp: '2026-10-07T05:00:00Z' },
      { exceptionCode: '44', timestamp: '2026-10-09T04:36:00Z' }, // 08-oct 21:36 Hermosillo
      { exceptionCode: '07', timestamp: '2026-10-09T20:00:00Z' },
      { exceptionCode: '', timestamp: '2026-10-09T21:00:00Z' },
    ]);
    expect(last?.code).toBe('44');
    expect(last?.at.toISOString()).toBe('2026-10-09T04:36:00.000Z');
    expect(lastLocalScanOf([])).toBeNull();
    expect(lastLocalScanOf([{ exceptionCode: '03', timestamp: '2026-10-09T04:36:00Z' }])).toBeNull();
  });

  it('latestLocalScan elige el más reciente', () => {
    const a = { at: new Date('2026-10-08T05:00:00Z'), code: '67' as const };
    const b = { at: new Date('2026-10-09T05:00:00Z'), code: '44' as const };
    expect(latestLocalScan(a, b)).toBe(b);
    expect(latestLocalScan(null, a)).toBe(a);
    expect(latestLocalScan(a, null)).toBe(a);
  });

  it('días en hora Hermosillo, no UTC', () => {
    // 09-oct 22:00 Hermosillo = 10-oct 05:00Z (en UTC ya es "hoy")
    expect(hermosilloCalendarDays(new Date('2026-10-10T05:00:00Z'), now)).toBe(1);
  });

  it('días sin código = días completos sin escaneo (anoche = al día)', () => {
    expect(daysWithoutLocalScan(new Date('2026-10-10T05:00:00Z'), now)).toBe(0); // anoche
    expect(daysWithoutLocalScan(new Date('2026-10-10T15:00:00Z'), now)).toBe(0); // hoy
    expect(daysWithoutLocalScan(new Date('2026-10-09T05:00:00Z'), now)).toBe(1); // antenoche
    expect(daysWithoutLocalScan(null, now)).toBeNull();
  });

  it('categoría y etiqueta en llano', () => {
    expect(localScanCategory(0)).toBe('hoy');
    expect(localScanCategory(2)).toBe('sinCodigo');
    expect(localScanCategory(null)).toBe('nunca');
    expect(localScanLabel(0)).toBe('Al día');
    expect(localScanLabel(1)).toBe('1 día sin escaneo');
    expect(localScanLabel(3)).toBe('3 días sin escaneo');
    expect(localScanLabel(null)).toBe('Nunca escaneado');
  });

  it('código configurado: 44 si la sucursal lo monitorea, si no 67', () => {
    expect(configuredScanCode({ monitorFedexCode44: true })).toBe('44');
    expect(configuredScanCode({ monitorFedexCode44: false })).toBe('67');
    expect(configuredScanCode(null)).toBe('67');
  });
});
