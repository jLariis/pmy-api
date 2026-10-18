import { dexCodeOf, isDexStatus, summarizePackages } from './package-summary.util';

const row = (status: string, o: Partial<{ exceptionCode: string | null; unloaded: boolean; inTodayInventory: boolean; ld: any }> = {}) => ({
  status, exceptionCode: null, unloaded: true, inTodayInventory: false, ld: 'active' as const, ...o,
});

describe('summarizePackages', () => {
  it('agrupa DEX por código', () => {
    const s = summarizePackages([row('direccion_incorrecta'), row('rechazado'), row('cliente_no_disponible'), row('cliente_no_disponible')]);
    expect(s.dex).toEqual({ '03': 1, '07': 1, '08': 2 });
  });

  it('cuenta entregados, en ruta, devueltos y en bodega', () => {
    const s = summarizePackages([row('entregado'), row('entregado_en_bodega'), row('en_ruta'), row('devuelto_a_fedex'), row('en_bodega'), row('pendiente')]);
    expect(s).toMatchObject({ delivered: 2, inRoute: 1, returned: 1, inWarehouse: 2 });
  });

  it('cuenta posibles LD y guías en el inventario de hoy', () => {
    const s = summarizePackages([row('en_bodega', { ld: 'possible_ld', inTodayInventory: true }), row('en_ruta', { ld: 'possible_ld' })]);
    expect(s).toMatchObject({ possibleLd: 2, inInventory: 1 });
  });

  it('faltantes de desembarque: no desembarcadas que no están entregadas ni devueltas', () => {
    const s = summarizePackages([row('pendiente', { unloaded: false }), row('entregado', { unloaded: false })]);
    expect(s.missingUnloading).toBe(1);
  });
});

describe('dexCodeOf / isDexStatus', () => {
  it('usa el exceptionCode si existe y si no lo deduce del estatus', () => {
    expect(dexCodeOf('rechazado', null)).toBe('07');
    expect(dexCodeOf('cliente_no_disponible', '08')).toBe('08');
    expect(dexCodeOf('no_entregado', null)).toBe('otro');
  });
  it('devuelto a FedEx no es DEX pendiente', () => {
    expect(isDexStatus('devuelto_a_fedex')).toBe(false);
    expect(isDexStatus('empresa_cerrada')).toBe(true);
  });
});
