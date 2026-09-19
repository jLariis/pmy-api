import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * Autoriza el endpoint interno `/server/power/internal/notify` (lo llaman los hooks
 * de systemd-sleep en localhost) comparando `X-Power-Secret` contra `POWER_SECRET`.
 * Fail-closed: si `POWER_SECRET` no está configurado, NADIE pasa.
 */
@Injectable()
export class PowerSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return false;
    const expected = this.config.get<string>('POWER_SECRET') || process.env.POWER_SECRET;
    if (!expected) return false;
    const req = context.switchToHttp().getRequest();
    const provided = (req.headers?.['x-power-secret'] || '').toString();
    return this.safeEqual(provided, expected);
  }

  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
