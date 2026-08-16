import { Injectable } from '@nestjs/common';
import { ShipmentStatusType, TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * Impide que un estatus terminal (entregado/devuelto/retorno) retroceda a uno operativo.
 * Excepción: ENTREGADO siempre gana (aunque el actual sea otro terminal).
 */
@Injectable()
export class TerminalLockRule implements SyncRule {
  readonly name = 'terminal-lock';
  readonly priority = 100;

  apply(ctx: SyncContext): void {
    const current = ctx.shipment.status;
    const proposed = ctx.proposedStatus;
    if (!proposed) return;

    if (proposed === ShipmentStatusType.ENTREGADO) return; // entrega siempre gana

    const currentIsTerminal = TERMINAL_SHIPMENT_STATUSES.includes(current);
    const proposedIsTerminal = TERMINAL_SHIPMENT_STATUSES.includes(proposed);

    if (currentIsTerminal && !proposedIsTerminal) {
      ctx.notes.push(`Escudo Terminal: bloqueado retroceso ${current} → ${proposed}`);
      ctx.proposedStatus = current;
    }
  }
}
