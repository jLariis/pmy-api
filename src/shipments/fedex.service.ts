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

  private token: string | null = null;
  private tokenExpiresAt: number | null = null; 

  /*** Fuctions to return info better */
  mapFedexStatusToEnum(fedexCode?: string): ShipmentStatusType | undefined {
      if (!fedexCode) return undefined;
  
      switch (fedexCode.toUpperCase()) {
        case "DL": // Delivered
          return ShipmentStatusType.ENTREGADO;
        case "IT": // In Transit
          return ShipmentStatusType.EN_RUTA;
        case "OD": // Out for Delivery
          return ShipmentStatusType.EN_RUTA;
        case "PU": // Picked Up
          return ShipmentStatusType.EN_RUTA;
        default:
          return ShipmentStatusType.PENDIENTE; // depende de tu enum
      }
    }
  
  mapFedexToValidatedDto(
    fedexResponse: FedexTrackingResponse
  ): ValidatedPackageDispatchDto[] {
    const results: ValidatedPackageDispatchDto[] = [];

    for (const complete of fedexResponse.output.completeTrackResults) {
      for (const track of complete.trackResults) {
        //console.log("🚀 ~ FedexService ~ mapFedexToValidatedDto ~ track:", track)
        //console.log("🚀 ~ FedexService ~ mapFedexToValidatedDto ~ address:", track.recipientInformation)
        //console.log("🚀 ~ FedexService ~ mapFedexToValidatedDto ~ address:", track.destinationLocation?.locationContactAndAddress?.address.streetLines)
        const dto: ValidatedPackageDispatchDto = {
          id: undefined, // lo asignas tú si ya lo tienes en BD
          trackingNumber: track.trackingNumberInfo?.trackingNumber,
          commitDateTime: track.dateAndTimes?.find(dt => dt.type === "ESTIMATED_DELIVERY")?.dateTime
            ? new Date(track.dateAndTimes.find(dt => dt.type === "ESTIMATED_DELIVERY")!.dateTime)
            : undefined,
          consNumber: track.additionalTrackingInfo?.packageIdentifiers?.find(p => p.type === "CONSIGNMENT_ID")?.value,
          consolidated: undefined, // si lo manejas en tu lógica de negocio
          isHighValue: false, // FedEx no lo manda, podrías inferirlo de declaredValue
          priority: Priority.BAJA, // si necesitas mapear algún código de FedEx a tu enum
          recipientAddress: track.recipientInformation?.address?.streetLines?.join(", "),
          recipientCity: track.recipientInformation?.address?.city,
          recipientName: track.deliveryDetails?.signedByName ?? undefined,
          recipientPhone: undefined, // FedEx no regresa teléfono
          recipientZip: track.recipientInformation?.address?.postalCode,
          shipmentType: ShipmentType.FEDEX,
          subsidiary: undefined, // lo completas en tu lógica
          status: this.mapFedexStatusToEnum(track.latestStatusDetail?.derivedCode),
          isCharge: false, // depende de tu negocio
          charge: undefined, // idem
          isValid: !!track.latestStatusDetail, // si tiene status lo consideramos válido
          reason: track.error?.message ?? undefined,
          payment: undefined, // no viene en FedEx
          lastHistory: track.scanEvents && track.scanEvents.length > 0
            ? {
                // ShipmentStatus es entidad, aquí necesitarías instanciarla
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

  async authorization(){
    if (this.token && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    //this.logger.log(`🚀 ~ FedexService ~ authorization ~ this.token: ${this.token}`)

    const { FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET, FEDEX_API_URL } = process.env;

    //this.logger.log(`🚀 ~ FedexService ~ authorization ~ FEDEX_CLIENT_ID: ${FEDEX_CLIENT_ID}`)

    if (!FEDEX_CLIENT_ID || !FEDEX_CLIENT_SECRET || !FEDEX_API_URL) {
      this.logger.error('❌ Las variables de entorno de FedEx no están definidas.');
      throw new Error('❌ Las variables de entorno de FedEx no están definidas.');
    }

    const data = qs.stringify({
      grant_type: 'client_credentials',
      client_id: FEDEX_CLIENT_ID,
      client_secret: FEDEX_CLIENT_SECRET,
    });

    //this.logger.log(`🚀 ~ FedexService ~ authorization ~ data: ${data}`)

    try {
      const response = await axios.post(`${FEDEX_API_URL}${FEDEX_AUTHENTICATION_ENDPOINT}`,
        data,
        {
          headers: FEDEX_AUTH_HEADERS()
        },
      );

      const { access_token, expires_in } = response.data;

      this.token = access_token;
      
      this.tokenExpiresAt = Date.now() + expires_in * 1000 - 60000; // Renueva 1 minuto antes de expirar

      this.logger.log('✅ Token de FedEx obtenido exitosamente');

      return this.token;
    } catch (error) {
      this.logger.error('❌ Error al obtener token de FedEx', error.response?.data || error.message);
      throw error;
    }
  }

  async trackPackage(trackingNumber: string): Promise<FedExTrackingResponseDto> {
    this.logger.log(`Tracking number: ${trackingNumber}`);
    
    const token = await this.authorization();
    const url = `${process.env.FEDEX_API_URL}${FEDEX_TRACKING_ENDPOINT}`;

    const body = {
      trackingInfo: [
        {
          trackingNumberInfo: {
            trackingNumber,
          },
        },
      ],
      includeDetailedScans: true,
    };

    try {
      const response = await axios.post(url, body, {
        headers: FEDEX_HEADERS(token),
      });

      this.logger.log('✅ Data de FedEx obtenida exitosamente');
      //this.logger.log(`Tracking Info - completeTrackResults: ${JSON.stringify(response.data.output.completeTrackResults)}`);
      //this.logger.log(`Tracking Info - Last Status: ${JSON.stringify(response.data.output.completeTrackResults[0].trackResults[0].latestStatusDetail)}`);

      //return response.data.output.completeTrackResults[0].trackResults[0].latestStatusDetail.statusByLocale;
      return response.data;
      
    } catch (error) {
      this.logger.error('❌ Error al rastrear paquete:', error.response?.data || error.message);
      throw error;
    }
  }

  async completePackageInfo(trackingNumber: string): Promise<ValidatedPackageDispatchDto[]> {
    this.logger.log(`Tracking number: ${trackingNumber}`);
    
    const token = await this.authorization();
    const url = `${process.env.FEDEX_API_URL}${FEDEX_TRACKING_ENDPOINT}`;

    const body = {
      trackingInfo: [
        {
          trackingNumberInfo: {
            trackingNumber,
          },
        },
      ],
      includeDetailedScans: true,
    };

    try {
      const response = await axios.post(url, body, {
        headers: FEDEX_HEADERS(token),
      });

      this.logger.log('✅ Data de FedEx obtenida exitosamente');
      console.log("Fedex Data: ", response.data.output.completeTrackResults[0].trackResults[0])
      return this.mapFedexToValidatedDto(response.data);
      
    } catch (error) {
      this.logger.error('❌ Error al rastrear paquete:', error.response?.data || error.message);
      throw error;
    }
  }
}
