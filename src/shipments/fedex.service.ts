import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as qs from 'qs';
import { FEDEX_AUTH_HEADERS, FEDEX_AUTHENTICATION_ENDPOINT, FEDEX_HEADERS, FEDEX_TRACKING_ENDPOINT } from 'src/common/constants';
import { FedExTrackingResponseDto } from './dto/fedex/fedex-tracking-response.dto';
import { FedexTrackingResponse } from './dto/FedexTrackingCompleteInfo.dto';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { Priority } from 'src/common/enums/priority.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';

@Injectable()
export class FedexService {
  private readonly logger = new Logger(FedexService.name);

  // Unificamos las variables de caché
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  /**
   * Obtiene el token de acceso. Si el token en memoria es válido, lo reutiliza.
   * Evita el error 429 al no saturar el endpoint de autenticación de FedEx.
   */
  private async getSmartToken(): Promise<string> {
    const now = Date.now();
    
    // Si tenemos token y le quedan más de 2 minutos de vida, lo usamos
    if (this.cachedToken && now < (this.tokenExpiresAt - 120000)) {
      return this.cachedToken;
    }

    const { FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET, FEDEX_API_URL } = process.env;

    if (!FEDEX_CLIENT_ID || !FEDEX_CLIENT_SECRET || !FEDEX_API_URL) {
      throw new Error('❌ Las variables de entorno de FedEx no están definidas.');
    }

    const data = qs.stringify({
      grant_type: 'client_credentials',
      client_id: FEDEX_CLIENT_ID,
      client_secret: FEDEX_CLIENT_SECRET,
    });

    try {
      this.logger.log('🔑 Solicitando nuevo token a FedEx...');
      const response = await axios.post(
        `${FEDEX_API_URL}${FEDEX_AUTHENTICATION_ENDPOINT}`,
        data,
        { headers: FEDEX_AUTH_HEADERS() }
      );

      const { access_token, expires_in } = response.data;

      // Guardamos en caché
      this.cachedToken = access_token;
      // expires_in viene en segundos, convertimos a timestamp
      this.tokenExpiresAt = Date.now() + (expires_in * 1000);

      this.logger.log('✅ Token de FedEx renovado exitosamente');
      return this.cachedToken!;
    } catch (error) {
      this.logger.error('❌ Error al obtener token de FedEx', error.response?.data || error.message);
      throw error;
    }
  }

  async trackPackage(trackingNumber: string): Promise<FedExTrackingResponseDto> {
    this.logger.log(`Rastreando guía: ${trackingNumber}`);
    
    // Usamos el token inteligente
    const token = await this.getSmartToken();
    const url = `${process.env.FEDEX_API_URL}${FEDEX_TRACKING_ENDPOINT}`;

    const body = {
      trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
      includeDetailedScans: true,
    };

    try {
      const response = await axios.post(url, body, {
        headers: FEDEX_HEADERS(token),
      });
      return response.data;
    } catch (error) {
      this.logger.error(`❌ Error trackPackage [${trackingNumber}]:`, error.response?.data || error.message);
      throw error;
    }
  }

  async completePackageInfo(trackingNumber: string): Promise<ValidatedPackageDispatchDto[]> {
    this.logger.log(`Obteniendo info completa: ${trackingNumber}`);
    
    const token = await this.getSmartToken();
    const url = `${process.env.FEDEX_API_URL}${FEDEX_TRACKING_ENDPOINT}`;

    const body = {
      trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
      includeDetailedScans: true,
    };

    try {
      const response = await axios.post(url, body, {
        headers: FEDEX_HEADERS(token),
      });
      return this.mapFedexToValidatedDto(response.data);
    } catch (error) {
      this.logger.error(`❌ Error completePackageInfo [${trackingNumber}]:`, error.response?.data || error.message);
      throw error;
    }
  }

  // --- MÉTODOS DE MAPEO (Se mantienen igual pero limpios) ---

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