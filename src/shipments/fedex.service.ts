import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as qs from 'qs';
import { FEDEX_AUTH_HEADERS, FEDEX_AUTHENTICATION_ENDPOINT, FEDEX_HEADERS, FEDEX_TRACKING_ENDPOINT } from 'src/common/constants';
import { TrackingResponseDto } from './dto/fedex/tracking-response.dto';

@Injectable()
export class FedexService {
  private readonly logger = new Logger(FedexService.name);

  private token: string | null = null;
  private tokenExpiresAt: number | null = null; 

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

  async trackPackage(trackingNumber: string): Promise<any> {
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

}
