import { ForbiddenException } from '@nestjs/common';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';

/**
 * Reglas de acceso e integridad del desembarque (puras, sin BD, para poder probarlas).
 *
 * Antes cualquier usuario con sesión podía crear/validar/consultar desembarques de cualquier
 * sucursal: el guard de sucursal solo miraba `:subsidiaryId` en la URL y la mayoría de las rutas
 * mandan la sucursal en el cuerpo (o no lo usaban).
 */

/** Roles globales (dueños del sistema): ven todas las sucursales. Igual que SubsidiaryScopeGuard. */
const GLOBAL_ROLES = ['superadmin', 'superamin', 'owner'];

export interface UnloadingUser {
  role?: string | null;
  subsidiaryIds?: string[] | null;
}

export const isGlobalRole = (user: UnloadingUser | null | undefined): boolean =>
  GLOBAL_ROLES.includes(String(user?.role ?? '').toLowerCase());

/** ¿El usuario puede operar en esa sucursal? (las suyas, o todas si es rol global). */
export function canAccessSubsidiary(user: UnloadingUser | null | undefined, subsidiaryId: string | null | undefined): boolean {
  if (!subsidiaryId) return false;
  if (isGlobalRole(user)) return true;
  return Array.isArray(user?.subsidiaryIds) && user!.subsidiaryIds!.includes(subsidiaryId);
}

export function assertSubsidiaryAccess(user: UnloadingUser | null | undefined, subsidiaryId: string | null | undefined): void {
  if (!canAccessSubsidiary(user, subsidiaryId)) {
    throw new ForbiddenException('No tienes permiso para hacer desembarques en esta sucursal.');
  }
}

/**
 * Estatus finales que el desembarque NO debe regresar a "En bodega" (regla 2026-10-06:
 * entregado / devuelto terminan su vida). Devuelve el motivo en lenguaje llano o null.
 */
export function finalStatusReason(status: string | null | undefined): string | null {
  switch (String(status ?? '').toLowerCase()) {
    case ShipmentStatusType.ENTREGADO:
      return 'Ya fue entregada';
    case ShipmentStatusType.DEVUELTO_A_FEDEX:
      return 'Ya se devolvió a FedEx';
    case ShipmentStatusType.RETORNO_ABANDONO_FEDEX:
      return 'Ya regresó a FedEx por abandono';
    default:
      return null;
  }
}

/** Folio de captura que manda el front para no duplicar el desembarque (máx. 64, solo seguro). */
export function normalizeClientRequestId(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  if (v.length > 64 || !/^[A-Za-z0-9_-]+$/.test(v)) return null;
  return v;
}

/** Firma mínima de archivo: los primeros bytes reales (no lo que dice el navegador). */
export const looksLikePdf = (buf: Buffer | undefined | null): boolean =>
  !!buf && buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === '%PDF';

/** XLSX es un ZIP: empieza con "PK\x03\x04". */
export const looksLikeXlsx = (buf: Buffer | undefined | null): boolean =>
  !!buf && buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

/** Nombre de archivo seguro para adjuntos (sin rutas ni caracteres raros). */
export function safeAttachmentName(subsidiaryName: string | null | undefined, ext: 'pdf' | 'xlsx', date = new Date()): string {
  const base = String(subsidiaryName ?? 'Sucursal')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'Sucursal';
  const d = date.toISOString().slice(0, 10);
  return `Desembarque-${base}-${d}.${ext}`;
}
