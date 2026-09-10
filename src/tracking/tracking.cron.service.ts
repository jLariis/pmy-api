import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule'; // Tu servicio que accede a la BD
import { isCutoverEnabled } from 'src/tracking-sync/cutover.config';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { UnloadingService } from 'src/unloading/unloading.service';
import { DhlService } from 'src/shipments/dhl.service';


@Injectable()
export class TrackingCronService implements OnModuleInit {
  private readonly logger = new Logger(TrackingCronService.name);

  /**
   * Guard de re-entrada: si la corrida anterior aún no termina (puede tardar
   * más de 1 hora con miles de guías), NO arrancamos otra encima. Cubre las 3
   * fases (FedEx normales, FedEx F2 y DHL), que corren en secuencia.
   */
  private isRunning = false;

  /** Tope de guías DHL por ciclo (guía maestra). Sin rate limit: default alto. */
  private readonly dhlPollCap = Number(process.env.DHL_POLL_CAP) || 100000;

  constructor(
    private readonly shipmentService: ShipmentsService,
    private readonly unloadingService: UnloadingService,
    private readonly dhlService: DhlService,
  ) {}

  /**
   * Confirma en los logs, al arrancar, que los crons quedaron programados.
   * Útil para verificar tras un deploy/restart sin esperar al disparo.
   */
  onModuleInit() {
    this.logger.log('⏰ Crons de tracking programados:');
    this.logger.log('   📦 FedEx + 🚚 DHL: cada hora en punto (:00), con la API oficial de cada paquetería.');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    // CUTOVER (F3/F4): si el motor por eventos está en persistente, el legacy se APAGA
    // para no doble-escribir estatus/cobros. DEFAULT OFF → corre normal.
    if (isCutoverEnabled()) {
      this.logger.log('🔀 [legacy] cutover activo: el motor por eventos maneja estatus/cobros; se omite el cron legacy.');
      return;
    }
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
        this.logger.log('📪 No hay envíos FedEx ni F2 para procesar; continúo con DHL.');
      }

      this.logger.log(`📊 Total a procesar: ${shipments.length} normales y ${chargeShipments.length} F2 (+ DHL abajo)`);

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

      // 4. FASE 3: DHL (API oficial) — mismo cron horario, tras FedEx.
      const startF3 = Date.now();
      this.logger.log('🚀 [FASE 3] Iniciando actualización de guías DHL (API oficial)...');
      const dhlToPoll = await this.shipmentService.getDhlToPollNative(this.dhlPollCap);
      if (dhlToPoll.length > 0) {
        const numbers = dhlToPoll.map((d) => d.trackingNumber);
        const dhlResults = await this.dhlService.trackBatch(numbers);
        const dhlSummary = await this.shipmentService.persistDhlNativeResults(dhlResults);
        const durationF3 = ((Date.now() - startF3) / 1000 / 60).toFixed(2);
        this.logger.log(
          `✅ [FASE 3] DHL finalizada en ${durationF3} min. ` +
          `Guías: ${numbers.length} | actualizadas: ${dhlSummary.updated.length} | ` +
          `sin datos: ${dhlSummary.notFound.length} | errores: ${dhlSummary.errors.length}`
        );
      } else {
        this.logger.log('📭 [FASE 3] No hay guías DHL activas por rastrear.');
      }

      // Resumen Final
      const totalDurationMin = ((Date.now() - globalStart) / 1000 / 60).toFixed(2);
      const totalCount = shipments.length + chargeShipments.length + dhlToPoll.length;

      this.logger.log(`🏁 Sincronización TOTAL finalizada con éxito.`);
      this.logger.log(`✅ Detalle final: ${totalCount} trackings procesados en ${totalDurationMin} minutos.`);

    } catch (err) {
      this.logger.error(`❌ Error fatal en handleCron: ${err.message}`);
    } finally {
      this.isRunning = false;
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



