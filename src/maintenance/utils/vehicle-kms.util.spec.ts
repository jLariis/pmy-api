import { nextVehicleKms, parseKms } from './vehicle-kms.util';

describe('nextVehicleKms', () => {
  it('sube si es mayor', () => expect(nextVehicleKms(1000, '1200')).toEqual({ kms: 1200, changed: true }));
  it('ignora menor o igual', () => expect(nextVehicleKms(1000, 900)).toEqual({ kms: 1000, changed: false, reason: 'not_greater' }));
  it('ignora no numérico', () => expect(nextVehicleKms(1000, 'abc')).toEqual({ kms: 1000, changed: false, reason: 'invalid' }));
  it('ignora salto > 5000', () => expect(nextVehicleKms(1000, 7001)).toEqual({ kms: 1000, changed: false, reason: 'jump' }));
  it('sin km previo acepta cualquiera válido', () => expect(nextVehicleKms(null, '85,300')).toEqual({ kms: 85300, changed: true }));
  it('parseKms limpia separadores', () => expect(parseKms('12,345 km')).toBe(12345));
});
