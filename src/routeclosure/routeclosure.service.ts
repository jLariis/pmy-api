import { Injectable, Logger, BadRequestException, InternalServerErrorException  } from '@nestjs/common';
import { CreateRouteclosureDto } from './dto/create-routeclosure.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { DataSource, Repository } from 'typeorm';
import { ValidateTrackingsForClosureDto } from './dto/validate-trackings-for-closure';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ShipmentStatus, Collection, Shipment, Income, ChargeShipment } from 'src/entities';
import { DispatchStatus } from 'src/common/enums/dispatch-enum';
import { MailService } from 'src/mail/mail.service';
import { fromZonedTime } from 'date-fns-tz';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';

@Injectable()
export class RouteclosureService {
  private readonly logger = new Logger(RouteclosureService.name);

  constructor(
    @InjectRepository(RouteClosure)
    private readonly routeClouseRepository: Repository<RouteClosure>,
    @InjectRepository(PackageDispatch)
    private readonly packageDispatchRepository: Repository<PackageDispatch>,
    @InjectRepository(Income)
    private readonly incomeRepository: Repository<Income>,
    private readonly mailService: MailService,
    private readonly dataSource: DataSource
  ) {}

  async createResp0805(createRouteclosureDto: CreateRouteclosureDto) {
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
      // Según tu entidad, 'collections' es string[] (JSON en la BD)
      // Aseguramos que si vienen objetos, solo guardemos el string del tracking
      const trackingNumbers = createRouteclosureDto.collections.map(item => 
        typeof item === 'string' ? item : (item as any).trackingNumber
      );

      const newRouteClosure = queryRunner.manager.create(RouteClosure, {
        ...createRouteclosureDto,
        collections: trackingNumbers, // Se guarda como JSON en la tabla route_closure
        subsidiary: packageDispatch.subsidiary,
      });

      const savedClosure = await queryRunner.manager.save(RouteClosure, newRouteClosure);

      // 4. Crear registros independientes en la tabla 'Collection'
      if (trackingNumbers.length > 0) {
        const now = new Date();
        const utcDate = fromZonedTime(now, 'America/Hermosillo');
        const collectionsToInsert = trackingNumbers.map(tn => {
          return queryRunner.manager.create(Collection, {
            trackingNumber: tn,
            subsidiary: packageDispatch.subsidiary,
            status: 'COLECTADO_EN_CIERRE', // O el status que prefieras por defecto
            isPickUp: true,
            createdAt: utcDate // Fecha Hermosillo
          });
        });

        await queryRunner.manager.save(Collection, collectionsToInsert);
        this.logger.log(`🟢 Se insertaron ${collectionsToInsert.length} registros en la tabla Collection.`);
      }



      // 5. Finalizar transacción
      await queryRunner.commitTransaction();
      this.logger.log(`✅ Cierre de ruta completado con éxito: ${savedClosure.id}`);

      return savedClosure;

    } catch (error) {
      // Revertir todo si algo falla
      await queryRunner.rollbackTransaction();
      this.logger.error(`🔴 Error en RouteClosure: ${error.message}`);
      throw new InternalServerErrorException(`Error al procesar el cierre: ${error.message}`);
    } finally {
      // Liberar conexión
      await queryRunner.release();
    }
  }

  async createResp0805_2(createRouteclosureDto: CreateRouteclosureDto) {
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

      const newRouteClosure = queryRunner.manager.create(RouteClosure, {
        ...createRouteclosureDto,
        collections: trackingNumbers,
        subsidiary: packageDispatch.subsidiary,
      });

      const savedClosure = await queryRunner.manager.save(RouteClosure, newRouteClosure);

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
          isDelivered: true,
        })),
        ...createRouteclosureDto.returnedPackages.map(pkg => ({
          id: typeof pkg === 'string' ? pkg : (pkg as any).id,
          status: (pkg as any).status,
          isDelivered: false,
        }))
      ];

      let processedDhlCount = 0;

      for (const item of packagesToProcess) {
        if (!item.id) continue;

        // IMPORTANTE: Se añade la relación 'subsidiary' para poder leer dhlCostPackage
        const pPackage = await queryRunner.manager.findOne(Shipment, { 
          where: { id: item.id },
          relations: ['subsidiary'] 
        });
        
        if (pPackage && pPackage.shipmentType === ShipmentType.DHL) {
          processedDhlCount++;
          const finalStatus = item.status || pPackage.status; 
          
          // 5.1 Validar si el Income ya existe para evitar duplicidad
          const existingIncome = await queryRunner.manager.findOne(Income, {
            where: {
              trackingNumber: pPackage.trackingNumber,
              sourceType: IncomeSourceType.SHIPMENT
            }
          });

          if (existingIncome) {
            this.logger.warn(`⚠️ [RouteClosure] El ingreso para el tracking DHL ${pPackage.trackingNumber} ya existe. Omitiendo cobro.`);
          } else {
            // 5.2 Lógica de cobro y códigos de no entrega
            let chargeCost = false;
            let nonDeliveryStatusCode = null; // Variable para almacenar el código '07', '03', etc.
            
            const incomeType = item.isDelivered ? IncomeStatus.ENTREGADO : IncomeStatus.NO_ENTREGADO;

            if (item.isDelivered) {
              chargeCost = true;
            } else {
              // Diccionario de códigos para paquetes no entregados
              const nonDeliveryCodes: Record<string, string> = {
                [ShipmentStatusType.RECHAZADO]: '07',
                [ShipmentStatusType.DIRECCION_INCORRECTA]: '03',
                [ShipmentStatusType.CLIENTE_NO_DISPONIBLE]: '08',
              };
              
              // Si el estatus final está en nuestro diccionario, asignamos el código y marcamos para cobro
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
              nonDeliveryStatus: nonDeliveryStatusCode, // <--- Aquí inyectamos el nuevo código
              isGrouped: false,
              sourceType: IncomeSourceType.SHIPMENT,
              shipment: pPackage,
              date: currentDatetime 
            });

            await queryRunner.manager.save(Income, newIncome);
            this.logger.log(`🟢 [RouteClosure] Ingreso creado para DHL ${pPackage.trackingNumber} | Tipo: ${incomeType} | Costo: $${calculatedCost} | Código DEX: ${nonDeliveryStatusCode || 'N/A'}`);
          }

          // 5.3 Actualizar el Shipment con su estatus EXACTO (independientemente de si el cobro existía o no)
          await queryRunner.manager.update(Shipment, { id: item.id }, { status: finalStatus });  
        }
      }

      this.logger.log(`🟢 [RouteClosure] Se procesaron y actualizaron ${processedDhlCount} paquetes de DHL.`);

      // 6. Finalizar transacción
      await queryRunner.commitTransaction();
      this.logger.log(`✅ [RouteClosure] Cierre de ruta completado con éxito: ${savedClosure.id}`);

      return savedClosure;

    } catch (error) {
      // Revertir absolutamente todo (Collections, RouteClosure, Incomes y Shipments) si algo falla
      await queryRunner.rollbackTransaction();
      this.logger.error(`🔴 [RouteClosure] Error crítico procesando el cierre: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Error al procesar el cierre: ${error.message}`);
    } finally {
      // Liberar conexión siempre
      await queryRunner.release();
    }
  }

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

      // =====================================================================
      // 🛡️ SOLUCIÓN FK: Filtramos los arreglos usando la propiedad isCharge
      // Evitamos que los ChargeShipments rompan la tabla intermedia de Shipments
      // =====================================================================
      const validPodShipments = createRouteclosureDto.podPackages
        .filter(pkg => !(pkg as any).isCharge)
        .map(pkg => ({ id: typeof pkg === 'string' ? pkg : (pkg as any).id }));

      const validReturnedShipments = createRouteclosureDto.returnedPackages
        .filter(pkg => !(pkg as any).isCharge)
        .map(pkg => ({ id: typeof pkg === 'string' ? pkg : (pkg as any).id }));

      const newRouteClosure = queryRunner.manager.create(RouteClosure, {
        ...createRouteclosureDto,
        podPackages: validPodShipments, 
        returnedPackages: validReturnedShipments, 
        collections: trackingNumbers,
        subsidiary: packageDispatch.subsidiary,
      });

      const savedClosure = await queryRunner.manager.save(RouteClosure, newRouteClosure);

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

      // Unificamos entregados y no entregados para evaluarlos en un solo ciclo
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

        // Buscamos en la tabla correcta dependiendo de si es un ChargeShipment o no
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
        
        // 🛡️ AQUÍ ESTÁ LA MAGIA: Solo entra si es DHL. FedEx se ignora por completo.
        if (pPackage && pPackage.shipmentType === ShipmentType.DHL) {
          processedDhlCount++;
          const finalStatus = item.status || pPackage.status; 
          
          // 5.1 Validar si el Income ya existe
          const existingIncome = await queryRunner.manager.findOne(Income, {
            where: {
              trackingNumber: pPackage.trackingNumber,
              sourceType: IncomeSourceType.SHIPMENT
            }
          });

          if (existingIncome) {
            this.logger.warn(`⚠️ [RouteClosure] El ingreso para el tracking DHL ${pPackage.trackingNumber} ya existe. Omitiendo cobro.`);
          } else {
            // 5.2 Lógica de cobro y asignación de códigos DEX para no entregados
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
            this.logger.log(`🟢 [RouteClosure] Ingreso creado para DHL ${pPackage.trackingNumber} | Tipo: ${incomeType} | Costo: $${calculatedCost} | Código DEX: ${nonDeliveryStatusCode || 'N/A'}`);
          }

          // 5.3 Actualizamos el estatus en la tabla que le corresponda
          if (item.isCharge) {
            await queryRunner.manager.update(ChargeShipment, { id: item.id }, { status: finalStatus });  
          } else {
            await queryRunner.manager.update(Shipment, { id: item.id }, { status: finalStatus });  
          }
        }
      }

      this.logger.log(`🟢 [RouteClosure] Se procesaron y actualizaron ${processedDhlCount} paquetes de DHL.`);

      // 6. Finalizar transacción
      await queryRunner.commitTransaction();
      this.logger.log(`✅ [RouteClosure] Cierre de ruta completado con éxito: ${savedClosure.id}`);

      return savedClosure;

    } catch (error) {
      // Revertir absolutamente todo si algo falla para no dejar datos corruptos
      await queryRunner.rollbackTransaction();
      this.logger.error(`🔴 [RouteClosure] Error crítico procesando el cierre: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Error al procesar el cierre: ${error.message}`);
    } finally {
      // Liberar conexión siempre
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
