import { SetMetadata } from '@nestjs/common';
import { AuditAction, AuditModule } from 'src/common/enums/audit.enum';

export const AUDIT_KEY = 'audit_meta';

export interface AuditMeta {
  module: AuditModule;
  /** Si se omite, se infiere del método HTTP (POST→create, etc.). */
  action?: AuditAction;
  entityName?: string;
  /** Si true, no se guarda el body de la petición (datos sensibles / archivos). */
  skipBody?: boolean;
  /** Resuelve el id del registro afectado desde la petición/respuesta. */
  resolveEntityId?: (ctx: { params: any; body: any; response: any }) => string | undefined;
  /**
   * Override de la descripción legible. Si se omite, el catálogo central
   * (audit-catalog.ts) la deriva a partir de la ruta. Devuelve un texto o
   * `{ message, details }` para guardar también detalles estructurados.
   */
  describe?: (ctx: {
    params: any; query: any; body: any; response: any;
    result: 'success' | 'error'; error?: any;
  }) => string | { message: string; details?: Record<string, any> } | undefined;
}

/**
 * Marca un handler para auditoría rica (módulo/acción/entidad explícitos).
 * El interceptor global ya audita TODA mutación; este decorador refina los datos.
 */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta);

export const NO_AUDIT_KEY = 'no_audit';
/** Excluye un handler de la auditoría automática (p. ej. health checks). */
export const NoAudit = () => SetMetadata(NO_AUDIT_KEY, true);
