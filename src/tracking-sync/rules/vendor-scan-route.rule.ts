import { Injectable } from '@nestjs/common';
import { keepRouteOverVendorScan } from 'src/common/vendor-scan.util';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * Un 67/44 (escaneo del proveedor de confianza / estación local) nunca regresa a EN_BODEGA un
 * paquete que ya está EN_RUTA. FedEx manda ese escaneo con la hora adelantada y le ganaba a la
 * salida a ruta. El evento se sigue insertando en el historial (trazabilidad); solo no cambia el
 * estatus. Corre después del Time Shield (80).
 */
@Injectable()
export class VendorScanRouteRule implements SyncRule {
  readonly name = 'vendor-scan-route';
  readonly priority = 79;

  apply(ctx: SyncContext): void {
    if (!ctx.proposedStatus) return;
    const kept = keepRouteOverVendorScan(ctx.shipment.status, ctx.proposedStatus, ctx.normalized.latest?.exceptionCode);
    if (kept !== ctx.proposedStatus) {
      ctx.notes.push(`67/44 no regresa a bodega: se conserva ${kept} (propuesto ${ctx.proposedStatus})`);
      ctx.proposedStatus = kept;
    }
  }
}
