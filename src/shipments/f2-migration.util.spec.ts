import { ShipmentStatusType as S } from 'src/common/enums/shipment-status-type.enum';
import { canMigrateShipmentToCharge } from './f2-migration.util';

const now = new Date('2026-10-07T18:41:00Z');
const base = { status: S.EN_BODEGA, active: true, createdAt: new Date('2026-10-06T18:05:00Z'), subsidiaryId: 'hmo' };

describe('canMigrateShipmentToCharge', () => {
  it('paquete vivo, misma sucursal y reciente → se pasa a carga', () => {
    expect(canMigrateShipmentToCharge(base, { subsidiaryId: 'hmo', now })).toBe(true);
  });
  it.each([S.DEVUELTO_A_FEDEX, S.ENTREGADO, S.RETORNO_ABANDONO_FEDEX])('estatus final (%s) → carga nueva limpia', (status) => {
    expect(canMigrateShipmentToCharge({ ...base, status }, { subsidiaryId: 'hmo', now })).toBe(false);
  });
  it('otra sucursal → no', () => {
    expect(canMigrateShipmentToCharge({ ...base, subsidiaryId: 'lpz' }, { subsidiaryId: 'hmo', now })).toBe(false);
  });
  it('dado de baja → no', () => {
    expect(canMigrateShipmentToCharge({ ...base, active: false }, { subsidiaryId: 'hmo', now })).toBe(false);
  });
  it('más viejo que la ventana → no', () => {
    expect(canMigrateShipmentToCharge({ ...base, createdAt: new Date('2026-08-01T00:00:00Z') }, { subsidiaryId: 'hmo', now })).toBe(false);
  });
});
