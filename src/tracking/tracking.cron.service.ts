import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule'; // Tu servicio que accede a la BD
import { ShipmentsService } from 'src/shipments/shipments.service';

@Injectable()
export class TrackingCronService {
  private readonly logger = new Logger(TrackingCronService.name);

  constructor(private readonly shipmentService: ShipmentsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    this.logger.log('🕐 Ejecutando verificación de envíos...');
    await this.shipmentService.checkStatusOnFedex();
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleUpdatePriotiry(){
    this.logger.log('🕐 Ejecutando actualización de prioridades...');
    await this.shipmentService.updatePriorities();
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleSendPriorityShipments(){
    this.logger.log('🕐 Ejecutando el envio de correo con envíos que deben ser proritarios...');
    await this.shipmentService.sendEmailWithHighPriorities();
  }
}



