import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule'; // Tu servicio que accede a la BD
import { ShipmentsService } from 'src/shipments/shipments.service';
import { UnloadingService } from 'src/unloading/unloading.service';


@Injectable()
export class TrackingCronService {
  private readonly logger = new Logger(TrackingCronService.name);

  constructor(
    private readonly shipmentService: ShipmentsService,
    private readonly unloadingService: UnloadingService
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    const globalStart = Date.now();    
    this.logger.log('🕐 Iniciando verificación de envíos (Normales y F2)...');
    
    try {
      // 1. Obtención de datos en paralelo
      const [shipments, chargeShipments] = await Promise.all([
        this.shipmentService.getShipmentsToValidate(),
        this.shipmentService.getSimpleChargeShipments()
      ]);

      if (shipments.length === 0 && chargeShipments.length === 0) {
        this.logger.log('📪 No hay envíos ni F2 para procesar.');
        return;
      }

      this.logger.log(`📊 Total a procesar: ${shipments.length} normales y ${chargeShipments.length} F2`);

      // 2. FASE 1: Envíos Normales
      if (shipments.length > 0) {
        const startF1 = Date.now();
        this.logger.log('🚀 [FASE 1] Iniciando actualización de Envíos Normales...');
        
        await this.shipmentService.processMasterFedexUpdate(shipments);
        
        const durationF1 = ((Date.now() - startF1) / 1000 / 60).toFixed(2);
        this.logger.log(`✅ [FASE 1] Finalizada en ${durationF1} minutos.`);
      }

      // 3. FASE 2: ChargeShipments (F2)
      if (chargeShipments.length > 0) {
        const startF2 = Date.now();
        this.logger.log('🚀 [FASE 2] Iniciando actualización de ChargeShipments (F2)...');
        this.logger.log(`📝 Nota: Se generará historial en shipment_status para ${chargeShipments.length} cargos.`);
        
        await this.shipmentService.processChargeFedexUpdate(chargeShipments); 
        
        const durationF2 = ((Date.now() - startF2) / 1000 / 60).toFixed(2);
        this.logger.log(`✅ [FASE 2] Finalizada en ${durationF2} minutos.`);
      }

      // Resumen Final
      const totalDurationMin = ((Date.now() - globalStart) / 1000 / 60).toFixed(2);
      const totalCount = shipments.length + chargeShipments.length;
      
      this.logger.log(`🏁 Sincronización TOTAL finalizada con éxito.`);
      this.logger.log(`✅ Detalle final: ${totalCount} trackings procesados en ${totalDurationMin} minutos.`);

    } catch (err) {
      this.logger.error(`❌ Error fatal en handleCron: ${err.message}`);
    }
  }

  @Cron('0 0 1 * * 1-6', { timeZone: 'America/Hermosillo' })
  async handleUpdatePriotiry() {
    this.logger.log('🕐 Ejecutando actualización de prioridades...');
    await this.shipmentService.updatePriorities();
  }

  @Cron('0 0 8 * * 1-6', { timeZone: 'America/Hermosillo' })
  async handleSendPriorityShipments() {
    this.logger.log('🕐 Ejecutando el envío de correo con envíos que deben ser prioritarios...');
    await this.shipmentService.sendEmailWithHighPriorities();
  }

  
  @Cron('0 0 8,10,12,14,16,18,20,22 * * 1-6', {
    timeZone: 'America/Hermosillo'
  })
  async handleSendShipmentWithStatus03(){
    /** Por ahora solo cabos */
    this.logger.log('🕐 Ejecutando el envio de correo con Enviós DEX03...');
    const subdiaryId = 'abf2fc38-cb42-41b6-9554-4b71c11b8916'
    await this.shipmentService.getShipmentsWithStatus03(subdiaryId);
  }

  @Cron('0 15,17 * * 1-6', {
    timeZone: 'America/Hermosillo',
  })
  async handleUnloadingMonitoring() {
    this.logger.log(`🕐 Ejecutando envío de correo de monitoreo de desembarque`);

    try {
      await this.unloadingService.sendUnloadingReport();
      this.logger.log('✅ Envío de monitoreo de desembarque completado.');
    } catch (error) {
      this.logger.error('❌ Error al enviar el reporte de monitoreo:', error);
    }
  }
}



