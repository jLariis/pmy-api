import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { randomUUID } from 'crypto';
import { AuditService } from './audit.service';
import { AUDIT_KEY, NO_AUDIT_KEY, AuditMeta } from './audit.decorator';
import {
  AuditAction,
  AuditModule,
  AuditResult,
  AuditSeverity,
} from 'src/common/enums/audit.enum';
import { getClientIp, redact } from './audit.util';
import { parseDevice } from './client-info.util';
import { resolveAudit, normalizeAuditPath, AuditDescribeCtx } from './audit-catalog';
import { NotificationsService } from 'src/notifications/notifications.service';

const METHOD_ACTION: Record<string, AuditAction> = {
  POST: AuditAction.CREATE,
  PUT: AuditAction.UPDATE,
  PATCH: AuditAction.UPDATE,
  DELETE: AuditAction.DELETE,
  GET: AuditAction.READ,
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Extrae info del cliente desde headers (la pone el frontend). Fallback: User-Agent. */
  private extractClientMeta(req: any) {
    const h = req.headers || {};
    const dec = (v: any) => {
      if (!v) return undefined;
      try { return decodeURIComponent(String(v)); } catch { return String(v); }
    };
    const ua = (h['user-agent'] || '').toString();
    const uaDevice = dec(h['x-device']) || parseDevice(ua);
    const machine = dec(h['x-machine-name']); // hostname real (solo desde Electron)
    return {
      publicIp: (h['x-public-ip'] || '').toString().slice(0, 64) || undefined,
      geoCity: dec(h['x-geo-city'])?.slice(0, 120),
      geoRegion: dec(h['x-geo-region'])?.slice(0, 120),
      geoCountry: dec(h['x-geo-country'])?.slice(0, 120),
      device: (machine ? `${machine} · ${uaDevice}` : uaDevice)?.slice(0, 160),
      deviceId: (h['x-device-id'] || '').toString().slice(0, 64) || undefined,
    };
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Solo HTTP
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();

    // Info del cliente (ciudad/IP pública/equipo) enviada por el navegador en headers.
    const cm = this.extractClientMeta(req);

    // ===== PRESENCIA: en CADA request autenticado (incluye GET), sin tocar audit_log =====
    const presenceUser = req.user;
    const uid = presenceUser?.userId ?? presenceUser?.id;
    if (uid) {
      const path = (req.originalUrl || req.url || '').toString();
      if (/\/auth\/logout/.test(path)) {
        this.audit.endPresence(uid);
      } else {
        this.audit.touchPresence(
          presenceUser,
          getClientIp(req),
          (req.headers['user-agent'] || '').toString().slice(0, 512),
          path,
          { isLogin: /\/auth\/token/.test(path), ...cm },
        );
      }
    }

    const noAudit = this.reflector.getAllAndOverride<boolean>(NO_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (noAudit) return next.handle();

    const meta = this.reflector.getAllAndOverride<AuditMeta>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const method = req.method;
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    // Regla: audita si hay @Audit() o si es mutación. Los GET solo si se marcan.
    if (!meta && !isMutation) return next.handle();

    const start = Date.now();
    const requestId = req.headers['x-request-id'] || randomUUID();
    const user = req.user || {};
    const normPath = normalizeAuditPath(req.originalUrl || req.url);

    const base = {
      userId: user.userId ?? user.id,
      userEmail: user.email,
      userName: [user.name, user.lastName].filter(Boolean).join(' ') || undefined,
      role: user.role,
      subsidiaryId: user.subsidiary?.id ?? user.subsidiaryId,
      method,
      path: req.originalUrl,
      ip: getClientIp(req),
      userAgent: (req.headers['user-agent'] || '').toString().slice(0, 512),
      ...cm,
      requestId: requestId.toString(),
      metadata: {
        params: req.params,
        query: req.query,
        ...(meta?.skipBody ? {} : { body: redact(req.body) }),
      },
    };

    /**
     * Deriva módulo + acción + descripción legible desde el catálogo central,
     * permitiendo override por @Audit({ module, action, describe }).
     */
    const enrich = (result: 'success' | 'error', response: any, error?: any) => {
      const ctx: AuditDescribeCtx = {
        method, path: normPath,
        params: req.params, query: req.query, body: req.body,
        response, result, error,
      };
      const cat = resolveAudit(ctx);
      let description = cat.description;
      let details = cat.details;
      if (meta?.describe) {
        try {
          const d = meta.describe(ctx);
          if (typeof d === 'string') description = d;
          else if (d) { description = d.message; details = { ...details, ...d.details }; }
        } catch { /* conserva la descripción del catálogo */ }
      }
      return {
        module: meta?.module ?? cat.module ?? AuditModule.OTRO,
        action: meta?.action ?? cat.action ?? METHOD_ACTION[method] ?? AuditAction.OTHER,
        entityName: meta?.entityName ?? cat.entityName,
        description,
        metadata: details ? { ...base.metadata, details } : base.metadata,
      };
    };

    return next.handle().pipe(
      tap((response) => {
        const res = context.switchToHttp().getResponse();
        const e = enrich('success', response);
        this.audit.log({
          ...base,
          module: e.module,
          action: e.action,
          entityName: e.entityName,
          description: e.description,
          metadata: e.metadata,
          result: AuditResult.SUCCESS,
          statusCode: res?.statusCode,
          durationMs: Date.now() - start,
          entityId:
            meta?.resolveEntityId?.({ params: req.params, body: req.body, response }) ??
            req.params?.id ??
            (response && typeof response === 'object' ? response.id : undefined),
          afterState: meta && !meta.skipBody ? redact(response) : undefined,
        });
        try {
          this.notifications.emitFromAudit({
            module: String(e.module),
            action: String(e.action),
            title: e.entityName ?? 'Actividad',
            body: e.description,
            entityId:
              meta?.resolveEntityId?.({ params: req.params, body: req.body, response }) ??
              req.params?.id ??
              (response && typeof response === 'object' ? response.id : undefined),
            subsidiaryId: base.subsidiaryId,
            actor: { id: base.userId, name: base.userName ?? base.userEmail },
            isSession: String(e.module) === 'auth',
          });
        } catch { /* best-effort: nunca romper la request */ }
      }),
      catchError((err) => {
        const e = enrich('error', undefined, err);
        this.audit.log({
          ...base,
          module: e.module,
          action: e.action,
          entityName: e.entityName,
          description: e.description,
          metadata: e.metadata,
          result: AuditResult.ERROR,
          severity: AuditSeverity.WARNING,
          statusCode: err?.status ?? err?.statusCode ?? 500,
          errorMessage: (err?.message ?? 'Error').toString().slice(0, 1000),
          durationMs: Date.now() - start,
          entityId: req.params?.id,
        });
        return throwError(() => err);
      }),
    );
  }
}
