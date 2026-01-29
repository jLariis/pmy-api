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
  
  // Ruta del archivo en la raíz del proyecto
  private readonly tokenPath = path.join(process.cwd(), 'fedex-token.json');

  /**
   * Obtiene el token desde el archivo local o desde la API de FedEx si expiró.
   */
  private async getSmartToken(): Promise<string> {
    const now = Date.now();
    let cachedData = this.readTokenFromFile();

    // Validamos si el token existe en el archivo y si aún es válido (margen de 5 min)
    if (cachedData && cachedData.token && now < (cachedData.expiresAt - 300000)) {
      return cachedData.token;
    }

    // Si no hay token válido, procedemos a solicitar uno nuevo
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
      this.logger.log('🔑 El token local no es válido o va a expirar. Solicitando nuevo token a FedEx...');
      const response = await axios.post(
        `${FEDEX_API_URL}${FEDEX_AUTHENTICATION_ENDPOINT}`,
        data,
        { headers: FEDEX_AUTH_HEADERS() }
      );

      const { access_token, expires_in } = response.data;
      const expiresAt = Date.now() + (expires_in * 1000);

      // Guardamos y/o creamos el archivo
      this.saveTokenToFile(access_token, expiresAt);

      return access_token;
    } catch (error) {
      this.logger.error('❌ Error al obtener token de FedEx', error.response?.data || error.message);
      throw error;
    }
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
        this.logger.warn('📄 Archivo de token no encontrado. Se creará uno nuevo al solicitarlo.');
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
    if (fs.existsSync(this.tokenPath)) {
      fs.unlinkSync(this.tokenPath);
      this.logger.warn('🗑️ Token local eliminado por invalidez.');
    }
  }


async trackPackage(
  trackingNumber: string, 
  fedexUniqueId?: string, 
  carrierCode?: string
): Promise<FedExTrackingResponseDto> {
  this.logger.log(`Rastreando guía: ${trackingNumber} ${fedexUniqueId ? `(ID: ${fedexUniqueId})` : ''}`);
  
  const token = await this.getSmartToken();
  const url = `${process.env.FEDEX_API_URL}${FEDEX_TRACKING_ENDPOINT}`;

  const body = {
    includeDetailedScans: true,
    trackingInfo: [
      {
        trackingNumberInfo: {
          trackingNumber,
          ...(fedexUniqueId && { trackingNumberUniqueId: fedexUniqueId }),
          ...(carrierCode && { carrierCode: carrierCode }),
        },
      }
    ],
  };

  try {
    const response = await axios.post(url, body, {
      headers: FEDEX_HEADERS(token),
      timeout: 10000, // Evita que el cron se cuelgue infinitamente
    });

    // --- CRÍTICO: Transformación y Validación ---
    const trackData = plainToInstance(FedExTrackingResponseDto, response.data);
    
    // Opcional: Validar si la respuesta tiene la estructura esperada
    // const errors = await validate(trackData);
    // if (errors.length > 0) throw new Error('Estructura de respuesta FedEx inválida');

    return trackData;

  } catch (error) {
    if (error.response?.status === 401) {
      this.logger.warn(`Token expirado para [${trackingNumber}], limpiando...`);
      this.deleteTokenFile();
    }
    
    // Si FedEx responde 404 o similar, logueamos pero no necesariamente 
    // matamos el proceso para que el cron siga con la siguiente guía
    const errorData = error.response?.data || error.message;
    this.logger.error(`❌ Error API FedEx [${trackingNumber}]:`, JSON.stringify(errorData));
    
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
      if (error.response?.status === 401) this.deleteTokenFile();
      this.logger.error(`❌ Error completePackageInfo [${trackingNumber}]:`, error.response?.data || error.message);
      throw error;
    }
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