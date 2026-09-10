import { mapDhlCodeToInternal, resolveDhlNativeStatus } from './dhl.utils';
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

describe('resolveDhlNativeStatus (API oficial DHL Unified → capa canónica)', () => {
  it('entregado: statusCode=delivered → ENTREGADO (cobra, terminal)', () => {
    expect(resolveDhlNativeStatus('delivered', '101')).toEqual({
      internalStatus: ShipmentStatusType.ENTREGADO,
      chargeable: true,
      terminal: true,
    });
  });

  it('entregado: evento OK aunque el statusCode no sea delivered → ENTREGADO', () => {
    expect(resolveDhlNativeStatus('transit', 'OK')).toEqual({
      internalStatus: ShipmentStatusType.ENTREGADO,
      chargeable: true,
      terminal: true,
    });
  });

  it('incidencia con código de resultado fino → DEX exacto (sin cobro, no terminal)', () => {
    expect(resolveDhlNativeStatus('failure', 'NH')?.internalStatus).toBe(ShipmentStatusType.CLIENTE_NO_DISPONIBLE);
    expect(resolveDhlNativeStatus('failure', 'BA')?.internalStatus).toBe(ShipmentStatusType.DIRECCION_INCORRECTA);
    expect(resolveDhlNativeStatus('failure', 'RD')?.internalStatus).toBe(ShipmentStatusType.RECHAZADO);
    expect(resolveDhlNativeStatus('transit', 'CM')?.internalStatus).toBe(ShipmentStatusType.CAMBIO_DOMICILIO);
    expect(resolveDhlNativeStatus('failure', 'NH')?.chargeable).toBe(false);
  });

  it('fallo genérico sin código fino → NO_ENTREGADO', () => {
    expect(resolveDhlNativeStatus('failure', 'ZZ')).toEqual({
      internalStatus: ShipmentStatusType.NO_ENTREGADO,
      chargeable: false,
      terminal: false,
    });
  });

  it('tránsito → EN_RUTA (paridad con FedEx IT/OD)', () => {
    expect(resolveDhlNativeStatus('transit', 'FD')?.internalStatus).toBe(ShipmentStatusType.EN_RUTA);
    expect(resolveDhlNativeStatus('transit', 'PL')?.internalStatus).toBe(ShipmentStatusType.EN_RUTA);
    expect(resolveDhlNativeStatus('transit', undefined)?.internalStatus).toBe(ShipmentStatusType.EN_RUTA);
  });

  it('pre-tránsito → PENDIENTE', () => {
    expect(resolveDhlNativeStatus('pre-transit', undefined)?.internalStatus).toBe(ShipmentStatusType.PENDIENTE);
    expect(resolveDhlNativeStatus('pretransit', 'AB')?.internalStatus).toBe(ShipmentStatusType.PENDIENTE);
  });

  it('desconocido / sin dato → null (no persistir)', () => {
    expect(resolveDhlNativeStatus('unknown', undefined)).toBeNull();
    expect(resolveDhlNativeStatus('', '')).toBeNull();
    expect(resolveDhlNativeStatus(undefined, undefined)).toBeNull();
    expect(resolveDhlNativeStatus('algo-raro', 'XX')).toBeNull();
  });

  it('es tolerante a mayúsculas/espacios', () => {
    expect(resolveDhlNativeStatus('  DELIVERED  ', undefined)?.internalStatus).toBe(ShipmentStatusType.ENTREGADO);
    expect(resolveDhlNativeStatus('Transit', ' ok ')?.internalStatus).toBe(ShipmentStatusType.ENTREGADO);
  });
});
