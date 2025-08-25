import { Injectable } from '@nestjs/common';
import { CreateUnloadingDto } from './dto/create-unloading.dto';
import { UpdateUnloadingDto } from './dto/update-unloading.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Unloading } from 'src/entities/unloading.entity';
import { Between, In, Repository } from 'typeorm';
import { Charge, ChargeShipment, Consolidated, Shipment } from 'src/entities';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { ValidatedUnloadingDto } from './dto/validate-package-unloading.dto';
import { MailService } from 'src/mail/mail.service';
import { ConsolidatedType } from 'src/common/enums/consolidated-type.enum';
import { ConsolidatedItemDto, ConsolidatedsDto } from './dto/consolidated.dto';

@Injectable()
export class UnloadingService {

  constructor(
    @InjectRepository(Unloading)
    private readonly unloadingRepository: Repository<Unloading>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(Consolidated)
    private readonly consolidatedReporsitory: Repository<Consolidated>,
    @InjectRepository(Charge)
    private readonly chargeRepository: Repository<Charge>,
    private readonly mailService: MailService
  ) {}

  async getConsolidateToStartUnloading(subdiaryId: string): Promise<ConsolidatedsDto> {
    const todayUTC = new Date('2025-08-22');
    todayUTC.setUTCHours(0, 0, 0, 0);

    const tomorrowUTC = new Date(todayUTC);
    tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);

    // Rango de hoy
    let consolidatedT = await this.consolidatedReporsitory.find({
      where: {
        date: Between(todayUTC, tomorrowUTC),
        subsidiary: {
          id: subdiaryId
        }
      },
    });

    let f2Consolidated = await this.chargeRepository.findOne({
      where: {
        chargeDate: Between(todayUTC, tomorrowUTC),
        subsidiary: {
          id: subdiaryId
        }
      },
    });

    // Si no encontró nada hoy, buscar ayer
    if (consolidatedT.length === 0 && !f2Consolidated) {
      const yesterdayUTC = new Date(todayUTC);
      yesterdayUTC.setUTCDate(yesterdayUTC.getUTCDate() - 1);

      const todayStartUTC = new Date(todayUTC);

      consolidatedT = await this.consolidatedReporsitory.find({
        select: {
          id: true,
          subsidiary: {
            id: true,
            name: true
          },
          numberOfPackages: true,
          consNumber: true,
          type: true
        },
        where: {
          date: Between(yesterdayUTC, todayStartUTC),
          subsidiary: {
            id: subdiaryId
          }
        },
      });

      f2Consolidated = await this.chargeRepository.findOne({
        select: {
          id: true,
          subsidiary: {
            id: true,
            name: true
          },
          numberOfPackages: true,
          consNumber: true,
        },
        where: {
          chargeDate: Between(yesterdayUTC, todayStartUTC),
          subsidiary: {
            id: subdiaryId
          }
        },
      });
    }

    const consolidateds: ConsolidatedsDto = {
      airConsolidated: consolidatedT
        .filter(c => c.type === ConsolidatedType.AEREO)
        .map(c => ({ 
          ...c, 
          type: "Áereo", 
          typeCode: "AER",
          added: [],
          notFound: [],
          color: "text-green-600 bg-green-100"
        })),

      groundConsolidated: consolidatedT
        .filter(c => c.type === ConsolidatedType.ORDINARIA)
        .map(c => ({ 
          ...c, 
          type: "Terrestre", 
          typeCode: "TER", 
          added: [],
          notFound: [],
          color: "text-blue-600 bg-blue-100"
        })),

      f2Consolidated: f2Consolidated
        ? [{
            ...f2Consolidated,
            type: "F2/Carga/31.5",
            typeCode: "F2",
            added: [],
            notFound: [],
            color: "text-orange-600 bg-orange-100",
          }]
        : [],
    };

