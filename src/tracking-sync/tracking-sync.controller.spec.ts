import { TrackingSyncController } from './tracking-sync.controller';

describe('TrackingSyncController', () => {
  const compare = {
    compareByTracking: jest.fn().mockResolvedValue({ trackingNumber: 'TN1' }),
    compareByRoute: jest.fn().mockResolvedValue([]),
    compareByConsolidated: jest.fn().mockResolvedValue([]),
    applyMany: jest.fn().mockResolvedValue([]),
  } as any;
  const ctrl = new TrackingSyncController(compare);

  it('delegates compare/tracking', async () => {
    await ctrl.compareTracking('TN1');
    expect(compare.compareByTracking).toHaveBeenCalledWith('TN1');
  });
  it('delegates compare/route', async () => {
    await ctrl.compareRoute('r1');
    expect(compare.compareByRoute).toHaveBeenCalledWith('r1');
  });
  it('delegates compare/consolidated', async () => {
    await ctrl.compareConsolidated('c1');
    expect(compare.compareByConsolidated).toHaveBeenCalledWith('c1');
  });
  it('apply delegates to compare.applyMany with actor from req.user', async () => {
    const req = { user: { id: 'u1', name: 'Super', role: 'superadmin' } };
    await ctrl.apply({ shipmentIds: ['s1', 's2'] }, req);
    expect(compare.applyMany).toHaveBeenCalledWith(['s1', 's2'], { userId: 'u1', userName: 'Super', role: 'superadmin' });
  });
});
