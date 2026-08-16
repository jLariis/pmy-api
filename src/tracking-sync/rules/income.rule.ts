import { Injectable } from '@nestjs/common';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * HOOK FINANCIERO — DECLARADO PERO INACTIVO en shadow.
 * Cuando se active, encolará DeferredEffect { type: 'income', ... } que un ejecutor
 * fuera del pipeline procesará. Hoy es no-op deliberado (alcance: solo estatus).
 */
@Injectable()
export class IncomeRule implements SyncRule {
  readonly name = 'income';
  readonly priority = 10;
  readonly enabled = false;

  apply(_ctx: SyncContext): void {
    if (!this.enabled) return;
    // Intencionalmente vacío hasta la migración de reglas financieras.
  }
}
