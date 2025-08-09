import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule'; // Tu servicio que accede a la BD
import { ShipmentsService } from 'src/shipments/shipments.service';

@Injectable()
export class TrackingCronService {
  private readonly logger = new Logger(TrackingCronService.name);

  constructor(
    private readonly shipmentService: ShipmentsService
  ) {}

  /*@Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    this.logger.log('🕐 Ejecutando verificación de envíos...');
    await this.shipmentService.checkStatusOnFedex();
  }*/

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    this.logger.log('🕐 Ejecutando verificación de envíos...');

    // Obtener los envíos a validar usando getShipmentsToValidate
    const shipments = await this.shipmentService.getShipmentsToValidate();

    // Extraer los trackingNumbers de los envíos
    const trackingNumbers = shipments.map(shipment => shipment.trackingNumber);

    if (!trackingNumbers.length) {
      this.logger.log('📪 No hay envíos para procesar');
      return;
    }

    this.logger.log(`📦 Procesando ${trackingNumbers.length} trackingNumbers: ${JSON.stringify(trackingNumbers)}`);

    // Llamar al Método 2 con shouldPersist = true para emular el comportamiento del Método 1
    try {
      const result = await this.shipmentService.checkStatusOnFedexBySubsidiaryRulesTesting(trackingNumbers, true);

      // Registrar resultados para auditoría
      this.logger.log(
        `✅ Resultado: ${result.updatedShipments.length} envíos actualizados, ` +
        `${result.shipmentsWithError.length} errores, ` +
        `${result.unusualCodes.length} códigos inusuales, ` +
        `${result.shipmentsWithOD.length} excepciones OD o fallos de validación`
      );

      // Registrar detalles de errores, códigos inusuales y excepciones OD si los hay
      if (result.shipmentsWithError.length) {
        this.logger.warn(`⚠️ Errores detectados: ${JSON.stringify(result.shipmentsWithError, null, 2)}`);
      }
      if (result.unusualCodes.length) {
        this.logger.warn(`⚠️ Códigos inusuales: ${JSON.stringify(result.unusualCodes, null, 2)}`);
      }
      if (result.shipmentsWithOD.length) {
        this.logger.warn(`⚠️ Excepciones OD o fallos de validación: ${JSON.stringify(result.shipmentsWithOD, null, 2)}`);
      }
    } catch (err) {
      this.logger.error(`❌ Error en handleCron: ${err.message}`);
      // Opcional: Guardar el error en un log persistente o enviar una notificación
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM, { timeZone: 'America/Hermosillo' })
  async handleUpdatePriotiry(){
    this.logger.log('🕐 Ejecutando actualización de prioridades...');
    await this.shipmentService.updatePriorities();
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM, { timeZone: 'America/Hermosillo' })
  async handleSendPriorityShipments(){
    this.logger.log('🕐 Ejecutando el envio de correo con envíos que deben ser proritarios...');
    await this.shipmentService.sendEmailWithHighPriorities();
  }
}



