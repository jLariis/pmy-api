import { mapDhlCodeToInternal } from './dhl.utils';
import { ShipmentStatusType } from '../common/enums/shipment-status-type.enum';
import { DhlStatusType } from '../common/enums/dhl-status-type.enum';

describe('mapDhlCodeToInternal (traductor DHL → capa canónica)', () => {
  it('OK → entregado, cobra y es terminal', () => {
    expect(mapDhlCodeToInternal(DhlStatusType.OK)).toEqual({
      internalStatus: ShipmentStatusType.ENTREGADO,
      chargeable: true,
      terminal: true,
    });
  });

  it('SOLO OK cobra y es terminal; los demás no', () => {
    for (const code of [DhlStatusType.NH, DhlStatusType.BA, DhlStatusType.RD, DhlStatusType.CM]) {
      const r = mapDhlCodeToInternal(code);
      expect(r.chargeable).toBe(false);
      expect(r.terminal).toBe(false);
    }
  });

  it('mapea cada código no-OK a su estatus canónico interno', () => {
    expect(mapDhlCodeToInternal(DhlStatusType.NH).internalStatus).toBe(ShipmentStatusType.CLIENTE_NO_DISPONIBLE);
    expect(mapDhlCodeToInternal(DhlStatusType.BA).internalStatus).toBe(ShipmentStatusType.DIRECCION_INCORRECTA);
    expect(mapDhlCodeToInternal(DhlStatusType.RD).internalStatus).toBe(ShipmentStatusType.RECHAZADO);
    expect(mapDhlCodeToInternal(DhlStatusType.CM).internalStatus).toBe(ShipmentStatusType.CAMBIO_DOMICILIO);
  });

  it('es case-insensitive y tolera espacios', () => {
    expect(mapDhlCodeToInternal('  ok  ').internalStatus).toBe(ShipmentStatusType.ENTREGADO);
    expect(mapDhlCodeToInternal('nh').internalStatus).toBe(ShipmentStatusType.CLIENTE_NO_DISPONIBLE);
  });

  it('código desconocido → pendiente, sin cobro, no terminal', () => {
    expect(mapDhlCodeToInternal('ZZ')).toEqual({
      internalStatus: ShipmentStatusType.PENDIENTE,
      chargeable: false,
      terminal: false,
    });
    expect(mapDhlCodeToInternal('')).toEqual({
      internalStatus: ShipmentStatusType.PENDIENTE,
      chargeable: false,
      terminal: false,
    });
  });
});
