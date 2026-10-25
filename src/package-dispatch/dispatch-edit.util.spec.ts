import { canEditDispatch, normalizeReason, statusBeforeDispatch } from './dispatch-edit.util';

describe('dispatch-edit.util', () => {
  it('solo se editan salidas abiertas', () => {
    expect(canEditDispatch('Pendiente')).toBe(true);
    expect(canEditDispatch('En progreso')).toBe(true);
    expect(canEditDispatch('Completada')).toBe(false);
    expect(canEditDispatch('Cancelada')).toBe(false);
  });

  it('al quitar, regresa al último estatus ANTES de entrar a la salida (no cuenta en_ruta)', () => {
    const h = [
      { status: 'pendiente', timestamp: '2026-10-20T10:00:00Z' },
      { status: 'en_bodega', timestamp: '2026-10-23T15:00:00Z' },
      { status: 'en_ruta', timestamp: '2026-10-24T14:00:00Z' },
      { status: 'entregado', timestamp: '2026-10-25T20:00:00Z' }, // posterior: no cuenta
    ];
    expect(statusBeforeDispatch(h, '2026-10-24T14:00:00Z')).toBe('en_bodega');
  });

  it('sin historial útil vuelve a en_bodega', () => {
    expect(statusBeforeDispatch([{ status: 'en_ruta', timestamp: '2026-10-24T14:00:00Z' }], '2026-10-24T14:00:00Z')).toBe('en_bodega');
    expect(statusBeforeDispatch([], null)).toBe('en_bodega');
  });

  it('el motivo se limpia y es obligatorio', () => {
    expect(normalizeReason('  llegó   tarde ')).toBe('llegó tarde');
    expect(normalizeReason(undefined)).toBe('');
  });
});
