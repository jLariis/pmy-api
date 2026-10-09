import { Injectable } from '@nestjs/common';
import { SyncContext, SyncRule } from '../tracking-sync.types';

/**
 * CÓDIGO 44 (espejo de shipments.service): FedEx NO manda el 44 en scanEvents; lo reporta en
 * `latestStatusDetail.ancillaryDetails[].reason='44'`. Encola un efecto para marcar
 * exceptionCode='44' + status=EN_BODEGA en la fila del escaneo local más reciente (idempotente).
 * Se guarda en TODAS las sucursales (es un hecho de FedEx; las satélite de Obregón están en 67 y
 * FedEx les manda el 44). No genera filas nuevas ni toca el estatus vivo.
 */
@Injectable()
export class Code44Rule implements SyncRule {
  readonly name = 'code44';
  readonly priority = 20;

  apply(ctx: SyncContext): void {
    const at = ctx.normalized.header.code44At;
    if (!at) return;
    ctx.deferredEffects.push({ type: 'code44', payload: { at: at.toISOString() } });
  }
}
