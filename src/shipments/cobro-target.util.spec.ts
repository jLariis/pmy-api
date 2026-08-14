import { resolveCobroTarget, CobroCandidates } from './cobro-target.util';

const S = { id: 's' }; // marcador de shipment
const C = { id: 'c' }; // marcador de charge_shipment

const candidates = (c: Partial<CobroCandidates>): CobroCandidates => ({
  shipmentByCons: null,
  chargeByCons: null,
  shipmentByTracking: null,
  chargeByTracking: null,
  ...c,
});

describe('resolveCobroTarget', () => {
  it('sin candidatos ⇒ null (sin match)', () => {
    expect(resolveCobroTarget(candidates({}))).toBeNull();
  });

  it('shipment por consNumber ⇒ shipment/cons', () => {
    expect(resolveCobroTarget(candidates({ shipmentByCons: S }))).toEqual({
      kind: 'shipment',
      source: 'cons',
    });
  });

  it('sin shipment pero con carga por consNumber ⇒ charge/cons', () => {
    expect(resolveCobroTarget(candidates({ chargeByCons: C }))).toEqual({
      kind: 'charge',
      source: 'cons',
    });
  });

  it('fallback: sin match por cons, shipment por tracking ⇒ shipment/tracking', () => {
    expect(resolveCobroTarget(candidates({ shipmentByTracking: S }))).toEqual({
      kind: 'shipment',
      source: 'tracking',
    });
  });

  it('fallback: solo carga por tracking (carga sin consNumber) ⇒ charge/tracking', () => {
    expect(resolveCobroTarget(candidates({ chargeByTracking: C }))).toEqual({
      kind: 'charge',
      source: 'tracking',
    });
  });

  it('precedencia: shipment por cons gana a carga por cons', () => {
    expect(
      resolveCobroTarget(candidates({ shipmentByCons: S, chargeByCons: C })),
    ).toEqual({ kind: 'shipment', source: 'cons' });
  });

  it('precedencia: match por cons gana al match por tracking', () => {
    expect(
      resolveCobroTarget(
        candidates({ chargeByCons: C, shipmentByTracking: S, chargeByTracking: C }),
      ),
    ).toEqual({ kind: 'charge', source: 'cons' });
  });

  it('precedencia: shipment por tracking gana a carga por tracking', () => {
    expect(
      resolveCobroTarget(candidates({ shipmentByTracking: S, chargeByTracking: C })),
    ).toEqual({ kind: 'shipment', source: 'tracking' });
  });

  it('trata undefined (no buscado) igual que null (no existe)', () => {
    expect(resolveCobroTarget({ chargeByTracking: C })).toEqual({
      kind: 'charge',
      source: 'tracking',
    });
  });
});
