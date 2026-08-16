import { Injectable } from '@nestjs/common';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * HOOK DE NOTIFICACIONES — DECLARADO PERO INACTIVO en shadow. No-op hasta activarse.
 */
@Injectable()
export class NotificationRule implements SyncRule {
  readonly name = 'notification';
  readonly priority = 5;
  readonly enabled = false;

  apply(_ctx: SyncContext): void {
    if (!this.enabled) return;
  }
}
