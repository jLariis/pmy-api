import { canTransition, assertTransition, canEditItems, canDelete } from './po-state.util';

describe('po-state', () => {
  it.each([
    ['borrador', 'pendiente'], ['pendiente', 'autorizada'], ['pendiente', 'rechazada'], ['rechazada', 'borrador'],
    ['autorizada', 'enviada'], ['enviada', 'enviada'], ['enviada', 'completada'], ['autorizada', 'cancelada'], ['enviada', 'cancelada'],
  ])('%s→%s ok', (a, b) => expect(canTransition(a as any, b as any)).toBe(true));
  it.each([['borrador', 'enviada'], ['borrador', 'autorizada'], ['completada', 'cancelada'], ['autorizada', 'completada']])(
    '%s→%s no', (a, b) => expect(canTransition(a as any, b as any)).toBe(false));
  it('assert lanza', () => expect(() => assertTransition('borrador', 'enviada')).toThrow());
  it('edición', () => {
    expect(canEditItems('borrador', false)).toBe(true);
    expect(canEditItems('pendiente', false)).toBe(false);
    expect(canEditItems('pendiente', true)).toBe(true);
    expect(canEditItems('autorizada', true)).toBe(true);
    expect(canEditItems('enviada', true)).toBe(false);
  });
  it('borrado', () => {
    expect(canDelete('borrador')).toBe(true);
    expect(canDelete('rechazada')).toBe(true);
    expect(canDelete('autorizada')).toBe(false);
  });
});
