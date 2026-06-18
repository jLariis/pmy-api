import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as qs from 'qs';
import * as fs from 'fs';
import * as path from 'path';
import { FEDEX_AUTH_HEADERS, FEDEX_AUTHENTICATION_ENDPOINT, FEDEX_HEADERS, FEDEX_TRACKING_ENDPOINT } from 'src/common/constants';
import { FedExTrackingResponseDto } from './dto/fedex/fedex-tracking-response.dto';
import { FedexTrackingResponse } from './dto/FedexTrackingCompleteInfo.dto';
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
    const fileToken = this.readTokenFromFile();
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
    this.deleteTokenFile();
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

    const { access_token, expires_in } = response.data;
    const expiresAt = Date.now() + (expires_in * 1000);

    this.cachedToken = { token: access_token, expiresAt };
    this.saveTokenToFile(access_token, expiresAt);

    return access_token;
  }

  // --- MÉTODOS DE PERSISTENCIA ---

  private saveTokenToFile(token: string, expiresAt: number) {
    try {
      const data = JSON.stringify({ token, expiresAt }, null, 2);
      // writeFileSync crea el archivo si no existe
      fs.writeFileSync(this.tokenPath, data, 'utf8');
      this.logger.log('💾 Token persistido en fedex-token.json');
    } catch (error) {
      this.logger.error('❌ No se pudo escribir el archivo de token', error);
    }
  }

  private readTokenFromFile(): { token: string; expiresAt: number } | null {
    try {
      if (!fs.existsSync(this.tokenPath)) {
        return null;
      }
      const data = fs.readFileSync(this.tokenPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.error('❌ Error al leer o parsear el archivo de token', error);
      return null;
    }
  }

  private deleteTokenFile() {
    try {
      if (fs.existsSync(this.tokenPath)) {
        fs.unlinkSync(this.tokenPath);
      }
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

  async trackPackage(
    trackingNumber: string,
    fedexUniqueId?: string,
    carrierCode?: string
  ): Promise<FedExTrackingResponseDto> {
    this.logger.log(`Rastreando guía: ${trackingNumber} ${fedexUniqueId ? `(ID: ${fedexUniqueId})` : ''}`);

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

  mapFedexStatusToEnum(fedexCode?: string): ShipmentStatusType | undefined {
    if (!fedexCode) return undefined;
    switch (fedexCode.toUpperCase()) {
      case "DL": return ShipmentStatusType.ENTREGADO;
      case "IT": 
      case "OD": 
      case "PU": return ShipmentStatusType.EN_RUTA;
      default: return ShipmentStatusType.PENDIENTE;
    }
  }

  mapFedexToValidatedDto(fedexResponse: FedexTrackingResponse): ValidatedPackageDispatchDto[] {
    const results: ValidatedPackageDispatchDto[] = [];
    for (const complete of fedexResponse.output.completeTrackResults) {
      for (const track of complete.trackResults) {
        const dto: ValidatedPackageDispatchDto = {
          id: undefined,
          trackingNumber: track.trackingNumberInfo?.trackingNumber,
          commitDateTime: track.dateAndTimes?.find(dt => dt.type === "ESTIMATED_DELIVERY")?.dateTime
            ? new Date(track.dateAndTimes.find(dt => dt.type === "ESTIMATED_DELIVERY")!.dateTime)
            : undefined,
          consNumber: track.additionalTrackingInfo?.packageIdentifiers?.find(p => p.type === "CONSIGNMENT_ID")?.value,
          consolidated: undefined,
          isHighValue: false,
          priority: Priority.BAJA,
          recipientAddress: track.recipientInformation?.address?.streetLines?.join(", "),
          recipientCity: track.recipientInformation?.address?.city,
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
          lastHistory: track.scanEvents && track.scanEvents.length > 0
            ? {
                code: track.scanEvents[0].eventType,
                description: track.scanEvents[0].eventDescription,
                date: new Date(track.scanEvents[0].date),
                location: track.scanEvents[0].scanLocation?.city,
              } as any
            : undefined
        };
        results.push(dto);
      }
    }
    return results;
  }
}