/**
 * Desde DÓNDE se subió un archivo (Importaciones, archivos del consolidado y la campana). Nombres
 * en lenguaje de la pantalla que usó la persona; nunca nombres internos (processFileF2, addCharge…).
 * El front manda la clave; lo que no está en la lista se guarda como null ("sin dato").
 */
export const UPLOAD_METHODS = {
  asistente: 'Asistente de subida (paso a paso)',
  pegar_fedex: 'Pegar desde FedEx',
  bandeja_correo: 'Desde la bandeja de correos',
  subida_rapida: 'Subida rápida de Excel',
} as const;

export type UploadMethod = keyof typeof UPLOAD_METHODS;

export function normalizeUploadMethod(raw: unknown): UploadMethod | null {
  const key = String(raw ?? '').trim().toLowerCase();
  return key in UPLOAD_METHODS ? (key as UploadMethod) : null;
}

/** "Asistente de subida (paso a paso) · F2 directo como carga…" / "Sin dato del método". */
export function uploadMethodLabel(method: string | null | undefined, detail?: string | null): string {
  const base = method && method in UPLOAD_METHODS ? UPLOAD_METHODS[method as UploadMethod] : 'Sin dato del método';
  return detail ? `${base} · ${detail}` : base;
}

/** Modo de la F2 en palabras de la pantalla (switch "Guardar F2 directo" / "Migrar"). */
export function f2ModeDetail(directo: boolean): string {
  return directo
    ? 'F2 directo como carga (sin quitar de paquetes)'
    : 'F2 quitando del master los paquetes del mismo consolidado';
}

/**
 * Guías guardadas por una subida F2, para la columna "Guías" de Importaciones. Antes se leía
 * `result.saved`, que la F2 no regresa, y siempre quedaba vacío.
 */
export function f2SavedCount(result: any): number | null {
  if (result?.summary) return Number(result.summary.insertedNew ?? 0) + Number(result.summary.migrated ?? 0);
  if (Array.isArray(result?.savedChargeShipments)) return result.savedChargeShipments.length;
  return null;
}
