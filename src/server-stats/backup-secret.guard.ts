import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * Autoriza llamadas server-to-server al endpoint de dump comparando el header
 * `X-Backup-Secret` contra `BACKUP_SECRET`. Se usa en `/server/backup/dump`
 * (marcado `@Public()`) porque el backend local no tiene un JWT válido de
 * producción: el único "quién eres" es el secreto compartido.
 *
 * Fail-closed: si `BACKUP_SECRET` no está configurado, NADIE pasa.
 */
@Injectable()
export class BackupSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return false;
    const expected = this.config.get<string>('BACKUP_SECRET') || process.env.BACKUP_SECRET;
    if (!expected) return false;

    const req = context.switchToHttp().getRequest();
    const provided = (req.headers?.['x-backup-secret'] || '').toString();
    return this.safeEqual(provided, expected);
  }

  /** Comparación en tiempo constante para no filtrar el secreto por timing. */
  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
