import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as qs from 'qs';
import * as fs from 'fs';
import * as path from 'path';
import { FEDEX_AUTH_HEADERS, FEDEX_AUTHENTICATION_ENDPOINT, FEDEX_HEADERS, FEDEX_TRACKING_ENDPOINT } from 'src/common/constants';
import { FedExTrackingResponseDto } from './dto/fedex/fedex-tracking-response.dto';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { Priority } from 'src/common/enums/priority.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class FedexService {
  private readonly logger = new Logger(FedexService.name);

  /**
   * True si el error es de CONECTIVIDAD (DNS caído, sin red, conexión rechazada/timeout),
   * no una respuesta de FedEx. Sirve para abrir el circuito y abortar la corrida cuando
   * la API es inalcanzable, en vez de marcar miles de guías como "error".
   */
  static isConnectivityError(error: any): boolean {
    if (error?.response) return false; // hubo respuesta HTTP -> no es problema de red
    const code = error?.code || '';
    const msg = error?.message || '';
    const netCodes = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'];
    return netCodes.includes(code) || /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|network/i.test(msg);
  }
  
  // Ruta del archivo en la raíz del proyecto
  private readonly tokenPath = path.join(process.cwd(), 'fedex-token.json');

  // Caché en memoria del token (evita leer el archivo en cada llamada).
  private cachedToken: { token: string; expiresAt: number } | null = null;
  // Single-flight: una sola petición de refresh aunque lleguen N llamadas concurrentes.
  private tokenRefreshPromise: Promise<string> | null = null;

  /* ===================== TOKEN (single-flight + caché en memoria) ===================== */

  /**
   * Devuelve un token válido. Usa caché en memoria, luego el archivo (persistencia
   * entre reinicios) y, si nada sirve, solicita uno nuevo con single-flight: aunque
   * lleguen N llamadas concurrentes (cron con pLimit), solo se dispara UNA petición
   * de auth y todas comparten el resultado. Esto evita la "estampida de token".
   */
  private async getSmartToken(): Promise<string> {
    const now = Date.now();

    // 1. Caché en memoria (margen de 5 min).
    if (this.cachedToken && now < this.cachedToken.expiresAt - 300000) {
      return this.cachedToken.token;
    }

    // 2. Archivo (sobrevive reinicios del proceso).
    // NOTA arquitectura: en Vercel / múltiples instancias este archivo NO se
    // comparte (cada instancia mantiene el suyo). El single-flight evita la
    // estampida dentro de UNA instancia; para caché compartida real habría que
    // mover el token a BD/Redis. Como fallback, el cold start re-autentica (barato).
    const fileToken = await this.readTokenFromFile();
    if (fileToken && fileToken.token && now < fileToken.expiresAt - 300000) {
      this.cachedToken = fileToken;
      return fileToken.token;
    }

    // 3. Refrescar (single-flight).
    return this.refreshToken();
  }

  /** Single-flight: reutiliza el refresh en curso si ya hay uno. */
  private refreshToken(): Promise<string> {
    if (this.tokenRefreshPromise) return this.tokenRefreshPromise;

    this.tokenRefreshPromise = this.requestNewToken().finally(() => {
      this.tokenRefreshPromise = null;
    });

    return this.tokenRefreshPromise;
  }

  /** Fuerza un token nuevo (tras un 401). Invalida memoria y archivo, y refresca. */
  private async forceRefreshToken(): Promise<string> {
    this.cachedToken = null;
    await this.deleteTokenFile();
    return this.refreshToken();
  }

  private async requestNewToken(): Promise<string> {
    const { FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET, FEDEX_API_URL } = process.env;

    if (!FEDEX_CLIENT_ID || !FEDEX_CLIENT_SECRET || !FEDEX_API_URL) {
      throw new Error('❌ Las variables de entorno de FedEx no están definidas.');
    }

    const data = qs.stringify({
      grant_type: 'client_credentials',
      client_id: FEDEX_CLIENT_ID,
      client_secret: FEDEX_CLIENT_SECRET,
    });

    this.logger.log('🔑 Solicitando nuevo token a FedEx...');
    const response = await axios.post(
      `${FEDEX_API_URL}${FEDEX_AUTHENTICATION_ENDPOINT}`,
      data,
      { headers: FEDEX_AUTH_HEADERS(), timeout: 15000 }
    );

    const { access_token, expires_in } = response.data || {};

    // Validación: no envenenar la caché con un token inválido / expiresAt NaN.
    if (!access_token || typeof access_token !== 'string') {
      throw new Error('FedEx auth: respuesta sin access_token válido.');
    }
    const ttlMs = Number(expires_in) > 0 ? Number(expires_in) * 1000 : 3300_000; // 55 min por defecto
    const expiresAt = Date.now() + ttlMs;

    this.cachedToken = { token: access_token, expiresAt };
    await this.saveTokenToFile(access_token, expiresAt);

    return access_token;
  }

  // --- MÉTODOS DE PERSISTENCIA ---

  // I/O asíncrono (no bloquea el event loop). En multi-instancia/serverless el
  // archivo NO se comparte; ver nota de arquitectura en getSmartToken.
  private async saveTokenToFile(token: string, expiresAt: number): Promise<void> {
    try {
      const data = JSON.stringify({ token, expiresAt }, null, 2);
      await fs.promises.writeFile(this.tokenPath, data, 'utf8');
      this.logger.log('💾 Token persistido en fedex-token.json');
    } catch (error) {
      this.logger.error('❌ No se pudo escribir el archivo de token', error);
    }
  }

  private async readTokenFromFile(): Promise<{ token: string; expiresAt: number } | null> {
    try {
      const data = await fs.promises.readFile(this.tokenPath, 'utf8');
      const parsed = JSON.parse(data);
      if (!parsed?.token || !Number.isFinite(parsed?.expiresAt)) return null;
      return parsed;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        this.logger.error('❌ Error al leer o parsear el archivo de token', error.message);
      }
      return null;
    }
  }

  private async deleteTokenFile(): Promise<void> {
    try {
      await fs.promises.unlink(this.tokenPath);
    } catch (error) {
      // ENOENT por carrera entre llamadas concurrentes: ignorable.
    }
  }

  /* ===================== HELPERS DE RESILIENCIA ===================== */

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Backoff exponencial con jitter (tope 8s) para repartir reintentos. */
  private backoff(attempt: number): number {
    const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
    return base + Math.floor(Math.random() * 500);
  }

  /**
   * POST resiliente al endpoint de tracking. Reintenta ante fallos transitorios:
   *  - 401: refresca token (single-flight) y reintenta.
   *  - 429: respeta Retry-After (o backoff) y reintenta.
   *  - timeout / red / 5xx: backoff exponencial + jitter.
   *  - 4xx no recuperables (400/404…): no reintenta.
   * Así un fallo pasajero deja de "tirar" el paquete por una hora completa.
   *
   * TODO (on-hold, junto al refactor del pipeline): validar el contrato de FedEx
   * en el BORDE con zod (parse seguro del `response.data` aquí) para detectar
   * cambios de su API temprano. Hoy `plainToInstance` NO valida → los decoradores
   * del DTO son solo de tipo/documentación, no runtime.
   */
  private async postTracking(body: any, context: string): Promise<any> {
    const url = `${process.env.FEDEX_API_URL}${FEDEX_TRACKING_ENDPOINT}`;
    const maxAttempts = 4;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Dentro del try: si la obtención del token falla por DNS/red, también se reintenta.
        const token = await this.getSmartToken();
        const response = await axios.post(url, body, {
          headers: FEDEX_HEADERS(token),
          timeout: 15000,
        });
        return response.data;
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        const isLast = attempt === maxAttempts;

        // 401: token inválido -> refresca y reintenta (no consume "intento útil").
        if (status === 401) {
          this.logger.warn(`[${context}] 401: refrescando token (intento ${attempt}/${maxAttempts}).`);
          try { await this.forceRefreshToken(); } catch (e) { /* el siguiente getSmartToken reintentará */ }
          if (!isLast) continue;
        }
        // 429: rate limit -> respeta Retry-After si viene.
        else if (status === 429) {
          const retryAfter = Number(error.response?.headers?.['retry-after']) || 0;
          const wait = retryAfter > 0 ? retryAfter * 1000 : this.backoff(attempt);
          this.logger.warn(`[${context}] 429 rate limit: esperando ${wait}ms (intento ${attempt}/${maxAttempts}).`);
          if (!isLast) { await this.sleep(wait); continue; }
        }
        // Transitorios: timeout, red caída o 5xx.
        else if (error.code === 'ECONNABORTED' || !error.response || (status >= 500 && status <= 599)) {
          const wait = this.backoff(attempt);
          this.logger.warn(`[${context}] Error transitorio (${status || error.code}): reintento en ${wait}ms (intento ${attempt}/${maxAttempts}).`);
          if (!isLast) { await this.sleep(wait); continue; }
        }

        // 4xx no recuperable, o se agotaron los intentos.
        const errorData = error.response?.data || error.message;
        this.logger.error(`❌ Error API FedEx [${context}] (status ${status || error.code}):`, JSON.stringify(errorData));
        throw error;
      }
    }

    throw lastError;
  }

  /** Límite de la Track API de FedEx: nº de trackingInfo por request. */
  static readonly MAX_TRACKINGS_PER_REQUEST = 30;

  /**
   * Rastrea HASTA 30 guías en UNA sola llamada (la Track API lo soporta).
   * Devuelve un `Map<trackingNumber, trackResults[]>`. Reduce ~30× el número
   * de requests (clave para evitar 429 y acelerar el cron).
   *
   * Resiliencia: usa `postTracking` (reintentos 401/429/5xx/red). Las guías
   * inválidas NO tiran la llamada: FedEx responde 200 con un `error` por guía.
   * Si el request completo falla tras los reintentos, lanza (el consumidor
   * decide: lo cuenta como fallido y alimenta el circuit breaker).
   */
  async trackBatch(
    items: { trackingNumber: string; fedexUniqueId?: string; carrierCode?: string }[],
    context = 'batch',
  ): Promise<Map<string, any[]>> {
    const out = new Map<string, any[]>();
    const slice = (items || []).slice(0, FedexService.MAX_TRACKINGS_PER_REQUEST);
    if (slice.length === 0) return out;

    const body = {
      includeDetailedScans: true,
      trackingInfo: slice.map((it) => ({
        trackingNumberInfo: {
          trackingNumber: it.trackingNumber,
          ...(it.fedexUniqueId && { trackingNumberUniqueId: it.fedexUniqueId }),
          ...(it.carrierCode && { carrierCode: it.carrierCode }),
        },
      })),
    };

    const data = await this.postTracking(body, `${context}:${slice.length}`);
    const completeResults = data?.output?.completeTrackResults || [];
    for (const cr of completeResults) {
      // En la Track API, `trackingNumber` vive a NIVEL de completeTrackResults
      // (no en trackingNumberInfo, que está dentro de cada trackResult).
      const tn = cr?.trackingNumber || cr?.trackResults?.[0]?.trackingNumberInfo?.trackingNumber;
      if (tn) out.set(tn, cr.trackResults || []);
    }
    return out;
  }

  async trackPackage(
    trackingNumber: string,
    fedexUniqueId?: string,
    carrierCode?: string
  ): Promise<FedExTrackingResponseDto> {
    this.logger.debug(`Rastreando guía: ${trackingNumber} ${fedexUniqueId ? `(ID: ${fedexUniqueId})` : ''}`);

    const body = {
      includeDetailedScans: true,
      trackingInfo: [
        {
          trackingNumberInfo: {
            trackingNumber,
            ...(fedexUniqueId && { trackingNumberUniqueId: fedexUniqueId }),
            ...(carrierCode && { carrierCode: carrierCode }),
          },
        },
      ],
    };

    const data = await this.postTracking(body, trackingNumber);
    return plainToInstance(FedExTrackingResponseDto, data);
  }

  async completePackageInfo(trackingNumber: string): Promise<ValidatedPackageDispatchDto[]> {
    this.logger.log(`Obteniendo info completa: ${trackingNumber}`);

    const body = {
      trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
      includeDetailedScans: true,
    };

    const data = await this.postTracking(body, trackingNumber);
    return this.mapFedexToValidatedDto(data);
  }

  // --- MÉTODOS DE MAPEO ---

  /** Códigos `derivedCode` de FedEx que ya tenemos mapeados (para detectar los nuevos). */
  private static readonly KNOWN_FEDEX_CODES = new Set([
    'DL', 'IT', 'OD', 'PU', 'AR', 'DP', 'AF', 'AP', 'OC',
    'RS', 'RT', 'RR', 'CA', 'HL', 'DE', 'SE', 'DY',
  ]);

  mapFedexStatusToEnum(fedexCode?: string): ShipmentStatusType | undefined {
    if (!fedexCode) return undefined;
    const code = fedexCode.toUpperCase();
    switch (code) {
      // Entregado
      case 'DL': return ShipmentStatusType.ENTREGADO;
      // En tránsito / en ruta (movimientos normales)
      case 'IT': // In transit
      case 'OD': // Out for delivery
      case 'PU': // Picked up
      case 'AR': // Arrived at facility
      case 'DP': // Departed
      case 'AF': // At FedEx facility
      case 'AP': // At pickup
        return ShipmentStatusType.EN_RUTA;
      // Devolución / retorno al shipper
      case 'RS': // Return to shipper
      case 'RT': // Returned
      case 'RR': // Return requested
        return ShipmentStatusType.DEVUELTO_A_FEDEX;
      // En estación / retenido para recoger
      case 'HL': // Hold at location
        return ShipmentStatusType.ESTACION_FEDEX;
      // Excepciones / demoras (requieren atención; el detalle fino sale del exceptionCode)
      case 'DE': // Delivery exception
      case 'SE': // Shipment exception
      case 'DY': // Delay
        return ShipmentStatusType.DEMORA_EN_ENTREGA;
      // Cancelado
      case 'CA': // Cancelled
        return ShipmentStatusType.OTRO;
      // Solo etiqueta creada, sin movimiento
      case 'OC': // Order/label created
        return ShipmentStatusType.PENDIENTE;
      default:
        // No perdemos el dato en silencio: registramos códigos nuevos para mapearlos.
        if (!FedexService.KNOWN_FEDEX_CODES.has(code)) {
          this.logger.warn(`⚠️ Código FedEx no mapeado: '${code}' → PENDIENTE (revisar mapFedexStatusToEnum).`);
        }
        return ShipmentStatusType.PENDIENTE;
    }
  }

  /** Fecha estimada de entrega: prioriza dateAndTimes, con fallback a las ventanas. */
  private extractCommitDateTime(track: any): Date | undefined {
    const fromDateAndTimes = track.dateAndTimes?.find(
      (dt: any) => dt.type === 'ESTIMATED_DELIVERY' || dt.type === 'COMMIT' || dt.type === 'APPOINTMENT_DELIVERY',
    )?.dateTime;
    const raw =
      fromDateAndTimes ||
      track.estimatedDeliveryTimeWindow?.window?.ends ||
      track.standardTransitTimeWindow?.window?.ends;
    if (!raw) return undefined;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? undefined : d;
  }

  /** Evento de scan MÁS RECIENTE. FedEx NO garantiza el orden, así que ordenamos por fecha. */
  private latestScanEvent(scanEvents?: any[]): any | undefined {
    if (!scanEvents?.length) return undefined;
    return [...scanEvents].sort(
      (a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime(),
    )[0];
  }

  mapFedexToValidatedDto(fedexResponse: FedExTrackingResponseDto): ValidatedPackageDispatchDto[] {
    const results: ValidatedPackageDispatchDto[] = [];
    for (const complete of fedexResponse.output.completeTrackResults) {
      for (const track of complete.trackResults) {
        const lastScan = this.latestScanEvent(track.scanEvents);
        const dto: ValidatedPackageDispatchDto = {
          id: undefined,
          trackingNumber: track.trackingNumberInfo?.trackingNumber,
          commitDateTime: this.extractCommitDateTime(track),
          consNumber: track.additionalTrackingInfo?.packageIdentifiers?.find(p => p.type === "CONSIGNMENT_ID")?.value,
          consolidated: undefined,
          isHighValue: false,
          priority: Priority.BAJA,
          recipientAddress: track.recipientInformation?.address?.streetLines?.join(", "),
          recipientCity: track.recipientInformation?.address?.city,
          // OJO: FedEx no expone el nombre del DESTINATARIO en tracking; `signedByName`
          // es QUIÉN FIRMÓ la entrega ("recibido por"). Se usa como nombre disponible.
          recipientName: track.deliveryDetails?.signedByName ?? undefined,
          recipientPhone: undefined,
          recipientZip: track.recipientInformation?.address?.postalCode,
          shipmentType: ShipmentType.FEDEX,
          subsidiary: undefined,
          status: this.mapFedexStatusToEnum(track.latestStatusDetail?.derivedCode),
          isCharge: false,
          charge: undefined,
          isValid: !!track.latestStatusDetail,
          reason: track.error?.message ?? undefined,
          payment: undefined,
          lastHistory: lastScan
            ? {
                code: lastScan.eventType,
                description: lastScan.eventDescription,
                date: new Date(lastScan.date),
                location: lastScan.scanLocation?.city,
              } as any
            : undefined
        };
        results.push(dto);
      }
    }
    return results;
  }
}