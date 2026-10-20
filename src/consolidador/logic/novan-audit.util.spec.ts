import { noVanOutcomeFromTrack } from 'src/routeclosure/novan-income.util';
import { classifyNoVan } from './novan-audit.util';

const delivered = { trackingNumber: 'A', delivered: true, dexCode: null, resolved: true };
const transit = { trackingNumber: 'A', delivered: false, dexCode: null, resolved: true };
const dex07 = { trackingNumber: 'A', delivered: false, dexCode: '07', resolved: true };

describe('noVanOutcomeFromTrack', () => {
  it('sin rastreo → no resuelto', () => {
    expect(noVanOutcomeFromTrack('A', null)).toEqual({ trackingNumber: 'A', delivered: false, dexCode: null, resolved: false });
  });
  it('DL en el encabezado → entregado', () => {
    expect(noVanOutcomeFromTrack('A', { latestStatusDetail: { code: 'DL' }, scanEvents: [] })).toMatchObject({ delivered: true, resolved: true });
  });
  it('DE con 08 → código y fechas de 08', () => {
    const r = noVanOutcomeFromTrack('A', {
      latestStatusDetail: { code: 'DE' },
      scanEvents: [{ eventType: 'DE', exceptionCode: '08', date: '2026-10-14T18:00:00Z' }],
    });
    expect(r).toMatchObject({ delivered: false, dexCode: '08', resolved: true });
    expect(r.dex08Dates).toHaveLength(1);
  });
  it('en tránsito → resuelto sin código', () => {
    expect(noVanOutcomeFromTrack('A', { latestStatusDetail: { code: 'IT' }, scanEvents: [] })).toEqual(transit);
  });
});

describe('classifyNoVan', () => {
  const base = { is315: false, activeIncomes: 0, existsAsShipment: false, fedex: delivered };
  it('ya existe como paquete → manda el paquete', () => expect(classifyNoVan({ ...base, existsAsShipment: true }).status).toBe('es_paquete'));
  it('ruta 31.5 → no cobra', () => expect(classifyNoVan({ ...base, is315: true }).status).toBe('no_cobra_315'));
  it('con cobro activo → cobrada', () => expect(classifyNoVan({ ...base, activeIncomes: 1 }).status).toBe('cobrada'));
  it('sin FedEx en caché → sin verificar', () => expect(classifyNoVan({ ...base, fedex: null }).status).toBe('sin_verificar'));
  it('entregada sin cobro → sin cobro, sugiere POD', () => expect(classifyNoVan(base)).toEqual({ status: 'sin_cobro', suggestedKind: 'pod' }));
  it('DEX07 sin cobro → sin cobro, sugiere DEX', () => expect(classifyNoVan({ ...base, fedex: dex07 })).toEqual({ status: 'sin_cobro', suggestedKind: 'dex' }));
  it('en tránsito → en_transito', () => expect(classifyNoVan({ ...base, fedex: transit }).status).toBe('en_transito'));
});
