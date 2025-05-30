import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule'; // Tu servicio que accede a la BD
import { ShipmentsService } from 'src/shipments/shipments.service';

@Injectable()
export class TrackingCronService {
  private readonly logger = new Logger(TrackingCronService.name);

  constructor(private readonly shipmentService: ShipmentsService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron() {
    this.logger.log('Ejecutando verificación de envíos...');
    await this.shipmentService.checkStatusOnFedex(); // función que tú defines
  }
}
