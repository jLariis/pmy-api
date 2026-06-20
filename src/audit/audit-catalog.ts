import { AuditAction, AuditModule } from 'src/common/enums/audit.enum';

/**
 * Catálogo central de auditoría.
 *
 * Objetivo: que cada evento diga EN LENGUAJE DE NEGOCIO qué hizo el usuario
 * ("Registró salida a ruta R-1234 · 18 paquetes", "Validó 30 trackings · 28 ok,
 * 2 con problema") en lugar de "create on package-dispatchs". También resuelve
 * el MÓDULO correcto a partir de la ruta, para que las gráficas no caigan todas
 * en "otro".
 *
 * Se evalúa en el interceptor sobre CADA mutación; por eso todo va envuelto en
 * defensivo (un error aquí NUNCA debe romper la petición del usuario).
 */

export interface AuditDescribeCtx {
  method: string;
  /** Path normalizado: sin /api, sin query y sin slash final. */
  path: string;
  params: any;
  query: any;
  body: any;
  response: any;
  result: 'success' | 'error';
  error?: any;
}

export interface AuditResolved {
  module: AuditModule;
  action?: AuditAction;
  entityName?: string;
  description?: string;
  details?: Record<string, any>;
}

// ----------------------------- helpers -----------------------------

const len = (v: any): number => (Array.isArray(v) ? v.length : 0);
const has = (v: any): boolean => v !== undefined && v !== null && v !== '';
const clip = (s: string, max = 480): string => (s.length > max ? s.slice(0, max - 1) + '…' : s);

/** Nombre legible de una entidad relacionada (chofer, vehículo, ruta, sucursal). */
const label = (o: any): string | undefined => {
  if (!o || typeof o !== 'object') return undefined;
  return o.name || o.fullName || o.plates || o.plate || o.code || o.consNumber || undefined;
};

const first = (v: any): any => (Array.isArray(v) ? v[0] : v);

/** Cuenta válidos / inválidos en una respuesta de validación de trackings. */
const tallyValidation = (rows: any[]): { ok: number; bad: number; reasons: string[] } => {
  const list = Array.isArray(rows) ? rows : [];
  let ok = 0;
  let bad = 0;
  const reasons: string[] = [];
  for (const r of list) {
    if (r && r.isValid === false) {
      bad++;
      const tn = r.trackingNumber ? `${r.trackingNumber}` : 's/guía';
      reasons.push(r.reason ? `${tn}: ${r.reason}` : tn);
    } else {
      ok++;
    }
  }
  return { ok, bad, reasons: reasons.slice(0, 10) };
};

const plural = (n: number, singular: string, plural?: string): string =>
  `${n} ${n === 1 ? singular : plural ?? singular + 's'}`;

// ----------------------------- módulos por prefijo -----------------------------

const PREFIX_MODULE: Record<string, AuditModule> = {
  auth: AuditModule.AUTH,
  users: AuditModule.USUARIOS,
  consolidated: AuditModule.CONSOLIDADOS,
  unloadings: AuditModule.DESEMBARQUES,
  devolutions: AuditModule.DEVOLUCIONES,
  collections: AuditModule.RECOLECCIONES,
  'package-dispatchs': AuditModule.SALIDAS_RUTA,
  expenses: AuditModule.GASTOS,
  incomes: AuditModule.INGRESOS,
  subsidiaries: AuditModule.SUCURSALES,
  vehicles: AuditModule.VEHICULOS,
  zone: AuditModule.ZONAS,
  routes: AuditModule.RUTAS,
  drivers: AuditModule.CHOFERES,
  warehouse: AuditModule.BODEGA_ENTRADA,
  inventories: AuditModule.INVENTARIOS,
  monitoring: AuditModule.MONITOREO,
  dashboard: AuditModule.MONITOREO,
  transfers: AuditModule.TRASLADOS,
  'package-transfers': AuditModule.TRASLADOS,
  'pick-up': AuditModule.RECEPCION_BODEGA,
  'route-closure': AuditModule.CIERRE_RUTA,
  shipments: AuditModule.ENVIOS,
  reports: AuditModule.REPORTES,
  audit: AuditModule.AUDITORIA,
  notifications: AuditModule.OTRO,
};

