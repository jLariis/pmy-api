import { classifyLd, herDay } from './ld-rule.util';

const base = { status: 'en_ruta', due: 'today' as const, dexOnCommitDay: false, movedOnCommitDay: false, requireNoMovement: true, excludeClosed: true };

describe('classifyLd', () => {
  it('vence hoy sin DEX ni movimiento → possible_ld', () => {
    expect(classifyLd(base)).toBe('possible_ld');
  });

  it('vence hoy con DEX válido ese día → active', () => {
    expect(classifyLd({ ...base, dexOnCommitDay: true })).toBe('active');
  });

  it('vencido sin movimiento su día → ld', () => {
    expect(classifyLd({ ...base, due: 'past' })).toBe('ld');
  });

  it('entregado en bodega → delivered', () => {
    expect(classifyLd({ ...base, status: 'entregado_en_bodega' })).toBe('delivered');
  });

  it('devuelto a FedEx → closed cuando excludeClosed', () => {
    expect(classifyLd({ ...base, status: 'devuelto_a_fedex' })).toBe('closed');
  });

  it('devuelto a FedEx cuenta como LD si no se excluyen cerrados (reportes)', () => {
    expect(classifyLd({ ...base, status: 'devuelto_a_fedex', excludeClosed: false })).toBe('possible_ld');
  });

  it('requireNoMovement=false: con movimiento pero sin DEX sigue siendo possible_ld', () => {
    expect(classifyLd({ ...base, movedOnCommitDay: true, requireNoMovement: false })).toBe('possible_ld');
  });

  it('requireNoMovement=true: con movimiento → active', () => {
    expect(classifyLd({ ...base, movedOnCommitDay: true })).toBe('active');
  });

  it('sin fecha de vencimiento → active', () => {
    expect(classifyLd({ ...base, due: null })).toBe('active');
  });
});

describe('herDay', () => {
  it('convierte a día de Hermosillo (UTC-7)', () => {
    expect(herDay('2026-10-17T06:59:00.000Z')).toBe('2026-10-16');
    expect(herDay(new Date('2026-10-17T07:00:00.000Z'))).toBe('2026-10-17');
  });
});
