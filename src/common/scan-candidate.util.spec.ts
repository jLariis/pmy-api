import { pickScanCandidate } from './scan-candidate.util';
import { ShipmentStatusType } from './enums/shipment-status-type.enum';

const d = (iso: string) => new Date(iso);

describe('pickScanCandidate', () => {
  it('guía devuelta en consolidado viejo que regresa en una carga ⇒ gana la carga (no el shipment viejo)', () => {
    const shipment = { id: 'old', status: ShipmentStatusType.DEVUELTO_A_FEDEX, createdAt: d('2026-09-02T17:58:37Z') };
    const charge = { id: 'new', status: ShipmentStatusType.PENDIENTE, createdAt: d('2026-09-24T17:41:09Z') };
    expect(pickScanCandidate(shipment, charge)).toEqual({ kind: 'charge', record: charge });
  });

  it('aunque el shipment viejo no esté marcado devuelto, gana el registro más reciente', () => {
    const shipment = { id: 'old', status: ShipmentStatusType.RECHAZADO, createdAt: d('2026-09-02T17:58:37Z') };
    const charge = { id: 'new', status: ShipmentStatusType.PENDIENTE, createdAt: d('2026-09-24T17:41:09Z') };
    expect(pickScanCandidate(shipment, charge)?.kind).toBe('charge');
  });

  it('shipment más reciente que la carga ⇒ gana el shipment', () => {
    const shipment = { id: 's', status: ShipmentStatusType.PENDIENTE, createdAt: d('2026-09-24T10:00:00Z') };
    const charge = { id: 'c', status: ShipmentStatusType.PENDIENTE, createdAt: d('2026-09-01T10:00:00Z') };
    expect(pickScanCandidate(shipment, charge)?.kind).toBe('shipment');
  });

  it('nunca elige un registro devuelto a FedEx aunque sea el más reciente', () => {
    const shipment = { id: 's', status: ShipmentStatusType.PENDIENTE, createdAt: d('2026-09-01T10:00:00Z') };
    const charge = { id: 'c', status: ShipmentStatusType.DEVUELTO_A_FEDEX, createdAt: d('2026-09-24T10:00:00Z') };
    expect(pickScanCandidate(shipment, charge)?.kind).toBe('shipment');
  });

  it('solo existe devuelto ⇒ returned (no se puede sacar a ruta)', () => {
    const shipment = { id: 's', status: ShipmentStatusType.DEVUELTO_A_FEDEX, createdAt: d('2026-09-02T10:00:00Z') };
    expect(pickScanCandidate(shipment, null)).toEqual({ kind: 'returned', record: shipment });
  });

  it('no existe en ningún lado ⇒ null', () => {
    expect(pickScanCandidate(null, null)).toBeNull();
  });
});
