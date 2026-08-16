import { FedexTrackingSource } from './fedex-tracking.source';

describe('FedexTrackingSource', () => {
  it('picks the highest-sequence generation when FedEx returns several trackResults', async () => {
    const fedex = {
      trackBatch: jest.fn().mockResolvedValue(
        new Map([
          ['TN1', [
            { trackingNumberInfo: { trackingNumberUniqueId: '2453~old' }, scanEvents: [{ date: '2026-08-10T00:00:00Z' }] },
            { trackingNumberInfo: { trackingNumberUniqueId: '2456~new' }, scanEvents: [{ date: '2026-08-14T00:00:00Z' }] },
          ]],
        ]),
      ),
    } as any;

    const source = new FedexTrackingSource(fedex);
    const [res] = await source.fetch([{ trackingNumber: 'TN1' }]);
    expect(res.trackResults).toHaveLength(1);
    expect(res.trackResults[0].trackingNumberInfo.trackingNumberUniqueId).toBe('2456~new');
  });

  it('returns empty trackResults when FedEx has no data for a tracking', async () => {
    const fedex = { trackBatch: jest.fn().mockResolvedValue(new Map()) } as any;
    const source = new FedexTrackingSource(fedex);
    const [res] = await source.fetch([{ trackingNumber: 'MISSING' }]);
    expect(res.trackResults).toHaveLength(0);
  });
});
