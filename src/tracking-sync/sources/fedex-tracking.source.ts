import { Injectable } from '@nestjs/common';
import { pickActiveGeneration } from 'src/shipments/fedex-generation.util';
import { FedexService } from 'src/shipments/fedex.service';
import { RawTrackingResult, TrackingRef, TrackingSource } from '../tracking-sync.types';

/**
 * Única capa que conoce FedEx. Envuelve FedexService.trackBatch (token/backoff/429 ya
 * resueltos) y aplica el SELECTOR DE GENERACIÓN: si FedEx devuelve varios envíos con el mismo
 * número (reciclada o dos etiquetas), elige el del escaneo más reciente (pickActiveGeneration).
 */
@Injectable()
export class FedexTrackingSource implements TrackingSource {
  private static readonly BATCH = 30;

  constructor(private readonly fedexService: FedexService) {}

  async fetch(refs: TrackingRef[]): Promise<RawTrackingResult[]> {
    const out: RawTrackingResult[] = [];
    // Defensa: nunca mandamos a FedEx una guía vacía/nula (produce 422 y tira TODO el lote).
    // Las guías sin trackingNumber salen como "sin datos" y el resto se consulta normal.
    const valid: TrackingRef[] = [];
    for (const r of refs) {
      if (r?.trackingNumber && `${r.trackingNumber}`.trim()) valid.push(r);
      else out.push({ trackingNumber: r?.trackingNumber ?? '', trackResults: [] });
    }
    for (let i = 0; i < valid.length; i += FedexTrackingSource.BATCH) {
      const slice = valid.slice(i, i + FedexTrackingSource.BATCH);
      const map = await this.fedexService.trackBatch(
        slice.map((r) => ({ trackingNumber: r.trackingNumber, fedexUniqueId: r.fedexUniqueId, carrierCode: r.carrierCode })),
        'tracking-sync',
      );
      for (const ref of slice) {
        const results = map.get(ref.trackingNumber) || [];
        const winner = pickActiveGeneration(results);
        out.push({ trackingNumber: ref.trackingNumber, trackResults: winner ? [winner] : [] });
      }
    }
    return out;
  }

}
