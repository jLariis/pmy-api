import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as qs from 'qs';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { mapFedexStatusToLocalStatus } from 'src/utils/fedex.utils';
import { FedexStatusResolver } from './fedex-status.resolver';
import { StatusVerificationResult } from './fedex-status.types';

/**
 * Verificación CRUZADA del estatus: contrasta el resultado del `FedexStatusResolver` (API oficial,
 * mapeo NUEVO) contra una segunda fuente para confiar en el mapeo.
 *
 * Estrategia (acordada): scrape best-effort del sitio público de FedEx; si lo bloquean/cambian
 * (anti-bot Akamai, muy común), cae a un cross-check INTERNO comparando el mapeo nuevo contra el
 * legado (`mapFedexStatusToLocalStatus`) sobre la MISMA respuesta de la API. Siempre reporta qué
 * fuente usó y si coinciden. Es una herramienta de QA on-demand, NUNCA en el camino caliente.
 */
@Injectable()
export class FedexScrapeVerifier {
  private readonly logger = new Logger(FedexScrapeVerifier.name);
  private static readonly SCRAPE_URL = 'https://www.fedex.com/trackingCal/track';
  private static readonly TIMEOUT_MS = 8000;

  constructor(private readonly resolver: FedexStatusResolver) {}

  async verify(trackingNumber: string): Promise<StatusVerificationResult> {
    const api = await this.resolver.getLatestStatus(trackingNumber);

    // 1. Intento de scrape (best-effort).
    const scraped = await this.tryScrape(trackingNumber);
    if (scraped !== undefined) {
      return {
        trackingNumber,
        apiStatus: api.status,
        secondarySource: 'scrape',
        secondaryStatus: scraped,
        match: api.status === scraped,
        note: 'Contraste contra el sitio público de FedEx.',
      };
    }

    // 2. Fallback interno: mapeo nuevo vs. legado sobre la misma respuesta de la API.
    const legacy = api.found
      ? mapFedexStatusToLocalStatus(api.statusCode ?? '', api.exceptionCode ?? undefined)
      : null;

    return {
      trackingNumber,
      apiStatus: api.status,
      secondarySource: 'legacy',
      secondaryStatus: legacy,
      match: api.status === legacy,
      note: 'Scrape no disponible (bloqueo/anti-bot); se comparó el mapeo nuevo contra el legado.',
    };
  }

  /**
   * Scrape best-effort del endpoint JSON del sitio público. Devuelve el estatus mapeado, o
   * `undefined` si falla por cualquier motivo (bloqueo, timeout, cambio de formato).
   */
  private async tryScrape(trackingNumber: string): Promise<ShipmentStatusType | null | undefined> {
    try {
      const payload = {
        TrackPackagesRequest: {
          appType: 'WTRK',
          uniqueKey: '',
          processingParameters: {},
          trackingInfoList: [
            { trackNumberInfo: { trackingNumber, trackingQualifier: '', trackingCarrier: '' } },
          ],
        },
      };

      const { data } = await axios.post(
        FedexScrapeVerifier.SCRAPE_URL,
        qs.stringify({
          data: JSON.stringify(payload),
          action: 'trackpackages',
          locale: 'en_US',
          version: '1',
          format: 'json',
        }),
        {
          timeout: FedexScrapeVerifier.TIMEOUT_MS,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
            Accept: 'application/json',
          },
        },
      );

      const pkg = data?.TrackPackagesResponse?.packageList?.[0];
      const keyStatus: string | undefined = pkg?.keyStatus || pkg?.statusWithDetails || pkg?.status;
      if (!keyStatus) return undefined;

      return this.mapScrapedStatus(keyStatus);
    } catch (error: any) {
      this.logger.debug(`Scrape no disponible para ${trackingNumber}: ${error?.message}`);
      return undefined;
    }
  }

  /** Mapea el texto de estatus del sitio público a nuestro enum (aproximado). */
  private mapScrapedStatus(text: string): ShipmentStatusType | null {
    const t = text.toLowerCase();
    if (t.includes('delivered')) return ShipmentStatusType.ENTREGADO;
    if (t.includes('on fedex vehicle') || t.includes('out for delivery')) return ShipmentStatusType.EN_RUTA;
    if (t.includes('on the way') || t.includes('in transit')) return ShipmentStatusType.EN_RUTA;
    if (t.includes('picked up')) return ShipmentStatusType.RECOLECCION;
    if (t.includes('at local fedex facility') || t.includes('at fedex')) return ShipmentStatusType.ESTACION_FEDEX;
    if (t.includes('return')) return ShipmentStatusType.DEVUELTO_A_FEDEX;
    if (t.includes('exception') || t.includes('delivery attempted')) return ShipmentStatusType.NO_ENTREGADO;
    if (t.includes('delay')) return ShipmentStatusType.DEMORA_EN_ENTREGA;
    if (t.includes('label created') || t.includes('information sent')) return ShipmentStatusType.PENDIENTE;
    return ShipmentStatusType.DESCONOCIDO;
  }
}
