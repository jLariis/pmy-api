import { ShipmentStatusType } from './enums/shipment-status-type.enum';
import { isVendorScanCode, keepRouteOverVendorScan } from './vendor-scan.util';
import { VendorScanRouteRule } from 'src/tracking-sync/rules/vendor-scan-route.rule';

const { EN_RUTA, EN_BODEGA, ENTREGADO, PENDIENTE, DIRECCION_INCORRECTA } = ShipmentStatusType;

describe('keepRouteOverVendorScan', () => {
  it('un 67/44 no regresa a bodega un paquete en ruta (Cabo 878659510150, 19-oct)', () => {
    expect(keepRouteOverVendorScan(EN_RUTA, EN_BODEGA, '67')).toBe(EN_RUTA);
    expect(keepRouteOverVendorScan(EN_RUTA, EN_BODEGA, ' 44 ')).toBe(EN_RUTA);
  });

  it('sin salida a ruta, el 67/44 sí pone en bodega (trazabilidad intacta)', () => {
    expect(keepRouteOverVendorScan(PENDIENTE, EN_BODEGA, '67')).toBe(EN_BODEGA);
  });

  it('otros desenlaces de FedEx sí se aplican sobre en ruta', () => {
    expect(keepRouteOverVendorScan(EN_RUTA, ENTREGADO, '')).toBe(ENTREGADO);
    expect(keepRouteOverVendorScan(EN_RUTA, DIRECCION_INCORRECTA, '03')).toBe(DIRECCION_INCORRECTA);
    expect(keepRouteOverVendorScan(EN_RUTA, EN_BODEGA, '')).toBe(EN_BODEGA);
  });

  it('isVendorScanCode', () => {
    expect(isVendorScanCode('67')).toBe(true);
    expect(isVendorScanCode('08')).toBe(false);
    expect(isVendorScanCode(null)).toBe(false);
  });
});

describe('VendorScanRouteRule (motor nuevo)', () => {
  const ctx = (status: string, proposed: string, code: string) => ({
    shipment: { status },
    proposedStatus: proposed,
    normalized: { latest: { exceptionCode: code } },
    notes: [] as string[],
  }) as any;

  it('conserva en ruta y deja nota', () => {
    const c = ctx(EN_RUTA, EN_BODEGA, '67');
    new VendorScanRouteRule().apply(c);
    expect(c.proposedStatus).toBe(EN_RUTA);
    expect(c.notes[0]).toContain('67/44');
  });

  it('no toca lo demás', () => {
    const c = ctx(EN_RUTA, ENTREGADO, '');
    new VendorScanRouteRule().apply(c);
    expect(c.proposedStatus).toBe(ENTREGADO);
    expect(c.notes).toHaveLength(0);
  });
});
