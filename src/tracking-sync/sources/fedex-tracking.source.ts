import { Injectable } from '@nestjs/common';
import { FedexService } from 'src/shipments/fedex.service';
import { RawTrackingResult, TrackingRef, TrackingSource } from '../tracking-sync.types';

/**
 * Única capa que conoce FedEx. Envuelve FedexService.trackBatch (token/backoff/429 ya
 * resueltos) y aplica el SELECTOR DE GENERACIÓN: si FedEx devuelve varias generaciones
 * de una guía reciclada, elige la de mayor secuencia (desempate por último scan).
 */
@Injectable()
export class FedexTrackingSource implements TrackingSource {
  private static readonly BATCH = 30;

  constructor(private readonly fedexService: FedexService) {}

  async fetch(refs: TrackingRef[]): Promise<RawTrackingResult[]> {
    const out: RawTrackingResult[] = [];
    for (let i = 0; i < refs.length; i += FedexTrackingSource.BATCH) {
      const slice = refs.slice(i, i + FedexTrackingSource.BATCH);
      const map = await this.fedexService.trackBatch(
        slice.map((r) => ({ trackingNumber: r.trackingNumber, fedexUniqueId: r.fedexUniqueId, carrierCode: r.carrierCode })),
        'tracking-sync',
      );
      for (const ref of slice) {
        const results = map.get(ref.trackingNumber) || [];
        const winner = this.pickGeneration(results);
        out.push({ trackingNumber: ref.trackingNumber, trackResults: winner ? [winner] : [] });
      }
    }
    return out;
  }

  private pickGeneration(results: any[]): any | null {
    if (!results?.length) return null;
    if (results.length === 1) return results[0];
    return [...results].sort((a, b) => {
      const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0', 10);
      const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0', 10);
      if (seqA !== seqB) return seqB - seqA;
      const tA = new Date(a.scanEvents?.[0]?.date || 0).getTime();
      const tB = new Date(b.scanEvents?.[0]?.date || 0).getTime();
      return tB - tA;
    })[0];
  }
}
