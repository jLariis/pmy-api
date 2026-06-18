export enum AuditModule {
  AUTH = 'auth',
  USUARIOS = 'usuarios',
  CONSOLIDADOS = 'consolidados',
  DESEMBARQUES = 'desembarques',
  DEVOLUCIONES = 'devoluciones',
  RECOLECCIONES = 'recolecciones',
  SALIDAS_RUTA = 'salidas_ruta',
  GASTOS = 'gastos',
  INGRESOS = 'ingresos',
  SUCURSALES = 'sucursales',
  VEHICULOS = 'vehiculos',
  ZONAS = 'zonas',
  RUTAS = 'rutas',
  CHOFERES = 'choferes',
  BODEGA_ENTRADA = 'bodega_entrada',
  BODEGA_SALIDA = 'bodega_salida',
  RECEPCION_BODEGA = 'recepcion_bodega', // bodega / ocurre
  INVENTARIOS = 'inventarios',
  MONITOREO = 'monitoreo',
  TRASLADOS = 'traslados',
  ENVIOS = 'envios',
  CIERRE_RUTA = 'cierre_ruta',
  REPORTES = 'reportes',
  AUDITORIA = 'auditoria',
  OTRO = 'otro',
}

export enum AuditAction {
  LOGIN = 'login',
  LOGOUT = 'logout',
  LOGIN_FAILED = 'login_failed',
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  EXPORT = 'export',
  IMPORT = 'import',
  VALIDATE = 'validate',
  STATUS_CHANGE = 'status_change',
  ASSIGN = 'assign',
  TRANSFER = 'transfer',
  PRINT = 'print',
  OTHER = 'other',
}

export enum AuditResult {
  SUCCESS = 'success',
  ERROR = 'error',
}

export enum AuditSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}