const moduleFromPath = (path: string): AuditModule => {
  const seg = path.replace(/^\//, '').split('/')[0] || '';
  return PREFIX_MODULE[seg] ?? AuditModule.OTRO;
};

// ----------------------------- reglas específicas -----------------------------

type Rule = {
  test: (m: string, p: string) => boolean;
  module?: AuditModule;
  action?: AuditAction;
  entityName?: string;
  describe: (ctx: AuditDescribeCtx) => { message: string; details?: Record<string, any> };
};

const eq = (method: string, path: string) => (m: string, p: string) => m === method && p === path;
const pre = (method: string, prefix: string) => (m: string, p: string) =>
  m === method && (p === prefix || p.startsWith(prefix + '/'));

const RULES: Rule[] = [
  // ------------------ AUTH ------------------
  {
    test: eq('POST', '/auth/token'),
    module: AuditModule.AUTH,
    action: AuditAction.LOGIN,
    entityName: 'Sesión',
    describe: () => ({ message: 'Inició sesión' }),
  },
  {
    test: eq('POST', '/auth/logout'),
    module: AuditModule.AUTH,
    action: AuditAction.LOGOUT,
    entityName: 'Sesión',
    describe: () => ({ message: 'Cerró sesión' }),
  },
  {
    test: eq('POST', '/auth/recover'),
    module: AuditModule.AUTH,
    describe: () => ({ message: 'Solicitó recuperación de contraseña' }),
  },
  {
    test: eq('POST', '/auth/reset-password'),
    module: AuditModule.AUTH,
    describe: () => ({ message: 'Restableció su contraseña' }),
  },

  // ------------------ SALIDAS A RUTA ------------------
  {
    test: eq('POST', '/package-dispatchs'),
    module: AuditModule.SALIDAS_RUTA,
    action: AuditAction.CREATE,
    entityName: 'Salida a ruta',
    describe: ({ body, response }) => {
      const paquetes = len(body?.shipments);
      const folio = response?.trackingNumber || response?.id;
      const chofer = label(first(body?.drivers));
      const vehiculo = label(body?.vehicle);
      const ruta = label(first(body?.routes));
      const parts = [`Creó salida a ruta${folio ? ` ${folio}` : ''}`, plural(paquetes, 'paquete')];
      if (ruta) parts.push(`ruta ${ruta}`);
      if (chofer) parts.push(`chofer ${chofer}`);
      if (vehiculo) parts.push(`unidad ${vehiculo}`);
      return {
        message: parts.join(' · '),
        details: { paquetes, folio, ruta, chofer, vehiculo, kms: body?.kms },
      };
    },
  },
  {
    test: pre('PATCH', '/package-dispatchs'),
    module: AuditModule.SALIDAS_RUTA,
    action: AuditAction.UPDATE,
    entityName: 'Salida a ruta',
    describe: ({ params }) => ({ message: `Actualizó la salida a ruta ${params?.id ?? ''}`.trim() }),
  },
  {
    test: pre('DELETE', '/package-dispatchs'),
    module: AuditModule.SALIDAS_RUTA,
    action: AuditAction.DELETE,
    entityName: 'Salida a ruta',
    describe: ({ params }) => ({ message: `Eliminó la salida a ruta ${params?.id ?? ''}`.trim() }),
  },
  {
    test: eq('POST', '/package-dispatchs/upload'),
    module: AuditModule.SALIDAS_RUTA,
    action: AuditAction.PRINT,
    entityName: 'Salida a ruta',
    describe: () => ({ message: 'Envió por correo la salida a ruta (PDF/Excel)' }),
  },

  // ------------------ DESEMBARQUES ------------------
  {
    test: eq('POST', '/unloadings'),
    module: AuditModule.DESEMBARQUES,
    action: AuditAction.CREATE,
    entityName: 'Desembarque',
    describe: ({ body, response }) => {
      const escaneados = len(body?.shipments);
      const faltantes = len(body?.missingTrackings);
      const noEscaneados = len(body?.unScannedTrackings);
      const parts = [`Registró desembarque`, plural(escaneados, 'paquete escaneado', 'paquetes escaneados')];
      if (faltantes) parts.push(`${faltantes} faltante${faltantes === 1 ? '' : 's'}`);
      if (noEscaneados) parts.push(`${noEscaneados} no escaneado${noEscaneados === 1 ? '' : 's'}`);
      return {
        message: parts.join(' · '),
        details: { escaneados, faltantes, noEscaneados, folio: response?.trackingNumber ?? response?.id },
      };
    },
  },
  {
    test: eq('POST', '/unloadings/validate-tracking-numbers'),
    module: AuditModule.DESEMBARQUES,
    action: AuditAction.VALIDATE,
    entityName: 'Desembarque',
    describe: ({ body, response }) => {
      const total = len(body?.trackingNumbers);
      const { ok, bad, reasons } = tallyValidation(response?.validatedShipments);
      return {
        message: `Validó ${plural(total, 'tracking')} para desembarque · ${ok} ok, ${bad} con problema`,
        details: { total, validos: ok, conProblema: bad, motivos: reasons },
      };
    },
  },

  // ------------------ INVENTARIOS ------------------
  {
    test: eq('POST', '/inventories'),
    module: AuditModule.INVENTARIOS,
    action: AuditAction.CREATE,
    entityName: 'Inventario',
    describe: ({ body, response }) => {
      const escaneados = len(body?.shipments);
      const faltantes = len(body?.missingTrackings);
      return {
        message: `Registró inventario · ${plural(escaneados, 'paquete')}${faltantes ? ` · ${faltantes} faltantes` : ''}`,
        details: { escaneados, faltantes, folio: response?.trackingNumber ?? response?.id },
      };
    },
  },
  {
    test: eq('POST', '/inventories/validate-tracking-numbers'),
    module: AuditModule.INVENTARIOS,
    action: AuditAction.VALIDATE,
    entityName: 'Inventario',
    describe: ({ body, response }) => {
      const total = len(body?.trackingNumbers);
      const { ok, bad, reasons } = tallyValidation(response?.validatedShipments);
      return {
        message: `Validó ${plural(total, 'tracking')} para inventario · ${ok} ok, ${bad} con problema`,
        details: { total, validos: ok, conProblema: bad, motivos: reasons },
      };
    },
  },

  // ------------------ CONSOLIDADOS ------------------
  {
    test: eq('POST', '/consolidated'),
    module: AuditModule.CONSOLIDADOS,
    action: AuditAction.CREATE,
    entityName: 'Consolidado',
    describe: ({ body }) => {
      const cons = body?.consNumber;
      const paquetes = body?.numberOfPackages;
      const tipo = body?.type;
      return {
        message: `Registró consolidado${cons ? ` ${cons}` : ''}${has(paquetes) ? ` · ${plural(Number(paquetes), 'paquete')}` : ''}${tipo ? ` (${tipo})` : ''}`,
        details: { consNumber: cons, paquetes, tipo, eficiencia: body?.efficiency },
      };
    },
  },
  {
    test: pre('PATCH', '/consolidated'),
    module: AuditModule.CONSOLIDADOS,
    action: AuditAction.UPDATE,
    entityName: 'Consolidado',
    describe: ({ params }) => ({ message: `Actualizó el consolidado ${params?.id ?? ''}`.trim() }),
  },
  {
    test: pre('DELETE', '/consolidated'),
    module: AuditModule.CONSOLIDADOS,
    action: AuditAction.DELETE,
    entityName: 'Consolidado',
    describe: ({ params }) => ({ message: `Eliminó el consolidado ${params?.id ?? ''}`.trim() }),
  },

  // ------------------ DEVOLUCIONES ------------------
  {
    test: eq('POST', '/devolutions'),
    module: AuditModule.DEVOLUCIONES,
    action: AuditAction.CREATE,
    entityName: 'Devolución',
    describe: ({ body }) => {
      const list = Array.isArray(body) ? body : [body];
      const n = list.filter(Boolean).length;
      const tns = list.map((d) => d?.trackingNumber).filter(Boolean).slice(0, 10);
      return {
        message: n === 1 && tns[0]
          ? `Registró devolución de la guía ${tns[0]}`
          : `Registró ${plural(n, 'devolución', 'devoluciones')}`,
        details: { cantidad: n, guias: tns },
      };
    },
  },

  // ------------------ RECOLECCIONES ------------------
  {
    test: eq('POST', '/collections'),
    module: AuditModule.RECOLECCIONES,
    action: AuditAction.CREATE,
    entityName: 'Recolección',
    describe: ({ body }) => {
      const n = len(body) || (body ? 1 : 0);
      return { message: `Registró ${plural(n, 'recolección', 'recolecciones')}`, details: { cantidad: n } };
    },
  },

  // ------------------ CIERRE DE RUTA ------------------
  {
    test: eq('POST', '/route-closure'),
    module: AuditModule.CIERRE_RUTA,
    action: AuditAction.CREATE,
    entityName: 'Cierre de ruta',
    describe: ({ response }) => ({
      message: 'Registró un cierre de ruta',
      details: { folio: response?.trackingNumber ?? response?.id },
    }),
  },
  {
    test: eq('POST', '/route-closure/validateTrackingsForClosure'),
    module: AuditModule.CIERRE_RUTA,
    action: AuditAction.VALIDATE,
    entityName: 'Cierre de ruta',
    describe: ({ body, response }) => {
      const total = len(body?.trackingNumbers) || len(body?.trackings);
      const rows = Array.isArray(response) ? response : response?.validatedShipments ?? response?.results;
      const { ok, bad, reasons } = tallyValidation(rows);
      return {
        message: `Validó trackings para cierre de ruta · ${ok} ok, ${bad} con problema`,
        details: { total, validos: ok, conProblema: bad, motivos: reasons },
      };
    },
  },
  {
    test: eq('POST', '/route-closure/validateNoVanTrackings'),
    module: AuditModule.CIERRE_RUTA,
    action: AuditAction.VALIDATE,
    entityName: 'Cierre de ruta',
    describe: ({ body }) => {
      const total = len(body?.noVanTrackingNumbers);
      return { message: `Validó ${plural(total, 'tracking')} sin van para cierre de ruta`, details: { total } };
    },
  },

  // ------------------ TRASLADOS ------------------
  {
    test: eq('POST', '/transfers'),
    module: AuditModule.TRASLADOS,
    action: AuditAction.CREATE,
    entityName: 'Traslado',
    describe: ({ body }) => ({
      message: `Registró traslado${body?.transferType ? ` (${body.transferType})` : ''}${has(body?.totalAmount) ? ` · $${body.totalAmount}` : ''}`,
      details: { tipo: body?.transferType, monto: body?.totalAmount, choferes: len(body?.driverIds) },
    }),
  },
  {
    test: eq('POST', '/package-transfers'),
    module: AuditModule.TRASLADOS,
    action: AuditAction.TRANSFER,
    entityName: 'Traspaso de paquete',
    describe: ({ body }) => ({
      message: `Traspasó el paquete ${body?.trackingNumber ?? ''} a otra sucursal${body?.reason ? ` (${body.reason})` : ''}`.trim(),
      details: { guia: body?.trackingNumber, destino: body?.destinationId, origen: body?.source, motivo: body?.reason },
    }),
  },

  // ------------------ BODEGA / OCURRE ------------------
  {
    test: eq('POST', '/pick-up/save'),
    module: AuditModule.RECEPCION_BODEGA,
    action: AuditAction.CREATE,
    entityName: 'Recepción en bodega',
    describe: ({ body }) => {
      const items = Array.isArray(body?.items) ? body.items : [];
      const ocurre = items.filter((i: any) => i?.type === 'ocurre').length;
      const entrega = items.filter((i: any) => i?.type === 'entrega_bodega').length;
      const parts = [`Registró ${plural(items.length, 'paquete')} en bodega`];
      if (ocurre) parts.push(`${ocurre} ocurre`);
      if (entrega) parts.push(`${entrega} entrega en bodega`);
      return { message: parts.join(' · '), details: { total: items.length, ocurre, entrega } };
    },
  },
  {
    test: eq('POST', '/warehouse'),
    module: AuditModule.BODEGA_ENTRADA,
    action: AuditAction.CREATE,
    entityName: 'Entrada a bodega',
    describe: ({ body }) => ({
      message: `Registró entrada a bodega · ${plural(len(body?.shipments), 'paquete')}`,
      details: { paquetes: len(body?.shipments) },
    }),
  },
  {
    test: eq('POST', '/warehouse/outbound'),
    module: AuditModule.BODEGA_SALIDA,
    action: AuditAction.CREATE,
    entityName: 'Salida de bodega',
    describe: ({ body }) => ({
      message: `Registró salida de bodega${body?.type ? ` (${body.type})` : ''} · ${plural(len(body?.shipments), 'paquete')}`,
      details: { paquetes: len(body?.shipments), tipo: body?.type },
    }),
  },
  {
    test: eq('POST', '/warehouse/notification'),
    module: AuditModule.BODEGA_ENTRADA,
    action: AuditAction.PRINT,
    entityName: 'Bodega',
    describe: ({ body }) => ({ message: `Envió notificación de bodega por correo${body?.type ? ` (${body.type})` : ''}` }),
  },

  // ------------------ ENVÍOS ------------------
  {
    test: eq('POST', '/shipments/upload'),
    module: AuditModule.ENVIOS,
    action: AuditAction.IMPORT,
    entityName: 'Envíos',
    describe: () => ({ message: 'Importó archivo de envíos (Excel)' }),
  },
  {
    test: eq('POST', '/shipments/upload-charge'),
    module: AuditModule.ENVIOS,
    action: AuditAction.IMPORT,
    entityName: 'Envíos',
    describe: () => ({ message: 'Importó archivo de cargas / F2 (Excel)' }),
  },
  {
    test: eq('POST', '/shipments/upload-payment'),
    module: AuditModule.ENVIOS,
    action: AuditAction.IMPORT,
    entityName: 'Envíos',
    describe: () => ({ message: 'Importó archivo de cobros (Excel)' }),
  },
  {
    test: eq('POST', '/shipments/upload-hv'),
    module: AuditModule.ENVIOS,
    action: AuditAction.IMPORT,
    entityName: 'Envíos',
    describe: () => ({ message: 'Importó archivo de High Values (Excel)' }),
  },
  {
    test: (m, p) => m === 'POST' && (p === '/shipments/upload-dhl' || p === '/shipments/process-dhl-txt-file'),
    module: AuditModule.ENVIOS,
    action: AuditAction.IMPORT,
    entityName: 'Envíos',
    describe: () => ({ message: 'Importó archivo de envíos DHL' }),
  },
  {
    test: eq('POST', '/shipments/add-shipment'),
    module: AuditModule.ENVIOS,
    action: AuditAction.CREATE,
    entityName: 'Envío',
    describe: ({ body, response }) => ({
      message: `Agregó un envío manual${body?.trackingNumber ? ` (${body.trackingNumber})` : ''}`,
      details: { guia: body?.trackingNumber ?? response?.trackingNumber },
    }),
  },
  {
    test: eq('POST', '/shipments/remove-for-pick-up'),
    module: AuditModule.ENVIOS,
    action: AuditAction.STATUS_CHANGE,
    entityName: 'Envío',
    describe: ({ body }) => ({ message: `Movió ${plural(len(body), 'envío')} a recolección`, details: { cantidad: len(body) } }),
  },
  {
    test: pre('POST', '/shipments/dispatch/sync-status'),
    module: AuditModule.ENVIOS,
    action: AuditAction.STATUS_CHANGE,
    entityName: 'Envío',
    describe: ({ params }) => ({ message: `Sincronizó el estatus del envío ${params?.trackingNumber ?? ''}`.trim() }),
  },
  {
    test: eq('POST', '/shipments/audit-universal'),
    module: AuditModule.ENVIOS,
    action: AuditAction.VALIDATE,
    entityName: 'Envío',
    describe: () => ({ message: 'Ejecutó auditoría forense universal de envíos' }),
  },
  {
    test: (m, p) => m === 'POST' && (p === '/shipments/fedex-direct' || p === '/shipments/check-44-status' || p === '/shipments/test-check-status' || p === '/shipments/validate-tracking'),
    module: AuditModule.ENVIOS,
    action: AuditAction.VALIDATE,
    entityName: 'Envío',
    describe: ({ body }) => {
      const n = len(body?.trackingNumbers);
      return { message: `Consultó estatus en paquetería${n ? ` de ${plural(n, 'guía')}` : ''}`, details: { cantidad: n } };
    },
  },

  // ------------------ USUARIOS ------------------
  {
    test: eq('POST', '/users/register'),
    module: AuditModule.USUARIOS,
    action: AuditAction.CREATE,
    entityName: 'Usuario',
    describe: ({ body, response }) => {
      const name = [body?.name, body?.lastName].filter(Boolean).join(' ') || body?.email || response?.email;
      return { message: `Registró el usuario ${name ?? ''}`.trim(), details: { email: body?.email, rol: body?.role } };
    },
  },
  {
    test: pre('PATCH', '/users'),
    module: AuditModule.USUARIOS,
    action: AuditAction.UPDATE,
    entityName: 'Usuario',
    describe: ({ params }) => ({ message: `Actualizó el usuario ${params?.id ?? ''}`.trim() }),
  },
  {
    test: pre('DELETE', '/users'),
    module: AuditModule.USUARIOS,
    action: AuditAction.DELETE,
    entityName: 'Usuario',
    describe: ({ params }) => ({ message: `Eliminó el usuario ${params?.id ?? ''}`.trim() }),
  },

  // ------------------ CATÁLOGOS (rutas, choferes, vehículos, zonas, sucursales) ------------------
  {
    test: eq('POST', '/routes'),
    module: AuditModule.RUTAS,
    action: AuditAction.CREATE,
    entityName: 'Ruta',
    describe: ({ body }) => ({ message: `Creó la ruta ${body?.name ?? ''}`.trim(), details: { nombre: body?.name, code: body?.code } }),
  },
  {
    test: eq('POST', '/drivers'),
    module: AuditModule.CHOFERES,
    action: AuditAction.CREATE,
    entityName: 'Chofer',
    describe: ({ body }) => ({ message: `Registró el chofer ${label(body) ?? ''}`.trim() }),
  },
  {
    test: eq('POST', '/vehicles'),
    module: AuditModule.VEHICULOS,
    action: AuditAction.CREATE,
    entityName: 'Vehículo',
    describe: ({ body }) => ({ message: `Registró el vehículo ${label(body) ?? ''}`.trim() }),
  },
  {
    test: eq('POST', '/zone'),
    module: AuditModule.ZONAS,
    action: AuditAction.CREATE,
    entityName: 'Zona',
    describe: ({ body }) => ({ message: `Creó la zona ${label(body) ?? ''}`.trim() }),
  },
  {
    test: eq('POST', '/subsidiaries'),
    module: AuditModule.SUCURSALES,
    action: AuditAction.CREATE,
    entityName: 'Sucursal',
    describe: ({ body }) => ({ message: `Creó la sucursal ${label(body) ?? ''}`.trim() }),
  },

  // ------------------ GASTOS / INGRESOS ------------------
  {
    test: eq('POST', '/expenses'),
    module: AuditModule.GASTOS,
    action: AuditAction.CREATE,
    entityName: 'Gasto',
    describe: ({ body }) => {
      const cat = body?.category;
      return {
        message: `Registró un gasto${cat ? ` de ${cat}` : ''}${has(body?.amount) ? ` por $${body.amount}` : ''}`,
        details: { categoria: cat, monto: body?.amount, concepto: body?.description },
      };
    },
  },
  {
    test: pre('PATCH', '/expenses'),
    module: AuditModule.GASTOS,
    action: AuditAction.UPDATE,
    entityName: 'Gasto',
    describe: ({ params, body }) => ({
      message: `Actualizó un gasto${has(body?.amount) ? ` (ahora $${body.amount})` : ''}`,
      details: { id: params?.id, categoria: body?.category, monto: body?.amount },
    }),
  },
  {
    test: pre('DELETE', '/expenses'),
    module: AuditModule.GASTOS,
    action: AuditAction.DELETE,
    entityName: 'Gasto',
    describe: ({ params }) => ({ message: `Eliminó un gasto ${params?.id ?? ''}`.trim() }),
  },
  {
    test: eq('POST', '/incomes'),
    module: AuditModule.INGRESOS,
    action: AuditAction.CREATE,
    entityName: 'Ingreso',
    describe: ({ body }) => ({ message: `Registró un ingreso${has(body?.amount) ? ` por $${body.amount}` : ''}`, details: { monto: body?.amount } }),
  },
];

// ----------------------------- API pública -----------------------------

const VERB: Record<string, string> = {
  POST: 'Creó',
  PUT: 'Actualizó',
  PATCH: 'Actualizó',
  DELETE: 'Eliminó',
  GET: 'Consultó',
};

const MODULE_LABEL: Partial<Record<AuditModule, string>> = {
  [AuditModule.SALIDAS_RUTA]: 'salida a ruta',
  [AuditModule.DESEMBARQUES]: 'desembarque',
  [AuditModule.INVENTARIOS]: 'inventario',
  [AuditModule.CONSOLIDADOS]: 'consolidado',
  [AuditModule.DEVOLUCIONES]: 'devolución',
  [AuditModule.RECOLECCIONES]: 'recolección',
  [AuditModule.CIERRE_RUTA]: 'cierre de ruta',
  [AuditModule.TRASLADOS]: 'traslado',
  [AuditModule.RECEPCION_BODEGA]: 'recepción en bodega',
  [AuditModule.BODEGA_ENTRADA]: 'movimiento de bodega',
  [AuditModule.ENVIOS]: 'envío',
  [AuditModule.RUTAS]: 'ruta',
  [AuditModule.CHOFERES]: 'chofer',
  [AuditModule.VEHICULOS]: 'vehículo',
  [AuditModule.ZONAS]: 'zona',
  [AuditModule.SUCURSALES]: 'sucursal',
  [AuditModule.USUARIOS]: 'usuario',
  [AuditModule.GASTOS]: 'gasto',
  [AuditModule.INGRESOS]: 'ingreso',
};

/** Quita /api, query y slash final para igualar las reglas. */
export function normalizeAuditPath(p?: string): string {
  if (!p) return '';
  return p.split('?')[0].replace(/^\/api/, '').replace(/\/+$/, '') || '/';
}

/**
 * Resuelve módulo + acción + descripción legible de un evento.
 * Defensivo: cualquier excepción degrada a una descripción genérica.
 */
export function resolveAudit(ctx: AuditDescribeCtx): AuditResolved {
  const module = moduleFromPath(ctx.path);
  try {
    const rule = RULES.find((r) => r.test(ctx.method, ctx.path));
    if (rule) {
      const { message, details } = rule.describe(ctx);
      const desc = ctx.result === 'error' ? `Intentó: ${message}` : message;
      return {
        module: rule.module ?? module,
        action: rule.action,
        entityName: rule.entityName,
        description: clip(desc),
        details,
      };
    }
  } catch {
    /* cae al genérico */
  }

  // Genérico: "Creó registro en <módulo>" usando el verbo del método.
  const verb = VERB[ctx.method] ?? 'Ejecutó acción en';
  const lbl = MODULE_LABEL[module] ?? module.replace(/_/g, ' ');
  const id = ctx.params?.id || ctx.params?.trackingNumber;
  const base = `${verb} ${lbl}${id ? ` ${id}` : ''}`;
  return { module, description: clip(ctx.result === 'error' ? `Intentó: ${base}` : base) };
}
