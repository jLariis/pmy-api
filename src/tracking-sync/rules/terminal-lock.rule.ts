import { Injectable } from '@nestjs/common';
import { isFinalShipmentStatus, ShipmentStatusType, TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * Impide que un estatus terminal (entregado/devuelto/retorno) retroceda a uno operativo.
 * ENTREGADO y DEVUELTO_A_FEDEX son FINALES: no cambian a NADA (una entrega de FedEx no revive
 * una devuelta). En los demás terminales, ENTREGADO sí gana (ej. entregado por FedEx → entregado).
 */
@Injectable()
export class TerminalLockRule implements SyncRule {
  readonly name = 'terminal-lock';
  readonly priority = 100;

  apply(ctx: SyncContext): void {
    const current = ctx.shipment.status;
    const proposed = ctx.proposedStatus;
    if (!proposed) return;

    if (isFinalShipmentStatus(current)) {
      if (proposed !== current) {
        ctx.notes.push(`Escudo Terminal: ${current} es final, no cambia (propuesto ${proposed})`);
        ctx.proposedStatus = current;
      }
      return;
    }

    if (proposed === ShipmentStatusType.ENTREGADO) return; // entrega gana sobre otros terminales

    const currentIsTerminal = TERMINAL_SHIPMENT_STATUSES.includes(current);
    const proposedIsTerminal = TERMINAL_SHIPMENT_STATUSES.includes(proposed);

    if (currentIsTerminal && !proposedIsTerminal) {
      ctx.notes.push(`Escudo Terminal: bloqueado retroceso ${current} → ${proposed}`);
      ctx.proposedStatus = current;
    }
  }
}
