/**
 * Directorio de módulos: mapa **versionado** (viaja con la API, no depende de
 * `graphify-out/` ni del repo `app-pmy`) que traduce la ubicación de un ticket
 * (menú/submenú/sección/route) a carpetas reales de **frontend y backend**.
 *
 * Es la fuente primaria del contexto de código del prompt: siempre disponible en
 * producción y determinista. El grafo de graphify queda como enriquecimiento en dev.
 *
 * Mantenimiento: cuando se agrega un módulo al sidebar, agrega su entrada aquí.
 * `module-directory.spec.ts` verifica que cada submenú conocido resuelva.
 */
export interface ModuleEntry {
  /** Clave canónica (sección/submenú). */
  key: string;
  label: string;
  /** Tokens que apuntan a esta entrada: submenú, segmento de route (con guiones), nombre del módulo backend. */
  match: string[];
  /** Carpetas/archivos reales del frontend (app-pmy). */
  frontend: string[];
  /** Carpetas/archivos reales del backend (pmy-api). */
  backend: string[];
}

export const MODULE_DIRECTORY: ModuleEntry[] = [
  // ---- Operaciones ----
  { key: 'operaciones/consolidados', label: 'Consolidados',
    match: ['consolidados', 'consolidado', 'consolidated'],
    frontend: ['app/operaciones/consolidados'], backend: ['src/consolidated'] },
  { key: 'operaciones/desembarques', label: 'Desembarques',
    match: ['desembarques', 'desembarque', 'unloading', 'unloadings'],
    frontend: ['app/operaciones/desembarques'], backend: ['src/unloading'] },
  { key: 'operaciones/salidas_ruta', label: 'Salidas a ruta',
    match: ['salidas_ruta', 'salidas-a-ruta', 'salidas', 'package-dispatch', 'package-dispatchs'],
    frontend: ['app/operaciones/salidas-a-ruta', 'components/package-dispatch'], backend: ['src/package-dispatch'] },
  { key: 'operaciones/devoluciones', label: 'Devoluciones',
    match: ['devoluciones', 'devolucion', 'devolutions'],
    frontend: ['app/operaciones/devoluciones', 'components/devoluciones'], backend: ['src/devolutions'] },
  { key: 'operaciones/recolecciones', label: 'Recolecciones',
    match: ['recolecciones', 'recoleccion', 'pick-up', 'pickup', 'collections'],
    frontend: ['app/operaciones/recepcion-bodega'], backend: ['src/pick-up', 'src/collections'] },
  { key: 'operaciones/inventarios', label: 'Inventarios',
    match: ['inventarios', 'inventario', 'inventories'],
    frontend: ['app/operaciones/inventarios'], backend: ['src/inventories'] },
  { key: 'operaciones/bodega', label: 'Bodega',
    match: ['bodega', 'warehouse'],
    frontend: ['app/bodega', 'components/warehouse'], backend: ['src/warehouse'] },
  { key: 'operaciones/traslados', label: 'Traslados',
    match: ['traslados', 'traslado', 'transfer', 'transfers', 'package-transfer'],
    frontend: ['app/operaciones/traslados'], backend: ['src/transfer', 'src/package-transfer'] },
  { key: 'operaciones/envios', label: 'Envíos',
    match: ['envios', 'envio', 'shipments', 'shipment'],
    frontend: ['app/operaciones/envios'], backend: ['src/shipments'] },
  { key: 'operaciones/pagos_fedex', label: 'Pagos FedEx',
    match: ['pagos-fedex', 'pagos_fedex', 'pagosfedex', 'fedex'],
    frontend: ['app/operaciones/pagos-fedex'], backend: ['src/shipments'] },

  // ---- Finanzas ----
  { key: 'finanzas/gastos', label: 'Gastos',
    match: ['gastos', 'gasto', 'expenses', 'expense'],
    frontend: ['app/gastos', 'components/gastos'], backend: ['src/expenses', 'src/expense-categories'] },
  { key: 'finanzas/ingresos', label: 'Ingresos',
    match: ['ingresos', 'ingreso', 'income'],
    frontend: ['app/ingresos'], backend: ['src/income'] },
  { key: 'finanzas/reportes', label: 'Reportes',
    match: ['reportes', 'reporte', 'reports', 'resports'],
    frontend: ['app/reportes', 'components/reportes'], backend: ['src/resports'] },

  // ---- Catálogos ----
  { key: 'catalogos/rutas', label: 'Rutas',
    match: ['rutas', 'ruta', 'routes'],
    frontend: ['app/administracion/rutas'], backend: ['src/routes', 'src/routeclosure'] },
  { key: 'catalogos/choferes', label: 'Choferes',
    match: ['choferes', 'chofer', 'drivers', 'driver'],
    frontend: ['app/administracion/choferes'], backend: ['src/drivers'] },
  { key: 'catalogos/vehiculos', label: 'Vehículos',
    match: ['vehiculos', 'vehiculo', 'vehicles', 'vehicle'],
    frontend: ['app/administracion/vehiculos'], backend: ['src/vehicles'] },
  { key: 'catalogos/zonas', label: 'Zonas',
    match: ['zonas', 'zona', 'zone', 'zones'],
    frontend: ['app/administracion/zonas', 'components/zone'], backend: ['src/zone'] },
  { key: 'catalogos/sucursales', label: 'Sucursales',
    match: ['sucursales', 'sucursal', 'subsidiaries', 'subsidiary'],
    frontend: ['app/sucursales', 'components/subsidiary'], backend: ['src/subsidiaries'] },

  // ---- Configuración ----
  { key: 'configuracion/usuarios', label: 'Usuarios',
    match: ['usuarios', 'usuario', 'users', 'user'],
    frontend: ['components/administration'], backend: ['src/users'] },
  { key: 'configuracion/roles', label: 'Roles y permisos',
    match: ['roles', 'rol', 'permisos', 'rbac'],
    frontend: ['components/administration'], backend: ['src/rbac'] },
  { key: 'configuracion/ajustes', label: 'Ajustes / Configuración',
    match: ['ajustes', 'configuracion', 'config', 'company-settings', 'settings'],
    frontend: ['app/configuracion', 'components/configuracion'], backend: ['src/company-settings'] },

  // ---- Soporte (meta) ----
  { key: 'soporte', label: 'Soporte',
    match: ['soporte', 'support', 'ticket', 'tickets'],
    frontend: ['app/support', 'components/support'], backend: ['src/support'] },
];

const strip = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Índice token→entrada (precomputado). */
const INDEX: Map<string, ModuleEntry> = (() => {
  const m = new Map<string, ModuleEntry>();
  for (const entry of MODULE_DIRECTORY) {
    for (const token of entry.match) {
      const k = strip(token);
      if (k.length >= 3 && !m.has(k)) m.set(k, entry);
    }
  }
  return m;
})();

/**
 * Resuelve la entrada del directorio a partir de tokens del ticket (submenú,
 * subsección, segmentos de route, etc.), en orden de prioridad. Devuelve la
 * primera coincidencia o `null`.
 */
export function resolveModule(tokens: (string | null | undefined)[]): ModuleEntry | null {
  for (const raw of tokens) {
    if (!raw) continue;
    const hit = INDEX.get(strip(String(raw)));
    if (hit) return hit;
  }
  return null;
}
