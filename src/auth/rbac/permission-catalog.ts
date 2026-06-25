/**
 * Catálogo inicial de RBAC, DERIVADO de `app-pmy/lib/access/allowed-page-roles.ts`
 * (acceso por página). Fuente única para el seed (migración) y para validaciones.
 * Cada permiso lista los roles que lo reciben por defecto. Roles canónicos =
 * los del frontend `UserRoleEnum`: superadmin, admin, subadmin, auxiliar, user, bodega.
 *
 * NOTA: el código (`code`) es el identificador estable usado en guards y front
 * (ej. 'finanzas.gastos'). Mantenerlo en sincronía con las rutas/páginas.
 */

export type RoleKey = 'superadmin' | 'admin' | 'subadmin' | 'auxiliar' | 'user' | 'bodega';

export const RBAC_ROLES: { key: RoleKey; name: string; description: string; isSystem: boolean }[] = [
  { key: 'superadmin', name: 'Superadministrador', description: 'Acceso total al sistema.', isSystem: true },
  { key: 'admin', name: 'Administrador', description: 'Administración general.', isSystem: true },
  { key: 'subadmin', name: 'Subadministrador', description: 'Administración acotada.', isSystem: true },
  { key: 'auxiliar', name: 'Auxiliar', description: 'Apoyo operativo y financiero.', isSystem: true },
  { key: 'bodega', name: 'Bodega', description: 'Operación de almacén.', isSystem: true },
  { key: 'user', name: 'Usuario', description: 'Operación básica.', isSystem: true },
];

/** Mapeo histórico de strings de `user.role` (incluye typos) → key canónica. */
export const LEGACY_ROLE_MAP: Record<string, RoleKey> = {
  superadmin: 'superadmin',
  superamin: 'superadmin', // typo histórico
  admin: 'admin',
  subadmin: 'subadmin',
  auxiliar: 'auxiliar',
  bodega: 'bodega',
  user: 'user',
  owner: 'superadmin', // 'owner' del enum backend → superadmin
};

export interface RbacPermissionDef {
  code: string;
  name: string;
  groupName: string;
  roles: RoleKey[];
}

const ALL_ADMIN: RoleKey[] = ['admin', 'superadmin', 'subadmin'];
const OPERATIVE: RoleKey[] = ['admin', 'subadmin', 'superadmin', 'user', 'bodega', 'auxiliar'];

