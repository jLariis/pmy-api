import { Injectable, Logger, BadRequestException, InternalServerErrorException  } from '@nestjs/common';
import { CreateRouteclosureDto } from './dto/create-routeclosure.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { DataSource, Repository } from 'typeorm';
import { ValidateTrackingsForClosureDto } from './dto/validate-trackings-for-closure';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ShipmentStatus, Collection } from 'src/entities';
import { DispatchStatus } from 'src/common/enums/dispatch-enum';
import { MailService } from 'src/mail/mail.service';
import { fromZonedTime } from 'date-fns-tz';

@Injectable()
export class RouteclosureService {
  private readonly logger = new Logger(RouteclosureService.name);

  constructor(
    @InjectRepository(RouteClosure)
    private readonly routeClouseRepository: Repository<RouteClosure>,
    @InjectRepository(PackageDispatch)
    private readonly packageDispatchRepository: Repository<PackageDispatch>,
    private readonly mailService: MailService,
    private readonly dataSource: DataSource
  ) {}

  async createResp(createRouteclosureDto: CreateRouteclosureDto) {
    console.log('🟡 [RouteClosure] DTO recibido:', createRouteclosureDto);

    const packageDispatch = await this.packageDispatchRepository.findOne({
      where: {
        id: createRouteclosureDto.packageDispatch.id,
      },
      relations: ['subsidiary'],
    });

    if (!packageDispatch) {
      console.error('🔴 PackageDispatch NO encontrado:', createRouteclosureDto.packageDispatch.id);
      throw new Error('PackageDispatch no encontrado');
    }

    console.log('🟢 PackageDispatch encontrado:', {
      id: packageDispatch.id,
      statusAntes: packageDispatch.status,
    });

    // Actualizar estado
    packageDispatch.status = DispatchStatus.COMPLETADA;
    packageDispatch.closedAt = new Date();

    console.log('🟡 Actualizando PackageDispatch:', {
      statusNuevo: packageDispatch.status,
      closedAt: packageDispatch.closedAt,
    });

    const savedDispatch = await this.packageDispatchRepository.save(packageDispatch);

    console.log('🟢 PackageDispatch guardado:', {
      id: savedDispatch.id,
      statusDespues: savedDispatch.status,
      closedAt: savedDispatch.closedAt,
    });

    const newRouteClosure = this.routeClouseRepository.create({
      ...createRouteclosureDto,
      subsidiary: packageDispatch.subsidiary,
    });

    console.log('🟡 Creando RouteClosure:', newRouteClosure);

    const savedClosure = await this.routeClouseRepository.save(newRouteClosure);

    console.log('🟢 RouteClosure guardado correctamente:', savedClosure.id);

    return savedClosure;
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
