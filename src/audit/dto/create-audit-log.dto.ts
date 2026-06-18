import {
  AuditAction,
  AuditModule,
  AuditResult,
  AuditSeverity,
} from 'src/common/enums/audit.enum';

/** Estructura interna usada por AuditService.log() y el interceptor. */
export interface CreateAuditLogDto {
  userId?: string;
  userEmail?: string;
  userName?: string;
  role?: string;
  module: AuditModule;
  action: AuditAction;
  result?: AuditResult;
  severity?: AuditSeverity;
  entityName?: string;
  entityId?: string;
  description?: string;
  beforeState?: Record<string, any>;
  afterState?: Record<string, any>;
  changes?: Record<string, { from: any; to: any }>;
  metadata?: Record<string, any>;
  method?: string;
  path?: string;
  statusCode?: number;
  errorMessage?: string;
  ip?: string;
  userAgent?: string;
  publicIp?: string;
  geoCity?: string;
  geoRegion?: string;
  geoCountry?: string;
  device?: string;
  deviceId?: string;
  subsidiaryId?: string;
  requestId?: string;
  durationMs?: number;
}
