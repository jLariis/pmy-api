import { extractFedexDayOutcome, selectLatestGeneration } from './fedex-day-outcome.util';

const ev = (eventType: string, date: string, exceptionCode = '') => ({ eventType, date, exceptionCode });
const track = (scanEvents: any[]) => ({ scanEvents });

describe('extractFedexDayOutcome', () => {
  it('DL del día → POD', () => {
    const r = extractFedexDayOutcome(track([ev('OD', '2026-09-22T08:00:00-07:00'), ev('DL', '2026-09-22T13:00:00-07:00')]), '2026-09-22');
    expect(r).toMatchObject({ ok: true, outcome: 'POD', outcomeAt: '2026-09-22T20:00:00.000Z' });
  });

  it('DE 08 del día → 08, y dex08Dates trae todos los 08 (de cualquier día)', () => {
    const r = extractFedexDayOutcome(
      track([
        ev('DE', '2026-09-18T12:00:00-07:00', '08'),
        ev('DE', '2026-09-21T11:44:00-07:00', '08'),
        ev('DE', '2026-09-22T15:41:00-07:00', '08'),
      ]),
      '2026-09-22',
    );
    expect(r.outcome).toBe('08');
    expect(r.dex08Dates).toHaveLength(3);
  });

  it('DE 07 y DL el mismo día → POD (entregado gana)', () => {
    const r = extractFedexDayOutcome(track([ev('DE', '2026-09-22T10:00:00-07:00', '07'), ev('DL', '2026-09-22T12:00:00-07:00')]), '2026-09-22');
    expect(r.outcome).toBe('POD');
  });

  it('07 gana a 08 el mismo día', () => {
    const r = extractFedexDayOutcome(track([ev('DE', '2026-09-22T10:00:00-07:00', '08'), ev('DE', '2026-09-22T12:00:00-07:00', '07')]), '2026-09-22');
    expect(r.outcome).toBe('07');
  });

  it('solo eventos no cobrables del día → OTRO', () => {
    const r = extractFedexDayOutcome(track([ev('OD', '2026-09-22T08:00:00-07:00'), ev('DE', '2026-09-22T12:00:00-07:00', '03')]), '2026-09-22');
    expect(r.outcome).toBe('OTRO');
  });

  it('latestOutcome = desenlace del último evento de FedEx (cualquier día)', () => {
    const r = extractFedexDayOutcome(track([ev('DE', '2026-09-14T12:00:00-07:00', '08'), ev('DL', '2026-09-16T12:00:00-07:00')]), '2026-09-14');
    expect(r).toMatchObject({ outcome: '08', latestOutcome: 'POD' });
  });

  it('sin eventos del día → null', () => {
    const r = extractFedexDayOutcome(track([ev('DL', '2026-09-23T12:00:00-07:00')]), '2026-09-22');
    expect(r).toMatchObject({ ok: true, outcome: null });
  });

  it('usa el día Hermosillo: 23:30 local del 21 (06:30Z del 22) cuenta al 21', () => {
    const r = extractFedexDayOutcome(track([ev('DL', '2026-09-22T06:30:00Z')]), '2026-09-21');
    expect(r.outcome).toBe('POD');
  });

  it('sin resultado de FedEx → ok=false', () => {
    expect(extractFedexDayOutcome(null, '2026-09-22')).toMatchObject({ ok: false, outcome: null, dex08Dates: [] });
  });
});

describe('selectLatestGeneration', () => {
  it('gana la secuencia de UniqueID más alta', () => {
    const a = { id: 'a', trackingNumberInfo: { trackingNumberUniqueId: '2~123~FDEG' } };
    const b = { id: 'b', trackingNumberInfo: { trackingNumberUniqueId: '12~123~FDEG' } };
    expect(selectLatestGeneration([a, b])).toBe(b);
  });

  it('vacío → null; uno → ese', () => {
    expect(selectLatestGeneration([])).toBeNull();
    const a = { id: 'a' };
    expect(selectLatestGeneration([a])).toBe(a);
  });
});
