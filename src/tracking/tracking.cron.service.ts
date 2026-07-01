import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule'; // Tu servicio que accede a la BD
import { ShipmentsService } from 'src/shipments/shipments.service';
import { UnloadingService } from 'src/unloading/unloading.service';
import { WhereParcelDhlService } from 'src/tracking/where-parcel-dhl.service';
import { runDhlTrackingCycle, runDhlWebhookRegistrationCycle } from 'src/tracking/dhl-tracking-cycle';


@Injectable()
export class TrackingCronService implements OnModuleInit {
  private readonly logger = new Logger(TrackingCronService.name);

  /**
   * Guard de re-entrada: si la corrida anterior aún no termina (puede tardar
   * más de 1 hora con miles de guías), NO arrancamos otra encima. Evita doble
   * carga a FedEx, contención de locks y 429 por solapamiento.
   */
  private isRunning = false;
  /** Guard de re-entrada para el polling de respaldo DHL. */
  private isRunningDhl = false;
  /** Guard de re-entrada para el registro a webhooks DHL. */
  private isRunningDhlReg = false;

  /** Tope de guías por ciclo de POLLING de respaldo (bajo, es solo red de seguridad). */
  private readonly dhlPollCap = Number(process.env.WHEREPARCEL_FALLBACK_POLL_CAP) || 50;
  /** Tope de guías por ciclo de REGISTRO a webhooks (lotes de 500 en el servicio). */
  private readonly dhlRegisterCap = Number(process.env.WHEREPARCEL_REGISTER_CAP) || 500;

  constructor(
    private readonly shipmentService: ShipmentsService,
    private readonly unloadingService: UnloadingService,
    private readonly whereParcelService: WhereParcelDhlService,
  ) {}

  /**
   * Confirma en los logs, al arrancar, que los crons quedaron programados.
   * Útil para verificar tras un deploy/restart sin esperar al disparo.
   */
  onModuleInit() {
    this.logger.log('⏰ Crons de tracking programados:');
    this.logger.log('   📦 FedEx: cada hora en punto (:00).');
    this.logger.log(`   🚚 DHL/WhereParcel: registro a webhooks cada hora :30 (tope ${this.dhlRegisterCap}); polling de respaldo 1×/día 05:00 (tope ${this.dhlPollCap}) — America/Hermosillo.`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    if (this.isRunning) {
      this.logger.warn('⏭️ La corrida anterior sigue en curso; se omite este disparo del cron.');
      return;
    }
    this.isRunning = true;

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

        const masterSummary = await this.shipmentService.processMasterFedexUpdate(shipments);

        const durationF1 = ((Date.now() - startF1) / 1000 / 60).toFixed(2);
        this.logger.log(
          `✅ [FASE 1] Finalizada en ${durationF1} min. ` +
          `OK: ${masterSummary.ok} | Sin datos: ${masterSummary.noData} | Fallidas: ${masterSummary.failed}/${masterSummary.total}`
        );
      }

      // 3. FASE 2: ChargeShipments (F2)
      if (chargeShipments.length > 0) {
        const startF2 = Date.now();
        this.logger.log('🚀 [FASE 2] Iniciando actualización de ChargeShipments (F2)...');
        this.logger.log(`📝 Nota: Se generará historial en shipment_status para ${chargeShipments.length} cargos.`);

        const chargeSummary = await this.shipmentService.processChargeFedexUpdate(chargeShipments);

        const durationF2 = ((Date.now() - startF2) / 1000 / 60).toFixed(2);
        this.logger.log(
          `✅ [FASE 2] Finalizada en ${durationF2} min. ` +
          `OK: ${chargeSummary.ok} | Sin datos: ${chargeSummary.noData} | Fallidas: ${chargeSummary.failed}/${chargeSummary.total}`
        );
      }

      // Resumen Final
      const totalDurationMin = ((Date.now() - globalStart) / 1000 / 60).toFixed(2);
      const totalCount = shipments.length + chargeShipments.length;
      
      this.logger.log(`🏁 Sincronización TOTAL finalizada con éxito.`);
      this.logger.log(`✅ Detalle final: ${totalCount} trackings procesados en ${totalDurationMin} minutos.`);

    } catch (err) {
      this.logger.error(`❌ Error fatal en handleCron: ${err.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * MECANISMO PRINCIPAL: registra guías DHL nuevas a webhooks de WhereParcel
   * (cada hora al minuto 30). Tras registrarlas, WhereParcel EMPUJA los cambios
   * de estatus a nuestro callback (sin polling). Barato e idempotente.
   */
  @Cron('0 30 * * * *', { timeZone: 'America/Hermosillo' })
  async handleDhlWebhookRegisterCron() {
    if (this.isRunningDhlReg) {
      this.logger.warn('⏭️ Cron DHL (registro webhook): la corrida anterior sigue en curso; se omite.');
      return;
    }
    this.isRunningDhlReg = true;
    this.logger.log('🕐 [DHL/webhook] Registrando guías nuevas a webhooks...');
    try {
      await runDhlWebhookRegistrationCycle(this.shipmentService, this.whereParcelService, this.dhlRegisterCap, this.logger);
    } catch (err) {
      this.logger.error(`❌ Error en handleDhlWebhookRegisterCron: ${err.message}`);
    } finally {
      this.isRunningDhlReg = false;
    }
  }

  /**
   * RESPALDO de baja frecuencia (1×/día, 05:00): consulta por polling unas pocas
   * guías DHL no terminales, por si se perdió algún webhook. Tope bajo para no
   * gastar cuota ni sufrir la lentitud del scraping.
   */
  @Cron('0 0 5 * * *', { timeZone: 'America/Hermosillo' })
  async handleDhlFallbackPollCron() {
    if (this.isRunningDhl) {
      this.logger.warn('⏭️ Cron DHL (respaldo): la corrida anterior sigue en curso; se omite.');
      return;
    }
    this.isRunningDhl = true;
    this.logger.log('🕐 [DHL/WhereParcel] Polling de respaldo (1×/día)...');
    try {
      await runDhlTrackingCycle(this.shipmentService, this.whereParcelService, this.dhlPollCap, this.logger);
    } catch (err) {
      this.logger.error(`❌ Error en handleDhlFallbackPollCron: ${err.message}`);
    } finally {
      this.isRunningDhl = false;
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



