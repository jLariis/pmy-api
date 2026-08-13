import { resolveModule, MODULE_DIRECTORY } from './module-directory';

describe('module-directory', () => {
  it('resuelve por submenú', () => {
    expect(resolveModule(['consolidados'])?.key).toBe('operaciones/consolidados');
    expect(resolveModule(['gastos'])?.key).toBe('finanzas/gastos');
  });

  it('resuelve por variante de route (con guiones) y por nombre backend', () => {
    expect(resolveModule(['salidas-a-ruta'])?.key).toBe('operaciones/salidas_ruta');
    expect(resolveModule(['package-dispatch'])?.key).toBe('operaciones/salidas_ruta');
    expect(resolveModule(['unloading'])?.key).toBe('operaciones/desembarques');
  });

  it('prioriza el primer token específico', () => {
    // submenú específico gana sobre la sección amplia que va después
    expect(resolveModule(['inventarios', 'operaciones'])?.key).toBe('operaciones/inventarios');
  });

  it('devuelve null si nada coincide', () => {
    expect(resolveModule(['loquesea', 'xyz'])).toBeNull();
    expect(resolveModule([null, undefined, ''])).toBeNull();
  });

  it('cada entrada trae carpetas de frontend o backend reales (no vacías)', () => {
    for (const e of MODULE_DIRECTORY) {
      expect(e.frontend.length + e.backend.length).toBeGreaterThan(0);
    }
  });

  // Anti-desactualización: todo submenú del sidebar debe resolver a una entrada.
  const SIDEBAR_SUBMENUS = [
    'consolidados', 'desembarques', 'salidas_ruta', 'devoluciones', 'recolecciones', 'inventarios', 'bodega',
    'gastos', 'ingresos', 'reportes',
    'rutas', 'choferes', 'vehiculos', 'zonas', 'sucursales',
    'usuarios', 'roles', 'ajustes',
  ];
  it.each(SIDEBAR_SUBMENUS)('el submenú "%s" tiene entrada en el directorio', (sub) => {
    expect(resolveModule([sub])).not.toBeNull();
  });
});