export const RBAC_PERMISSIONS: RbacPermissionDef[] = [
  // Administración
  { code: 'administracion.vehiculos', name: 'Vehículos', groupName: 'Administración', roles: ALL_ADMIN },
  { code: 'administracion.rutas', name: 'Rutas', groupName: 'Administración', roles: ALL_ADMIN },
  { code: 'administracion.choferes', name: 'Choferes', groupName: 'Administración', roles: ALL_ADMIN },
  { code: 'administracion.sucursales', name: 'Sucursales', groupName: 'Administración', roles: ALL_ADMIN },
  { code: 'administracion.zonas', name: 'Zonas', groupName: 'Administración', roles: ALL_ADMIN },
  // Generales
  { code: 'dashboard', name: 'Dashboard', groupName: 'General', roles: ['admin', 'subadmin', 'superadmin', 'auxiliar', 'user', 'bodega'] },
  { code: 'reportes', name: 'Reportes', groupName: 'General', roles: ['admin', 'subadmin', 'superadmin', 'user'] },
  // Bodega
  { code: 'bodega.consolidados', name: 'Consolidados', groupName: 'Bodega', roles: OPERATIVE },
  { code: 'bodega.entrada', name: 'Entrada', groupName: 'Bodega', roles: ALL_ADMIN },
  { code: 'bodega.inventarios', name: 'Inventarios', groupName: 'Bodega', roles: OPERATIVE },
  { code: 'bodega.recepcionBodega', name: 'Recepción en Bodega', groupName: 'Bodega', roles: OPERATIVE },
  { code: 'bodega.salida', name: 'Salida', groupName: 'Bodega', roles: ALL_ADMIN },
  // Operaciones
  { code: 'operaciones.cargas', name: 'Cargas', groupName: 'Operaciones', roles: OPERATIVE },
  { code: 'operaciones.desembarques', name: 'Desembarques', groupName: 'Operaciones', roles: OPERATIVE },
  { code: 'operaciones.devoluciones', name: 'Devoluciones', groupName: 'Operaciones', roles: OPERATIVE },
  { code: 'operaciones.envios', name: 'Envíos', groupName: 'Operaciones', roles: OPERATIVE },
  { code: 'operaciones.monitoreo', name: 'Monitoreo', groupName: 'Operaciones', roles: OPERATIVE },
  { code: 'operaciones.pagosFedex', name: 'Pagos a FedEx', groupName: 'Operaciones', roles: OPERATIVE },
  { code: 'operaciones.traslados', name: 'Traslados', groupName: 'Operaciones', roles: OPERATIVE },
  { code: 'operaciones.salidasARutas', name: 'Salidas a Rutas', groupName: 'Operaciones', roles: OPERATIVE },
  // Finanzas
  { code: 'finanzas.gastos', name: 'Gastos', groupName: 'Finanzas', roles: ['admin', 'subadmin', 'superadmin', 'auxiliar'] },
  { code: 'finanzas.ingresos', name: 'Ingresos', groupName: 'Finanzas', roles: ['admin', 'subadmin', 'superadmin', 'auxiliar'] },
  { code: 'finanzas.nominas', name: 'Nómina', groupName: 'Finanzas', roles: ['admin', 'subadmin', 'superadmin'] },
  // Mtto. Vehículos
  { code: 'mttoVehiculos.programacion', name: 'Programación Mtto.', groupName: 'Mtto. Vehículos', roles: ['admin', 'superadmin'] },
  { code: 'mttoVehiculos.historial', name: 'Historial Mtto.', groupName: 'Mtto. Vehículos', roles: ['admin', 'superadmin'] },
  // Sistema
  { code: 'configuracion', name: 'Configuración (acceso)', groupName: 'Sistema', roles: ['superadmin'] },
  { code: 'configuracion.empresa', name: 'Configuración · Empresa', groupName: 'Sistema', roles: ['superadmin'] },
  { code: 'configuracion.usuarios', name: 'Configuración · Usuarios', groupName: 'Sistema', roles: ['superadmin'] },
  { code: 'configuracion.roles', name: 'Configuración · Roles y Permisos', groupName: 'Sistema', roles: ['superadmin'] },
  { code: 'configuracion.sucursales', name: 'Configuración · Sucursales (operativa)', groupName: 'Sistema', roles: ['superadmin'] },
  { code: 'auditoria', name: 'Auditoría', groupName: 'Sistema', roles: ['superadmin'] },
  // Reportes (acceso POR reporte; el code = id del reporte en report-registry).
  // Default = mismos roles que la página Reportes; el superadmin restringe por rol.
  { code: 'reportes.pendientes', name: 'Reporte: Pendientes', groupName: 'Reportes', roles: ['admin', 'subadmin', 'superadmin', 'user'] },
  { code: 'reportes.recibidas67', name: 'Reporte: Recibidas de FedEx (67)', groupName: 'Reportes', roles: ['admin', 'subadmin', 'superadmin', 'user'] },
  { code: 'reportes.visibilidad67', name: 'Reporte: Visibilidad 67', groupName: 'Reportes', roles: ['admin', 'subadmin', 'superadmin', 'user'] },
  { code: 'reportes.inventarios', name: 'Reporte: Inventarios', groupName: 'Reportes', roles: ['admin', 'subadmin', 'superadmin', 'user'] },
  { code: 'reportes.desembarques', name: 'Reporte: Desembarques', groupName: 'Reportes', roles: ['admin', 'subadmin', 'superadmin', 'user'] },
  { code: 'reportes.inventario67', name: 'Reporte: Último inventario sin 67', groupName: 'Reportes', roles: ['admin', 'subadmin', 'superadmin', 'user'] },
];
