import { ExistingEventLoader } from './existing-event-loader';
import { buildShadowKey } from './event-key.util';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

describe('ExistingEventLoader', () => {
  it('builds a set of shadowKeys from existing shipment_status rows', async () => {
    const ts = new Date('2026-08-14T20:00:00Z');
    const repo = {
      find: jest.fn().mockResolvedValue([
        { timestamp: ts, exceptionCode: '08', status: ShipmentStatusType.CLIENTE_NO_DISPONIBLE },
      ]),
    } as any;
    const loader = new ExistingEventLoader(repo);
    const keys = await loader.load('s1');
    expect(keys.has(buildShadowKey(ts.getTime(), '08', ShipmentStatusType.CLIENTE_NO_DISPONIBLE))).toBe(true);
  });
});
