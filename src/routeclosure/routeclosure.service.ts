import { Injectable, Logger, BadRequestException, InternalServerErrorException  } from '@nestjs/common';
import { CreateRouteclosureDto } from './dto/create-routeclosure.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { DataSource, Repository } from 'typeorm';
import { ValidateTrackingsForClosureDto } from './dto/validate-trackings-for-closure';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ShipmentStatus, Collection, Shipment, Income, ChargeShipment, ShipmentNotInFiles } from 'src/entities';
import { DispatchStatus } from 'src/common/enums/dispatch-enum';
import { MailService } from 'src/mail/mail.service';
import { fromZonedTime } from 'date-fns-tz';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { FedexService } from 'src/shipments/fedex.service';

@Injectable()
export class RouteclosureService {
  private readonly logger = new Logger(RouteclosureService.name);

  constructor(
    @InjectRepository(RouteClosure)
    private readonly routeClouseRepository: Repository<RouteClosure>,
    @InjectRepository(PackageDispatch)
    private readonly packageDispatchRepository: Repository<PackageDispatch>,
    @InjectRepository(Income)
    private readonly mailService: MailService,
    private readonly fedexService: FedexService,
    private readonly dataSource: DataSource
  ) {}

  async create(createRouteclosureDto: CreateRouteclosureDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      this.logger.log('🟡 [RouteClosure] Iniciando proceso de cierre de ruta...');

      // 1. Validar el Despacho
      const packageDispatch = await queryRunner.manager.findOne(PackageDispatch, {
        where: { id: createRouteclosureDto.packageDispatch.id },
        relations: ['subsidiary'],
      });

      if (!packageDispatch) {
        throw new BadRequestException(`El despacho con ID ${createRouteclosureDto.packageDispatch.id} no existe.`);
      }

      // 2. Actualizar estado del Despacho
      packageDispatch.status = DispatchStatus.COMPLETADA;
      packageDispatch.closedAt = new Date();
      await queryRunner.manager.save(PackageDispatch, packageDispatch);

      // 3. Preparar datos para RouteClosure
      const trackingNumbers = createRouteclosureDto.collections.map(item => 
        typeof item === 'string' ? item : (item as any).trackingNumber
      );

      // Filtramos los arreglos usando la propiedad isCharge para evitar errores de FK
      // 1. Filtramos los POD: Solo dejamos lo que NO es Charge y NO es No VAN
      const validPodShipments = createRouteclosureDto.podPackages
        .filter(pkg => {
          const isCharge = (pkg as any).isCharge;
          const isNoVan = typeof (pkg as any).id === 'string' && (pkg as any).id.startsWith('novan-');
          // SOLO permitimos los que existen en la tabla 'shipment'
          return !isCharge && !isNoVan;
        })
        .map(pkg => ({ id: typeof pkg === 'string' ? pkg : (pkg as any).id }));

      const validReturnedShipments = createRouteclosureDto.returnedPackages
        .filter(pkg => {
          const isCharge = (pkg as any).isCharge;
          const isNoVan = typeof (pkg as any).id === 'string' && (pkg as any).id.startsWith('novan-');
          return !isCharge && !isNoVan;
        })
        .map(pkg => ({ id: typeof pkg === 'string' ? pkg : (pkg as any).id }));

      const newRouteClosure = queryRunner.manager.create(RouteClosure, {
        ...createRouteclosureDto,
        podPackages: validPodShipments, 
        returnedPackages: validReturnedShipments, 
        collections: trackingNumbers,
        subsidiary: packageDispatch.subsidiary,
      });

      const savedClosure = await queryRunner.manager.save(RouteClosure, newRouteClosure);

      // =====================================================================
      // 🛡️ GUARDAR PAQUETES NO VAN (ShipmentNotInFiles)
      // =====================================================================
      if (createRouteclosureDto.noVanPackages && createRouteclosureDto.noVanPackages.length > 0) {
        this.logger.log(`🟡 [RouteClosure] Registrando ${createRouteclosureDto.noVanPackages.length} paquetes No VAN...`);
        
        const noVanEntities = createRouteclosureDto.noVanPackages.map(pkg => {
          // Extraemos el tracking independientemente de si pkg viene como objeto o string (por seguridad)
          const tNumber = typeof pkg === 'string' ? pkg : (pkg as any).trackingNumber;

          return queryRunner.manager.create(ShipmentNotInFiles, {
            trackingNumber: tNumber,
            subsidiary: packageDispatch.subsidiary,
            subsidiaryId: packageDispatch.subsidiary.id
          });
        });

        // Faltaría agregar el ingreso de los paquetes que cumplan como lo hace para agregar los de DHL

        await queryRunner.manager.save(ShipmentNotInFiles, noVanEntities);
        this.logger.log(`🟢 [RouteClosure] ${noVanEntities.length} registros insertados en shipment_not_in_files.`);
      }

      // 4. Crear registros independientes en la tabla 'Collection'
      if (trackingNumbers.length > 0) {
        const now = new Date();
        const utcDate = fromZonedTime(now, 'America/Hermosillo');
        const collectionsToInsert = trackingNumbers.map(tn => {
          return queryRunner.manager.create(Collection, {
            trackingNumber: tn,
            subsidiary: packageDispatch.subsidiary,
            status: 'COLECTADO_EN_CIERRE', 
            isPickUp: true,
            createdAt: utcDate
          });
        });

        await queryRunner.manager.save(Collection, collectionsToInsert);
        this.logger.log(`🟢 [RouteClosure] Se insertaron ${collectionsToInsert.length} registros en la tabla Collection.`);
      }

      // ==========================================
      // 5. PROCESAR PAQUETES DHL (Cobros y Estatus)
      // ==========================================
      this.logger.log('🟡 [RouteClosure] Evaluando paquetes DHL para actualización e ingresos...');
      const currentDatetime = new Date().toISOString().slice(0, 19).replace('T', ' ');

      const packagesToProcess = [
        ...createRouteclosureDto.podPackages.map(pkg => ({
          id: typeof pkg === 'string' ? pkg : (pkg as any).id,
          status: (pkg as any).status,
          isCharge: (pkg as any).isCharge, 
          isDelivered: true,
        })),
        ...createRouteclosureDto.returnedPackages.map(pkg => ({
          id: typeof pkg === 'string' ? pkg : (pkg as any).id,
          status: (pkg as any).status,
          isCharge: (pkg as any).isCharge, 
          isDelivered: false,
        }))
      ];

      let processedDhlCount = 0;

      for (const item of packagesToProcess) {
        if (!item.id) continue;

        let pPackage = null;

        if (item.isCharge) {
          pPackage = await queryRunner.manager.findOne(ChargeShipment, { 
            where: { id: item.id },
            relations: ['subsidiary'] 
          });
        } else {
          pPackage = await queryRunner.manager.findOne(Shipment, { 
            where: { id: item.id },
            relations: ['subsidiary'] 
          });
        }
        
        if (pPackage && pPackage.shipmentType === ShipmentType.DHL) {
          processedDhlCount++;
          const finalStatus = item.status || pPackage.status; 
          
          const existingIncome = await queryRunner.manager.findOne(Income, {
            where: {
              trackingNumber: pPackage.trackingNumber,
              sourceType: IncomeSourceType.SHIPMENT
            }
          });

          if (existingIncome) {
            this.logger.warn(`⚠️ [RouteClosure] El ingreso para el tracking DHL ${pPackage.trackingNumber} ya existe. Omitiendo cobro.`);
          } else {
            let chargeCost = false;
            let nonDeliveryStatusCode = null;
            
            const incomeType = item.isDelivered ? IncomeStatus.ENTREGADO : IncomeStatus.NO_ENTREGADO;

            if (item.isDelivered) {
              chargeCost = true;
            } else {
              const nonDeliveryCodes: Record<string, string> = {
                [ShipmentStatusType.RECHAZADO]: '07',
                [ShipmentStatusType.DIRECCION_INCORRECTA]: '03',
                [ShipmentStatusType.CLIENTE_NO_DISPONIBLE]: '08',
              };
              
              if (nonDeliveryCodes[finalStatus]) {
                chargeCost = true;
                nonDeliveryStatusCode = nonDeliveryCodes[finalStatus];
              }
            }

            const calculatedCost = chargeCost ? (pPackage.subsidiary?.dhlCostPackage ?? 0) : 0;

            const newIncome = queryRunner.manager.create(Income, {
              trackingNumber: pPackage.trackingNumber,
              subsidiary: pPackage.subsidiary, 
              shipmentType: pPackage.shipmentType,
              cost: calculatedCost,
              incomeType: incomeType, 
              nonDeliveryStatus: nonDeliveryStatusCode,
              isGrouped: false,
              sourceType: IncomeSourceType.SHIPMENT,
              shipment: pPackage,
              date: currentDatetime 
            });

            await queryRunner.manager.save(Income, newIncome);
          }

          if (item.isCharge) {
            await queryRunner.manager.update(ChargeShipment, { id: item.id }, { status: finalStatus });  
          } else {
            await queryRunner.manager.update(Shipment, { id: item.id }, { status: finalStatus });  
          }
        }
      }

      this.logger.log(`🟢 [RouteClosure] Se procesaron ${processedDhlCount} paquetes de DHL.`);

      // 6. Finalizar transacción
      await queryRunner.commitTransaction();
      this.logger.log(`✅ [RouteClosure] Cierre de ruta completado con éxito: ${savedClosure.id}`);

      return savedClosure;

    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`🔴 [RouteClosure] Error crítico procesando el cierre: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Error al procesar el cierre: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(subsidiaryId: string) {
    return await this.routeClouseRepository.find({
      where: {
        subsidiary: {
          id: subsidiaryId
        }
      }
    });
  }

  async findOne(id: string) {
    return await this.routeClouseRepository.findOne({
      where: {
        id
      }
    });
  }

  async validateTrackingNumbersForClosure(
    validateTrackingForClosure: ValidateTrackingsForClosureDto
  ) {
    const validatedPackages: ValidatedPackageDispatchDto[] = [];
    const podPackages: ValidatedPackageDispatchDto[] = [];

    const packageDispatch = await this.packageDispatchRepository.findOne({
      where: { id: validateTrackingForClosure.packageDispatchId },
      relations: [
        'shipments', 
        'shipments.statusHistory', 
        'shipments.payment',
        'chargeShipments', 
        'chargeShipments.statusHistory',
        'chargeShipments.payment'
      ],
    });

    // Primero validamos los trackings enviados
    for (const tracking of validateTrackingForClosure.trackingNumbers) {
      let isValid = true;
      let reason = '';
      let lastHistory: ShipmentStatus;

      const foundTracking = packageDispatch.shipments.find(
        (s) => s.trackingNumber === tracking
      );

      if (!foundTracking) {
        isValid = false;
        reason = 'no encontró el número de guía en la salida a ruta';
      } else if (foundTracking.status === ShipmentStatusType.ENTREGADO) {
        isValid = false;
        reason = 'el número de guía ya fue entregado';
      } else if (foundTracking.status === ShipmentStatusType.NO_ENTREGADO) {
        const orderedHistory = foundTracking.statusHistory.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        lastHistory = orderedHistory[0];

        const hasValidDex =
          lastHistory &&
          lastHistory.status === ShipmentStatusType.NO_ENTREGADO &&
          ['03', '07', '08'].includes(lastHistory.exceptionCode);

        if (!hasValidDex) {
          isValid = false;
          reason = 'el paquete no tiene un DEX válido en su última historia (03, 07 o 08)';
        }
      }

      validatedPackages.push({
        id: foundTracking?.id,
        trackingNumber: foundTracking?.trackingNumber ?? tracking,
        commitDateTime: foundTracking?.commitDateTime,
        consNumber: foundTracking?.consNumber,
        isHighValue: foundTracking?.isHighValue,
        priority: foundTracking?.priority,
        recipientAddress: foundTracking?.recipientAddress,
        recipientCity: foundTracking?.recipientCity,
        recipientName: foundTracking?.recipientName,
        recipientPhone: foundTracking?.recipientPhone,
        recipientZip: foundTracking?.recipientZip,
        shipmentType: foundTracking?.shipmentType,
        subsidiary: foundTracking?.subsidiary,
        status: foundTracking?.status,
        isValid,
        reason,
        payment: foundTracking?.payment,
        lastHistory,
      });
    }

    // Ahora agregamos a podPackages los que NO fueron enviados pero ya están entregados
    const userTrackingsSet = new Set(validateTrackingForClosure.trackingNumbers);

    for (const s of packageDispatch.shipments) {
      if (!userTrackingsSet.has(s.trackingNumber) && s.status === ShipmentStatusType.ENTREGADO) {
        podPackages.push({
          id: s.id,
          trackingNumber: s.trackingNumber,
          commitDateTime: s.commitDateTime,
          consNumber: s.consNumber,
          isHighValue: s.isHighValue,
          priority: s.priority,
          recipientAddress: s.recipientAddress,
          recipientCity: s.recipientCity,
          recipientName: s.recipientName,
          recipientPhone: s.recipientPhone,
          recipientZip: s.recipientZip,
          shipmentType: s.shipmentType,
          subsidiary: s.subsidiary,
          status: s.status,
          isValid: true,
          reason: 'Paquete ya entregado',
          payment: s.payment,
        });
      }
    }

    return { validatedPackages, podPackages };
  }

  async validateTrackingNumbersNoVan(noVanTrackingNumbers: string[]) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      return await Promise.all(
        noVanTrackingNumbers.map(async (tn) => {
          // 1. Obtener el mejor estatus de FedEx con arbitraje Header vs Scans
          const fedexStatus = await this.getBestFedexStatus(tn);
          
          // 2. Buscar en BD local para metadata (isCharge)
          const dbInfo = await this.findPackageInLocalDB(queryRunner, tn);

          const isValid = !!fedexStatus || !!dbInfo;

          // 3. Normalización de estatus (Traducción a "entregado")
          let rawStatus = (fedexStatus || dbInfo?.status || 'NOT_FOUND').toLowerCase();
          
          if (rawStatus.includes('delivered') || rawStatus.includes('delivery')) {
            rawStatus = 'Entregado';
          }

          return {
            trackingNumber: tn,
            isValid,
            status: rawStatus,
            isCharge: dbInfo?.isCharge || false,
            reason: isValid ? null : 'Guía no encontrada en FedEx ni en Sistema'
          };
        })
      );
    } finally {
      await queryRunner.release();
    }
  }

  private async getBestFedexStatus(trackingNumber: string): Promise<string | null> {
    try {
      let response = await this.fedexService.trackPackage(trackingNumber);
      let results = response?.output?.completeTrackResults?.[0]?.trackResults || [];

      // 1. Manejo de reintentos
      const isLabelOnly = results.some(r => r.latestStatusDetail?.code === 'OC' && (r.scanEvents?.length || 0) <= 1);
      if (results.length === 0 || isLabelOnly) {
        const retry = await this.fedexService.trackPackage(trackingNumber, undefined);
        results = retry?.output?.completeTrackResults?.[0]?.trackResults || results;
      }

      if (results.length === 0) return null;

      // 2. Selección de la generación (UniqueID)
      if (results.length > 1) {
        results.sort((a, b) => {
          const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
          const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
          return seqB - seqA;
        });
      }

      const winner = results[0];

      // =================================================================================
      // 🛡️ EXTRACCIÓN DE ESTATUS Y CÓDIGOS DE EXCEPCIÓN
      // =================================================================================
      
      // Obtenemos los scans ordenados para tener la "verdad" del terreno
      const scans = winner.scanEvents || [];
      const sortedScans = [...scans].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const latestScan = sortedScans[0];

      // Datos del Header
      const headerCode = winner.latestStatusDetail?.code; // Ej: "DE"
      const headerDesc = (winner.latestStatusDetail?.description || '').trim();

      // Si es una excepción ("DE" - Delivery Exception), buscamos el código específico (07, 03, etc.)
      if (headerCode === 'DE' || latestScan?.eventType === 'DE') {
        // Prioridad 1: Código en el Scan más reciente
        // Prioridad 2: Motivo en Ancillary Details del Header
        const specificCode = latestScan?.exceptionCode || winner.latestStatusDetail?.ancillaryDetails?.[0]?.reason;
        
        if (specificCode) {
          this.logger.log(`[NoVan:${trackingNumber}] Excepción detectada. Código: ${specificCode}`);
          return `DEX ${specificCode}`; // Retornamos "DEX 07", "DEX 03", etc.
        }
      }

      // --- ARBITRAJE ESTÁNDAR SI NO ES EXCEPCIÓN ---
      const headerStatus = (winner.latestStatusDetail?.statusByLocale || winner.latestStatusDetail?.description || '').trim();
      const scanStatus = (latestScan?.derivedStatus || latestScan?.eventDescription || '').trim();

      if (scanStatus && headerStatus.toLowerCase() !== scanStatus.toLowerCase()) {
        return scanStatus;
      }

      return headerStatus || scanStatus || 'UNKNOWN';

    } catch (error) {
      this.logger.error(`[NoVan:${trackingNumber}] Error en arbitraje: ${error.message}`);
      return null;
    }
  }

  private async findPackageInLocalDB(queryRunner: any, tn: string) {
    const tables = ['shipment', 'charge_shipment'];
    for (const table of tables) {
      const res = await queryRunner.query(
        `SELECT status FROM ${table} WHERE trackingNumber = ? ORDER BY createdAt DESC LIMIT 1`,
        [tn]
      );
      if (res.length > 0) return { status: res[0].status, isCharge: table === 'charge_shipment' };
    }
    return null;
}

  async sendByEmail(pdfFile: Express.Multer.File, excelFile: Express.Multer.File, routeClosureId: string){
    const routeClosure = await this.routeClouseRepository.findOne(
      { 
        where: {
          id: routeClosureId
        },
        relations: ['subsidiary', 'packageDispatch', 'packageDispatch.drivers']
      });

    return await this.mailService.sendHighPriorityRouteClosureEmail(pdfFile, excelFile, routeClosure);
  }

  async remove(id: string) {
    return await this.routeClouseRepository.delete(id);
  }
}
