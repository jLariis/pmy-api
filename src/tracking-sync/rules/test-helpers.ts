import { SyncContext } from '../tracking-sync.types';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

/** Construye un SyncContext mínimo para tests de reglas. */
export function makeCtx(overrides: {
  current: ShipmentStatusType;
  proposed: ShipmentStatusType | null;
  subsidiary?: any;
  events?: any[];
}): SyncContext {
  return {
    shipment: { id: 's1', trackingNumber: 'TN', status: overrides.current, subsidiary: overrides.subsidiary } as any,
    kind: 'shipment',
    normalized: {
      trackingNumber: 'TN',
      events: overrides.events ?? [],
      latest: null,
      commitDateTime: null,
      header: {
        code: null, derivedCode: null, ancillaryReason: null, isDeliveredHeader: false,
        actualDeliveryAt: null, receivedByName: null, uniqueId: null, carrierCode: null, code44At: null,
      },
      validation: { ok: true, issues: [] },
    },
    reconcile: {
      newEvents: [],
      proposedStatus: overrides.proposed,
      currentStatus: overrides.current,
      transition: null,
    },
    existing: { lastOpTime: 0, count08: 0 },
    proposedStatus: overrides.proposed,
    vetoedEventKeys: new Set<string>(),
    deferredEffects: [],
    notes: [],
  };
}
