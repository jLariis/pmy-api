import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import {
  blocksManualDuplicate,
  normalizeManualTracking,
  resolveManualCarrier,
  resolveManualKind,
} from './manual-shipment.util';

describe('manual-shipment.util', () => {
  describe('resolveManualCarrier / resolveManualKind', () => {
    it('FedEx y paquete por defecto', () => {
      expect(resolveManualCarrier(undefined)).toBe(ShipmentType.FEDEX);
      expect(resolveManualCarrier('otro')).toBe(ShipmentType.FEDEX);
      expect(resolveManualCarrier('DHL')).toBe(ShipmentType.DHL);
      expect(resolveManualKind(undefined)).toBe('shipment');
      expect(resolveManualKind('charge')).toBe('charge');
    });
  });

  describe('normalizeManualTracking FedEx', () => {
    it('acepta la guía de la etiqueta con espacios', () => {
      expect(normalizeManualTracking({ trackingNumber: '8772 2037 5691' })).toEqual({
        ok: true, carrier: ShipmentType.FEDEX, trackingNumber: '877220375691', dhlUniqueId: null,
      });
    });

    it('rechaza longitudes inválidas y vacío', () => {
      expect(normalizeManualTracking({ trackingNumber: '12345' }).ok).toBe(false);
      expect(normalizeManualTracking({ trackingNumber: '' }).ok).toBe(false);
    });
  });

  describe('normalizeManualTracking DHL', () => {
    it('guía de 10 dígitos + pieza JJD se guarda como JD', () => {
      expect(normalizeManualTracking({
        carrier: 'dhl', trackingNumber: '1234567890', dhlUniqueId: 'JJD004600012672343626',
      })).toEqual({
        ok: true, carrier: ShipmentType.DHL, trackingNumber: '1234567890', dhlUniqueId: 'JD004600012672343626',
      });
    });

    it('pieza opcional', () => {
      const r = normalizeManualTracking({ carrier: 'dhl', trackingNumber: '1234567890' });
      expect(r).toMatchObject({ ok: true, dhlUniqueId: null });
    });

    it('si ponen el JD en la guía, explica dónde va', () => {
      const r = normalizeManualTracking({ carrier: 'dhl', trackingNumber: 'JD004600012672343626' });
      expect(r.ok).toBe(false);
      expect((r as { message?: string }).message).toMatch(/ID de pieza/);
    });

    it('rechaza pieza mal formada', () => {
      expect(normalizeManualTracking({ carrier: 'dhl', trackingNumber: '1234567890', dhlUniqueId: 'ABC' }).ok).toBe(false);
    });
  });

  describe('blocksManualDuplicate', () => {
    it('bloquea si el existente sigue vivo', () => {
      expect(blocksManualDuplicate({ status: ShipmentStatusType.EN_RUTA })).toBe(true);
      expect(blocksManualDuplicate({ status: ShipmentStatusType.PENDIENTE, active: true })).toBe(true);
    });

    it('permite reingreso si el existente es terminal o está dado de baja', () => {
      expect(blocksManualDuplicate({ status: ShipmentStatusType.ENTREGADO })).toBe(false);
      expect(blocksManualDuplicate({ status: ShipmentStatusType.DEVUELTO_A_FEDEX })).toBe(false);
      expect(blocksManualDuplicate({ status: ShipmentStatusType.EN_RUTA, active: false })).toBe(false);
    });
  });
});
