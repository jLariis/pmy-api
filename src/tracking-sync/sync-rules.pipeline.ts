import { Inject, Injectable, Logger } from '@nestjs/common';
import { SyncContext, SyncRule, SYNC_RULES } from './tracking-sync.types';

/**
 * Ejecuta las reglas ordenadas por prioridad (mayor primero) sobre un SyncContext
 * compartido. Chain of Responsibility: cada regla lee/muta el contexto. Agregar una
 * regla = registrar un provider más en SYNC_RULES; el pipeline no cambia.
 */
@Injectable()
export class SyncRulesPipeline {
  private readonly logger = new Logger(SyncRulesPipeline.name);
  private readonly ordered: SyncRule[];

  constructor(@Inject(SYNC_RULES) rules: SyncRule[]) {
    this.ordered = [...(rules ?? [])].sort((a, b) => b.priority - a.priority);
  }

  async run(ctx: SyncContext): Promise<void> {
    for (const rule of this.ordered) {
      try {
        await rule.apply(ctx);
      } catch (err: any) {
        this.logger.warn(`Regla '${rule.name}' falló para ${ctx.shipment.trackingNumber}: ${err?.message}`);
        ctx.notes.push(`rule:${rule.name} error:${err?.message}`);
      }
    }
  }
}