    return consolidateds;
  }

  async create(createUnloadingDto: CreateUnloadingDto) {
    const allShipmentIds = createUnloadingDto.shipments;

    // Buscar en shipmentRepository
    const shipments = await this.shipmentRepository.find({
      where: { id: In(allShipmentIds) },
    });

    const foundShipmentIds = shipments.map(s => s.id);
    const missingIds = allShipmentIds.filter(id => !foundShipmentIds.includes(id));

    // Buscar los faltantes en chargeShipmentRepository
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { id: In(missingIds) },
    });

    const foundChargeShipmentIds = chargeShipments.map(s => s.id);
    const stillMissing = missingIds.filter(id => !foundChargeShipmentIds.includes(id));

    if (stillMissing.length > 0) {
      throw new Error(`Some shipment IDs were not found: ${stillMissing.join(', ')}`);
    }

    // Guardar el Desembarque
    const newUnloading = this.unloadingRepository.create({
      vehicle: createUnloadingDto.vehicle,
      subsidiary: createUnloadingDto.subsidiary,
      missingTrackings: createUnloadingDto.missingTrackings,
      unScannedTrackings: createUnloadingDto.unScannedTrackings,
      date: new Date(),
    });

    const savedUnloading = await this.unloadingRepository.save(newUnloading);

    // ✅ En lugar de .relation().add(), asignar directamente unloading
    for (const shipment of shipments) {
      shipment.unloading = savedUnloading;
    }
    await this.shipmentRepository.save(shipments);

    for (const chargeShipment of chargeShipments) {
      chargeShipment.unloading = savedUnloading;
    }
    await this.chargeShipmentRepository.save(chargeShipments);

    return savedUnloading;
  }

  async validatePackage(
    packageToValidate: ValidatedPackageDispatchDto,
    subsidiaryId: string
  ): Promise<ValidatedPackageDispatchDto> {
    let isValid = true;
    let reason = '';

  
    if (packageToValidate.subsidiary.id !== subsidiaryId) {
      isValid = false;
      reason = 'El paquete no pertenece a la sucursal actual';
    }

    /*Remover por ahora*/
    /*if (packageToValidate.status === ShipmentStatusType.ENTREGADO) {
      isValid = false;
      reason = 'El paquete ya ha sido entregado';
    }*/

    return {
      ...packageToValidate,
      isValid,
      reason
    };
  }

  async validateTrackingNumbersResp(
    trackingNumbers: string[],
    subsidiaryId?: string
  ): Promise<(ValidatedUnloadingDto & { isCharge?: boolean })[]> {
    const shipments = await this.shipmentRepository.find({
      where: { trackingNumber: In(trackingNumbers) },
      relations: ['subsidiary', 'statusHistory', 'payment', 'packageDispatch'],
      order: { createdAt: 'DESC' }
    });

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { trackingNumber: In(trackingNumbers) },
      relations: ['subsidiary', 'charge', 'packageDispatch'],
    });

    // Indexar para búsqueda rápida
    const shipmentsMap = new Map(shipments.map(s => [s.trackingNumber, s]));
    const chargeMap = new Map(chargeShipments.map(c => [c.trackingNumber, c]));

    const results: (ValidatedUnloadingDto & { isCharge?: boolean })[] = [];

    for (const tn of trackingNumbers) {
      const shipment = shipmentsMap.get(tn);
      if (shipment) {
        const validated = await this.validatePackage({ ...shipment, isValid: false }, subsidiaryId);
        results.push(validated);
        continue;
      }

      const chargeShipment = chargeMap.get(tn);
      if (chargeShipment) {
        const validatedCharge = await this.validatePackage({ ...chargeShipment, isValid: false }, subsidiaryId);
        results.push({ ...validatedCharge, isCharge: true });
        continue;
      }

      results.push({
        trackingNumber: tn,
        isValid: false,
        reason: 'No se encontraron datos para el tracking number en la base de datos',
        subsidiary: null,
        status: null,
      });
    }

    return results;
  }

  async validateTrackingNumbers(
    trackingNumbers: string[],
    subsidiaryId?: string
  ): Promise<{
    validatedShipments: (ValidatedUnloadingDto & { isCharge?: boolean })[];
    consolidateds: ConsolidatedsDto;
  }> {
    // 1️⃣ Traer shipments y chargeShipments en batch
    const shipments = await this.shipmentRepository.find({
      where: { trackingNumber: In(trackingNumbers) },
      relations: ['subsidiary', 'statusHistory', 'payment', 'packageDispatch'],
      order: { createdAt: 'DESC' },
    });

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { trackingNumber: In(trackingNumbers) },
      relations: ['subsidiary', 'charge', 'packageDispatch'],
    });

    // Mapas para acceso rápido por trackingNumber
    const shipmentsMap = new Map(shipments.map(s => [s.trackingNumber, s]));
    const chargeMap = new Map(chargeShipments.map(c => [c.trackingNumber, c]));

    const validatedShipments: (ValidatedUnloadingDto & { isCharge?: boolean })[] = [];

    // 2️⃣ Validar todos los trackingNumbers
    for (const tn of trackingNumbers) {
      const shipment = shipmentsMap.get(tn);
      if (shipment) {
        const validated = await this.validatePackage({ ...shipment, isValid: false }, subsidiaryId);
        validatedShipments.push(validated);
        continue;
      }

      const chargeShipment = chargeMap.get(tn);
      if (chargeShipment) {
        const validatedCharge = await this.validatePackage({ ...chargeShipment, isValid: false }, subsidiaryId);
        validatedShipments.push({ ...validatedCharge, isCharge: true });
        continue;
      }

      validatedShipments.push({
        trackingNumber: tn,
        isValid: false,
        reason: 'No se encontraron datos para el tracking number en la base de datos',
        subsidiary: null,
        status: null,
      });
    }

    // 3️⃣ Obtener consolidado por subdiaryId
    const consolidatedsToValidate: ConsolidatedsDto = await this.getConsolidateToStartUnloading(subsidiaryId);

    const allConsolidateds: ConsolidatedItemDto[] = Object.values(consolidatedsToValidate).flat();

    // 4️⃣ Asignar cada trackingNumber validado a su consolidado
    for (const validated of validatedShipments) {
      if (validated.isCharge) {
        // Solo agregar a f2Consolidated
        const f2 = consolidatedsToValidate.f2Consolidated[0]; // asumimos que siempre hay como máximo uno
        if (!f2) continue;

        if (!f2.added) f2.added = [];
        f2.added.push(validated.trackingNumber);
      } else {
        // Agregar a air o ground según el shipment normal
        const shipment = shipmentsMap.get(validated.trackingNumber);
        if (!shipment) continue;

        const consolidated = allConsolidateds.find(c => c.id === shipment.consolidatedId);
        if (!consolidated) continue;

        if (!consolidated.added) consolidated.added = [];
        consolidated.added.push(validated.trackingNumber);
      }
    }

    return { validatedShipments, consolidateds: consolidatedsToValidate };
  }


  async findAll() {
    return `This action returns all unloading`;
  }

  async findAllBySubsidiary(subsidiaryId: string) {
    const response = await this.unloadingRepository.find({
      where: { subsidiary: { id: subsidiaryId } },
      relations: ['shipments', 'chargeShipments','vehicle', 'subsidiary'],
    });

    return response
  }

  findOne(id: number) {
    return `This action returns a #${id} unloading`;
  }

  update(id: number, updateUnloadingDto: UpdateUnloadingDto) {
    return `This action updates a #${id} unloading`;
  }

  remove(id: number) {
    return `This action removes a #${id} unloading`;
  }

  async sendByEmail(file: Express.Multer.File, excelFile: Express.Multer.File, subsidiaryName: string, unloadingId: string) {
    const unloading = await this.unloadingRepository.findOne(
      { 
        where: {id: unloadingId},
        relations: ['vehicle']
      });
    console.log("🚀 ~ PackageDispatchService ~ sendByEmail ~ unloading:", unloading)

    return await this.mailService.sendHighPriorityUnloadingEmail(file, excelFile, subsidiaryName, unloading)
  }

  async checkUnloadingsOnConsolidated(
    subdiaryId: string,
    validatedShipments: string[],
  ) {
    // Traer todos los consolidados
    const consolidateds = await this.getConsolidateToStartUnloading(subdiaryId);
    const allConsolidateds = Object.values(consolidateds).flat();

    // Recorremos los shipments validados
    for (const validatedShipment of validatedShipments) {
      const shipment = await this.shipmentRepository.findOneBy({
        id: validatedShipment,
      });

      if (shipment) {
        // Buscamos el consolidated al que pertenece este shipment
        const consolidated = allConsolidateds.find(
          (c) => c.id === shipment.consolidatedId
        );

        if (consolidated) {
          // Si no existe la propiedad added, la inicializamos
          if (!consolidated.added) {
            consolidated.added = [];
          }

          // Agregamos el trackingNumber de este shipment
          consolidated.added.push(shipment.trackingNumber);
        }
      }
    }

    return consolidateds;
  }

}
