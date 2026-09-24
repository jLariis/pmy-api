import { noVanIncomeDecision, NoVanFedexOutcome } from './novan-income.util';
import { IncomeStatus } from 'src/common/enums/income-status.enum';

const outcome = (o: Partial<NoVanFedexOutcome>): NoVanFedexOutcome => ({
  trackingNumber: 'TN',
  delivered: false,
  dexCode: null,
  resolved: true,
  ...o,
});

describe('noVanIncomeDecision', () => {
  it('no cobra si FedEx no resolvió (no encontrado / caído)', () => {
    expect(noVanIncomeDecision(outcome({ resolved: false }))).toBeNull();
    // resolved=false gana aunque venga delivered/dexCode por ruido.
    expect(noVanIncomeDecision(outcome({ resolved: false, delivered: true }))).toBeNull();
  });

  it('no cobra si está en tránsito (resuelto pero sin entregar ni DEX)', () => {
    expect(noVanIncomeDecision(outcome({ delivered: false, dexCode: null }))).toBeNull();
  });

  it('cobra ENTREGADO sin nonDeliveryStatus cuando fue entregado', () => {
    expect(noVanIncomeDecision(outcome({ delivered: true }))).toEqual({
      incomeType: IncomeStatus.ENTREGADO,
      nonDeliveryStatus: null,
    });
  });

  it('cobra NO_ENTREGADO con el código DEX cuando hay excepción de entrega', () => {
    expect(noVanIncomeDecision(outcome({ delivered: false, dexCode: '07' }))).toEqual({
      incomeType: IncomeStatus.NO_ENTREGADO,
      nonDeliveryStatus: '07',
    });
  });

  it('prioriza entregado: si delivered=true ignora dexCode', () => {
    expect(noVanIncomeDecision(outcome({ delivered: true, dexCode: '03' }))).toEqual({
      incomeType: IncomeStatus.ENTREGADO,
      nonDeliveryStatus: null,
    });
  });

  describe('DEX08 exige 3 días distintos con 08 en la misma semana ISO', () => {
    // Casos reales Hermosillo 22-09-2026 (cobraron sin 3 visitas).
    it('NO cobra 08 con una sola visita (540148275693)', () => {
      expect(noVanIncomeDecision(outcome({ dexCode: '08', dex08Dates: [new Date('2026-09-22T20:53:00Z')] }))).toBeNull();
    });

    it('NO cobra 08 con dos visitas en la semana (877368113055)', () => {
      const dex08Dates = [new Date('2026-09-21T18:44:00Z'), new Date('2026-09-22T22:41:00Z')];
      expect(noVanIncomeDecision(outcome({ dexCode: '08', dex08Dates }))).toBeNull();
    });

    it('NO cobra 08 sin historial de visitas', () => {
      expect(noVanIncomeDecision(outcome({ dexCode: '08' }))).toBeNull();
    });

    it('NO cobra 08 con 3 visitas repartidas en 2 semanas', () => {
      const dex08Dates = [new Date('2026-09-18T18:00:00Z'), new Date('2026-09-21T18:00:00Z'), new Date('2026-09-22T18:00:00Z')];
      expect(noVanIncomeDecision(outcome({ dexCode: '08', dex08Dates }))).toBeNull();
    });

    it('cobra 08 con 3 días distintos en la misma semana', () => {
      const dex08Dates = [new Date('2026-09-21T18:00:00Z'), new Date('2026-09-22T18:00:00Z'), new Date('2026-09-23T18:00:00Z')];
      expect(noVanIncomeDecision(outcome({ dexCode: '08', dex08Dates }))).toEqual({
        incomeType: IncomeStatus.NO_ENTREGADO,
        nonDeliveryStatus: '08',
      });
    });

    it('la regla de 3 visitas NO aplica a otros DEX (07 cobra con 1)', () => {
      expect(noVanIncomeDecision(outcome({ dexCode: '07' }))?.nonDeliveryStatus).toBe('07');
    });
  });
});
