import { forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateUnloadingDto } from './dto/create-unloading.dto';
import { UpdateUnloadingDto } from './dto/update-unloading.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Unloading } from 'src/entities/unloading.entity';
import { Between, In, Not, Repository } from 'typeorm';
import { Charge, ChargeShipment, Consolidated, Shipment } from 'src/entities';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { ValidatedUnloadingDto } from './dto/validate-package-unloading.dto';
import { MailService } from 'src/mail/mail.service';
import { ConsolidatedType } from 'src/common/enums/consolidated-type.enum';
import { ConsolidatedItemDto, ConsolidatedsDto } from './dto/consolidated.dto';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { UnloadingReportDto } from './dto/unloading-report.dto';
import { ShipmentsService } from 'src/shipments/shipments.service';


@Injectable()
export class UnloadingService {
  private readonly logger = new Logger(UnloadingService.name);

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
    private readonly mailService: MailService,
    @Inject(forwardRef(() => ShipmentsService))
    private readonly shipmentService: ShipmentsService
  ) {}

  async getConsolidateToStartUnloading(subdiaryId: string): Promise<ConsolidatedsDto> {
    const timeZone = "America/Hermosillo";

    // Fecha actual en zona local
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const [{ value: y }, , { value: m }, , { value: d }] = fmt.formatToParts(now);
    const todayStr = `${y}-${m}-${d}`;

    // Día actual (0 = domingo, 1 = lunes, ..., 6 = sábado)
    const dayOfWeek = new Date(`${todayStr}T00:00:00`).getDay();

    // Crear fechas base en zona local
    const todayLocal = new Date(`${todayStr}T00:00:00`);
    const startDate = new Date(todayLocal);
    const endDate = new Date(todayLocal);

    // Si es lunes, retrocede 3 días (viernes)
    if (dayOfWeek === 1) {
      startDate.setDate(startDate.getDate() - 3);
    } else {
      // En otros días, solo retrocede 1 (ayer)
      startDate.setDate(startDate.getDate() - 1);
    }

    // Siempre sumamos 1 para incluir el siguiente día (mañana)
    endDate.setDate(endDate.getDate() + 1);

    // 🔥 Consulta usando el rango ajustado
    const consolidatedT = await this.consolidatedReporsitory.find({
      where: {
        date: Between(startDate, endDate),
        subsidiary: { id: subdiaryId },
      },
    });

    const f2Consolidated = await this.chargeRepository.find({
      where: {
        chargeDate: Between(startDate, endDate),
        subsidiary: { id: subdiaryId },
      },
    });

    const consolidateds: ConsolidatedsDto = {
      airConsolidated: consolidatedT
        .filter(c => c.type === ConsolidatedType.AEREO)
        .map(c => ({
          ...c,
          type: "Áereo",
          typeCode: "AER",
          added: [],
          notFound: [],
          color: "text-green-600 bg-green-100",
        })),

      groundConsolidated: consolidatedT
        .filter(c => c.type === ConsolidatedType.ORDINARIA)
        .map(c => ({
          ...c,
          type: "Terrestre",
          typeCode: "TER",
          added: [],
          notFound: [],
          color: "text-blue-600 bg-blue-100",
        })),

      f2Consolidated: f2Consolidated.map(c => ({
        ...c,
        type: "F2/Carga/31.5",
        typeCode: "F2",
        added: [],
        notFound: [],
        color: "text-orange-600 bg-orange-100",
      })),
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

  async validateTrackingNumbers(
    trackingNumbers: string[],
    subsidiaryId?: string
  ): Promise<{
    validatedShipments: (ValidatedUnloadingDto & { isCharge?: boolean })[];
    consolidateds: ConsolidatedsDto;
  }> {
    // 1️⃣ Traer shipments y chargeShipments en batch
    const shipments = await this.shipmentRepository.find({
      where: { 
        trackingNumber: In(trackingNumbers), 
        status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) 
      },
      relations: ['subsidiary', 'statusHistory', 'payment', 'packageDispatch'],
      order: { createdAt: 'DESC' }, // Ordenar por fecha descendente
    });

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { 
        trackingNumber: In(trackingNumbers),
        status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
      },
      relations: ['subsidiary', 'charge', 'packageDispatch', 'payment'],
      order: { createdAt: 'DESC' }, // Ordenar por fecha descendente
    });

    // 2️⃣ FUNCIÓN PARA MANEJAR DUPLICADOS - Tomar el más reciente
    const getMostRecentByTrackingNumber = <T extends { trackingNumber: string; createdAt: Date }>(
      items: T[]
    ): Map<string, T> => {
      const map = new Map<string, T>();
      
      for (const item of items) {
        const existing = map.get(item.trackingNumber);
        if (!existing || new Date(item.createdAt) > new Date(existing.createdAt)) {
          map.set(item.trackingNumber, item);
        }
      }
      
      return map;
    };

    // Crear mapas con los registros más recientes
    const shipmentsMap = getMostRecentByTrackingNumber(shipments);
    const chargeMap = getMostRecentByTrackingNumber(chargeShipments);

    // 3️⃣ DEBUG: Verificar duplicados
    console.log('=== DEBUG DUPLICADOS ===');
    console.log('Total shipments encontrados:', shipments.length);
    console.log('Total chargeShipments encontrados:', chargeShipments.length);
    console.log('Shipments únicos (más recientes):', shipmentsMap.size);
    console.log('ChargeShipments únicos (más recientes):', chargeMap.size);
    
    // Identificar duplicados
    const trackingNumberCounts = new Map<string, number>();
    [...shipments, ...chargeShipments].forEach(item => {
      trackingNumberCounts.set(item.trackingNumber, (trackingNumberCounts.get(item.trackingNumber) || 0) + 1);
    });
    
    const duplicates = Array.from(trackingNumberCounts.entries())
      .filter(([_, count]) => count > 1)
      .map(([tn]) => tn);
    
    console.log('Tracking numbers duplicados:', duplicates);
    console.log('=== FIN DEBUG DUPLICADOS ===');

    const validatedShipments: (ValidatedUnloadingDto & { isCharge?: boolean })[] = [];

    // 4️⃣ Validar todos los trackingNumbers recibidos (usando los más recientes)
    for (const tn of trackingNumbers) {
      // Verificar si existe en shipments (más reciente)
      const mostRecentShipment = shipmentsMap.get(tn);
      const mostRecentCharge = chargeMap.get(tn);

      // Decidir cuál usar: priorizar el más reciente entre ambos tipos
      let recordToValidate: any = null;
      let isCharge = false;

      if (mostRecentShipment && mostRecentCharge) {
        // Si existe en ambos, tomar el más reciente globalmente
        const shipmentDate = new Date(mostRecentShipment.createdAt);
        const chargeDate = new Date(mostRecentCharge.createdAt);
        
        if (chargeDate > shipmentDate) {
          recordToValidate = mostRecentCharge;
          isCharge = true;
        } else {
          recordToValidate = mostRecentShipment;
          isCharge = false;
        }
        
        console.log(`⚠️ Tracking number ${tn} duplicado en ambos tipos. Usando: ${isCharge ? 'CHARGE' : 'SHIPMENT'} (más reciente)`);
      } else if (mostRecentShipment) {
        recordToValidate = mostRecentShipment;
        isCharge = false;
      } else if (mostRecentCharge) {
        recordToValidate = mostRecentCharge;
        isCharge = true;
      }

      if (recordToValidate) {
        const validated = await this.validatePackage({ ...recordToValidate, isValid: false }, subsidiaryId);
        validatedShipments.push({ ...validated, isCharge });
      } else {
        validatedShipments.push({
          trackingNumber: tn,
          isValid: false,
          reason: 'No se encontraron datos para el tracking number en la base de datos',
          subsidiary: null,
          status: null,
        });
      }
    }

    // 5️⃣ Obtener consolidados para la descarga actual
    const consolidatedsToValidate: ConsolidatedsDto = await this.getConsolidateToStartUnloading(subsidiaryId);
    const allConsolidateds: ConsolidatedItemDto[] = Object.values(consolidatedsToValidate).flat();

    // 6️⃣ Inicializar arrays added/notFound
    for (const consolidated of allConsolidateds) {
      consolidated.added = [];
      consolidated.notFound = [];
    }

    // 7️⃣ Asignar SOLO los válidos a added
    for (const validated of validatedShipments) {
      if (!validated.isValid) continue;

      if (validated.isCharge) {
        // Para carga (F2)
        const f2 = consolidatedsToValidate.f2Consolidated[0];
        if (!f2) continue;
        
        f2.added.push({
          trackingNumber: validated.trackingNumber,
          recipientName: validated.recipientName,
          recipientAddress: validated.recipientAddress,
          recipientPhone: validated.recipientPhone
        });
      } else {
        // Para shipments normales
        const mostRecentShipment = shipmentsMap.get(validated.trackingNumber);
        if (!mostRecentShipment) continue;

        const consolidated = allConsolidateds.find(c => c.id === mostRecentShipment.consolidatedId);
        if (!consolidated) continue;

        consolidated.added.push({
          trackingNumber: validated.trackingNumber,
          recipientName: validated.recipientName,
          recipientAddress: validated.recipientAddress,
          recipientPhone: validated.recipientPhone
        });
      }
    }

    // 8️⃣ DEBUG: Verificar asignación
    console.log('=== DEBUG ASIGNACIÓN ===');
    console.log('Total validados:', validatedShipments.length);
    console.log('Válidos:', validatedShipments.filter(v => v.isValid).length);
    
    for (const consolidated of allConsolidateds) {
      console.log(`Consolidado ${consolidated.id} (${consolidated.typeCode}): ${consolidated.added.length} added`);
    }
    console.log('=== FIN DEBUG ASIGNACIÓN ===');

    // 9️⃣ Calcular notFound para AÉREO / TERRESTRE
    for (const consolidated of allConsolidateds.filter(c => c.typeCode !== 'F2')) {
      const relatedShipments = await this.shipmentRepository.find({
        where: { 
          consolidatedId: consolidated.id,
          status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
        },
        select: ['trackingNumber', 'recipientName', 'recipientAddress', 'recipientPhone'],
      });

      // Tomar solo el más reciente por tracking number para los notFound también
      const uniqueRelatedShipments = getMostRecentByTrackingNumber(relatedShipments);

      consolidated.notFound = Array.from(uniqueRelatedShipments.values())
        .filter(s => !consolidated.added.some(a => a.trackingNumber === s.trackingNumber))
        .map(s => ({
          trackingNumber: s.trackingNumber,
          recipientName: s.recipientName,
          recipientAddress: s.recipientAddress,
          recipientPhone: s.recipientPhone,
        }));
    }

    // 🔟 Calcular notFound para F2
    const f2 = consolidatedsToValidate.f2Consolidated[0];
    if (f2) {
      const f2ChargeShipments = await this.chargeShipmentRepository.find({
        where: { 
          charge: { id: f2.id },
          status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
        },
        select: ['trackingNumber', 'recipientName', 'recipientAddress', 'recipientPhone'],
        relations: ['charge'],
      });

      // Tomar solo el más reciente por tracking number
      const uniqueF2ChargeShipments = getMostRecentByTrackingNumber(f2ChargeShipments);

      f2.notFound = Array.from(uniqueF2ChargeShipments.values())
        .filter(cs => !f2.added.some(a => a.trackingNumber === cs.trackingNumber))
        .map(cs => ({
          trackingNumber: cs.trackingNumber,
          recipientName: cs.recipientName,
          recipientAddress: cs.recipientAddress,
          recipientPhone: cs.recipientPhone,
        }));
    }

    return { validatedShipments, consolidateds: consolidatedsToValidate };
  }

  async validateTrackingNumber(
    trackingNumber: string,
    subsidiaryId?: string
  ): Promise<{
    validatedShipments: (ValidatedUnloadingDto & { isCharge?: boolean })[];
    consolidateds: ConsolidatedsDto;
  }> {
    // 1️⃣ Traer shipment o chargeShipment para el trackingNumber específico
    const shipment = await this.shipmentRepository.findOne({
      where: { 
        trackingNumber,
        status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) 
      },
      relations: ['subsidiary', 'statusHistory', 'payment', 'packageDispatch'],
      order: { createdAt: 'DESC' },
    });

    const chargeShipment = await this.chargeShipmentRepository.findOne({
      where: { 
        trackingNumber,
        status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
      },
      relations: ['subsidiary', 'charge', 'packageDispatch', 'payment'],
      order: { createdAt: 'DESC' },
    });

    const validatedShipments: (ValidatedUnloadingDto & { isCharge?: boolean })[] = [];

    // 2️⃣ Validar el trackingNumber recibido
    if (shipment) {
      const validated = await this.validatePackage({ ...shipment, isValid: false }, subsidiaryId);
      validatedShipments.push(validated);
    } else if (chargeShipment) {
      const validatedCharge = await this.validatePackage({ ...chargeShipment, isValid: false }, subsidiaryId);
      validatedShipments.push({ ...validatedCharge, isCharge: true });
    } else {
      validatedShipments.push({
        trackingNumber,
        isValid: false,
        reason: 'No se encontraron datos para el tracking number en la base de datos',
        subsidiary: null,
        status: null,
      });
    }

    // 3️⃣ Obtener consolidado por subsidiaryId (se mantiene igual)
    const consolidatedsToValidate: ConsolidatedsDto = await this.getConsolidateToStartUnloading(subsidiaryId);
    const allConsolidateds: ConsolidatedItemDto[] = Object.values(consolidatedsToValidate).flat();

    // 4️⃣ Inicializar arrays added/notFound y asignar el validado (solo si es válido y se encontró)
    for (const consolidated of allConsolidateds) {
      consolidated.added = [];
      consolidated.notFound = [];
    }

    const validated = validatedShipments[0]; // Solo hay uno
    if (validated && validated.isValid !== false) { // Solo agregar si es válido (asumiendo que validatePackage lo marca como true si pasa)
      if (validated.isCharge) {
        // Solo agregar a F2
        const f2 = consolidatedsToValidate.f2Consolidated[0]; // usualmente hay 1
        if (f2) {
          f2.added.push({
            trackingNumber: validated.trackingNumber,
            recipientName: validated.recipientName,
            recipientAddress: validated.recipientAddress,
            recipientPhone: validated.recipientPhone
          });
        }
      } else {
        // AER/TER según shipment normal
        const shipment = await this.shipmentRepository.findOne({
          where: { trackingNumber },
          relations: ['packageDispatch'], // Solo lo necesario para consolidatedId
        });
        if (shipment) {
          const consolidated = allConsolidateds.find(c => c.id === shipment.consolidatedId);
          if (consolidated) {
            consolidated.added.push({
              trackingNumber: validated.trackingNumber,
              recipientName: validated.recipientName,
              recipientAddress: validated.recipientAddress,
              recipientPhone: validated.recipientPhone
            });
          }
        }
      }
    }

    // 5️⃣ Calcular notFound para AÉREO / TERRESTRE (se mantiene igual, pero ahora added tiene max 1 elemento)
    for (const consolidated of allConsolidateds.filter(c => c.typeCode !== 'F2')) {
      const relatedShipments = await this.shipmentRepository.find({
        where: { consolidatedId: consolidated.id },
        select: ['trackingNumber', 'recipientName', 'recipientAddress', 'recipientPhone'],
      });

      consolidated.notFound = relatedShipments
        .filter(s => !consolidated.added.some(a => a.trackingNumber === s.trackingNumber))
        .map(s => ({
          trackingNumber: s.trackingNumber,
          recipientName: s.recipientName,
          recipientAddress: s.recipientAddress,
          recipientPhone: s.recipientPhone,
        }));
    }

    // 6️⃣ Calcular notFound (y su conteo) para F2 (carga/31.5) (se mantiene igual)
    const f2 = consolidatedsToValidate.f2Consolidated[0];

    if (f2) {
      const f2ChargeShipments = await this.chargeShipmentRepository.find({
        where: { charge: { id: f2.id } },
        select: ['trackingNumber', 'recipientName', 'recipientAddress', 'recipientPhone'],
        relations: ['charge'],
      });

      f2.notFound = f2ChargeShipments
        .filter(cs => !f2.added.some(a => a.trackingNumber === cs.trackingNumber))
        .map(cs => ({
          trackingNumber: cs.trackingNumber,
          recipientName: cs.recipientName,
          recipientAddress: cs.recipientAddress,
          recipientPhone: cs.recipientPhone,
        }));
    }

    return { validatedShipments, consolidateds: consolidatedsToValidate };
  }

  async findAll() {
    return `This action returns all unloading`;
  }

  /** For combo box on monitoring*/
  async findBySubsidiaryId(subsidiaryId: string) {
    // Traer unloadings con la relación directa a vehicle
    const unloadings = await this.unloadingRepository.find({
      where: { subsidiary: { id: subsidiaryId } },
      select: {
        id: true,
        trackingNumber: true,
        date: true,
        vehicle: {
          id: true,
          plateNumber: true,
          name: true,
        },
        subsidiary: {
          id: true,
          name: true,
        },
      },
      relations: ['subsidiary', 'vehicle'],
      order: { createdAt: 'DESC' },
    });

    if (!unloadings.length) return [];

    const results = await Promise.all(
      unloadings.map(async (unloading) => {
        // Buscar Shipments y ChargeShipments ligados al unloading
        const [shipments, chargeShipments] = await Promise.all([
          this.shipmentRepository.find({
            where: { unloading: { id: unloading.id } },
          }),
          this.chargeShipmentRepository.find({
            where: { unloading: { id: unloading.id } },
          }),
        ]);

        // Calcular número total de paquetes
        const numberOfPackages = shipments.length + chargeShipments.length;

        return {
          id: unloading.id,
          trackingNumber: unloading.trackingNumber,
          date: unloading.date,
          subsidiary: unloading.subsidiary,
          vehicle: unloading.vehicle,
          numberOfPackages,
        };
      }),
    );

    return results;
  }

  async findAllBySubsidiary(subsidiaryId: string) {
    const response = await this.unloadingRepository.find({
      where: { subsidiary: { id: subsidiaryId } },
      relations: ['shipments', 'chargeShipments','vehicle', 'subsidiary'],
      order: {
        createdAt: 'DESC'
      }
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

  async getUnloadingReportRespMonitoreo(startDate?: Date, endDate?: Date): Promise<UnloadingReportDto[]> {
    // Convertir fechas a UTC considerando UTC-7 (Hermosillo/Arizona)
    let startDateUTC: Date;
    let endDateUTC: Date;

    if (startDate && endDate) {
        // Convertir fechas proporcionadas de UTC-7 a UTC
        startDateUTC = this.convertHermosilloToUTC(startDate);
        endDateUTC = this.convertHermosilloToUTC(endDate);
    } else if (startDate && !endDate) {
        // Solo startDate proporcionado
        startDateUTC = this.convertHermosilloToUTC(startDate);
        endDateUTC = new Date(startDateUTC);
        endDateUTC.setUTCDate(endDateUTC.getUTCDate() + 1);
    } else if (!startDate && endDate) {
        // Solo endDate proporcionado
        endDateUTC = this.convertHermosilloToUTC(endDate);
        startDateUTC = new Date(endDateUTC);
        startDateUTC.setUTCDate(startDateUTC.getUTCDate() - 1);
    } else {
        // Sin fechas proporcionadas, usar hoy en Hermosillo convertido a UTC
        const nowHermosillo = new Date();
        startDateUTC = this.convertHermosilloToUTC(nowHermosillo);
        startDateUTC.setUTCHours(0, 0, 0, 0);
        endDateUTC = new Date(startDateUTC);
        endDateUTC.setUTCDate(endDateUTC.getUTCDate() + 1);
    }

    try {
      console.log('===== FILTROS HERMOSILLO -> UTC =====');
      console.log('Fecha desde (Hermosillo):', this.convertUTCToHermosillo(startDateUTC).toLocaleString('es-MX'));
      console.log('Fecha hasta (Hermosillo):', this.convertUTCToHermosillo(endDateUTC).toLocaleString('es-MX'));
      console.log('Fecha desde (UTC):', startDateUTC.toISOString());
      console.log('Fecha hasta (UTC):', endDateUTC.toISOString());

      // PRIMERO: Verificar qué hay en la base de datos
      console.log('🔍 VERIFICANDO DATOS EN BD...');
      
      // 1. Verificar rango de fechas en BD
      const dateRange = await this.unloadingRepository
        .createQueryBuilder('u')
        .select('MIN(u.date)', 'minDate')
        .addSelect('MAX(u.date)', 'maxDate')
        .getRawOne();
      
      console.log('📅 Rango de fechas en BD:');
      console.log('Mínima:', dateRange.minDate, this.formatDateForDisplay(dateRange.minDate));
      console.log('Máxima:', dateRange.maxDate, this.formatDateForDisplay(dateRange.maxDate));

      // 2. Verificar unloadings en el rango sin joins
      const unloadingsInRange = await this.unloadingRepository
        .createQueryBuilder('u')
        .where('u.date >= :startDate AND u.date < :endDate', {
          startDate: startDateUTC.toISOString(),
          endDate: endDateUTC.toISOString()
        })
        .getMany();
      
      console.log(`📊 Unloadings en rango ${startDateUTC.toISOString()} a ${endDateUTC.toISOString()}:`, unloadingsInRange.length);
      
      unloadingsInRange.forEach(u => {
        console.log(`   - ${u.id}: ${u.date} (${this.formatDateForDisplay(u.date.toString())})`);
      });

      // 3. Si no hay unloadings, buscar los más recientes
      if (unloadingsInRange.length === 0) {
        console.log('🔎 Buscando unloadings recientes...');
        const recentUnloadings = await this.unloadingRepository
          .createQueryBuilder('u')
          .orderBy('u.date', 'DESC')
          .limit(5)
          .getMany();
        
        console.log('📦 Unloadings más recientes:');
        recentUnloadings.forEach(u => {
          console.log(`   - ${u.id}: ${u.date} (${this.formatDateForDisplay(u.date.toString())})`);
        });
      }

      // 4. Ahora hacer la consulta completa
      const rawData = await this.unloadingRepository
        .createQueryBuilder('u')
        .leftJoinAndSelect('u.subsidiary', 's')
        .leftJoinAndSelect('u.shipments', 'sh')
        .leftJoinAndSelect('sh.packageDispatch', 'shPD')
        .leftJoinAndSelect('shPD.drivers', 'shDriver')
        .leftJoinAndSelect('u.chargeShipments', 'cs')
        .leftJoinAndSelect('cs.packageDispatch', 'csPD')
        .leftJoinAndSelect('csPD.drivers', 'csDriver')
        .where('u.date >= :startDate AND u.date < :endDate', {
          startDate: startDateUTC.toISOString(),
          endDate: endDateUTC.toISOString()
        })
        .getMany();

      console.log('===== RESULTADOS =====');
      console.log('Unloadings encontrados con joins:', rawData.length);

      // Procesar los datos
      const formattedData: UnloadingReportDto[] = rawData.map(unloading => {
        if (!unloading) return null;

        const uniqueShipments = this.removeDuplicateShipments(unloading.shipments || []);
        const uniqueChargeShipments = this.removeDuplicateShipments(unloading.chargeShipments || []);

        return {
          id: unloading.id,
          date: unloading.date,
          subsidiary: {
            id: unloading.subsidiary?.id || 'unknown',
            name: unloading.subsidiary?.name || 'Sucursal Desconocida',
          },
          shipments: uniqueShipments.map(sh => ({
            id: sh.id,
            trackingNumber: sh.trackingNumber,
            status: sh.status,
            commitDateTime: sh.commitDateTime,
            routeId: sh.routeId,
            packageDispatch: sh.packageDispatch ? {
              id: sh.packageDispatch.id,
              trackingNumber: sh.packageDispatch.trackingNumber,
              firstDriverName: this.getFirstDriverName(sh.packageDispatch.drivers),
            } : null,
          })),
          chargeShipments: uniqueChargeShipments.map(cs => ({
            id: cs.id,
            trackingNumber: cs.trackingNumber,
            status: cs.status,
            commitDateTime: cs.commitDateTime,
            routeId: cs.routeId,
            packageDispatch: cs.packageDispatch ? {
              id: cs.packageDispatch.id,
              trackingNumber: cs.packageDispatch.trackingNumber,
              firstDriverName: this.getFirstDriverName(cs.packageDispatch.drivers),
            } : null,
          })),
        };
      }).filter(Boolean);

      console.log('===== DATOS FORMATEADOS =====');
      console.log('Total unloadings a procesar:', formattedData.length);

      return formattedData;

    } catch (error) {
      console.error('Error en getUnloadingReport:', error);
      throw error;
    }
  }

  async getUnloadingReport(startDate?: Date, endDate?: Date): Promise<UnloadingReportDto[]> {
    // Convertir fechas a UTC considerando UTC-7 (Hermosillo/Arizona)
    let startDateUTC: Date;
    let endDateUTC: Date;

    if (startDate && endDate) {
        // Convertir fechas proporcionadas de UTC-7 a UTC
        startDateUTC = this.convertHermosilloToUTC(startDate);
        endDateUTC = this.convertHermosilloToUTC(endDate);
    } else if (startDate && !endDate) {
        // Solo startDate proporcionado
        startDateUTC = this.convertHermosilloToUTC(startDate);
        endDateUTC = new Date(startDateUTC);
        endDateUTC.setUTCDate(endDateUTC.getUTCDate() + 1);
    } else if (!startDate && endDate) {
        // Solo endDate proporcionado
        endDateUTC = this.convertHermosilloToUTC(endDate);
        startDateUTC = new Date(endDateUTC);
        startDateUTC.setUTCDate(startDateUTC.getUTCDate() - 1);
    } else {
        // Sin fechas proporcionadas, usar hoy en Hermosillo convertido a UTC
        const nowHermosillo = new Date();
        startDateUTC = this.convertHermosilloToUTC(nowHermosillo);
        startDateUTC.setUTCHours(0, 0, 0, 0);
        endDateUTC = new Date(startDateUTC);
        endDateUTC.setUTCDate(endDateUTC.getUTCDate() + 1);
    }

    try {
      console.log('===== FILTROS HERMOSILLO -> UTC =====');
      console.log('Fecha desde (Hermosillo):', this.convertUTCToHermosillo(startDateUTC).toLocaleString('es-MX'));
      console.log('Fecha hasta (Hermosillo):', this.convertUTCToHermosillo(endDateUTC).toLocaleString('es-MX'));
      console.log('Fecha desde (UTC):', startDateUTC.toISOString());
      console.log('Fecha hasta (UTC):', endDateUTC.toISOString());

      // PRIMERO: Verificar qué hay en la base de datos
      console.log('🔍 VERIFICANDO DATOS EN BD...');
      
      // 1. Verificar rango de fechas en BD
      const dateRange = await this.unloadingRepository
        .createQueryBuilder('u')
        .select('MIN(u.date)', 'minDate')
        .addSelect('MAX(u.date)', 'maxDate')
        .getRawOne();
      
      console.log('📅 Rango de fechas en BD:');
      console.log('Mínima:', dateRange.minDate, this.formatDateForDisplay(dateRange.minDate));
      console.log('Máxima:', dateRange.maxDate, this.formatDateForDisplay(dateRange.maxDate));

      // 2. Verificar unloadings en el rango sin joins
      const unloadingsInRange = await this.unloadingRepository
        .createQueryBuilder('u')
        .where('u.date >= :startDate AND u.date < :endDate', {
          startDate: startDateUTC.toISOString(),
          endDate: endDateUTC.toISOString()
        })
        .getMany();
      
      console.log(`📊 Unloadings en rango ${startDateUTC.toISOString()} a ${endDateUTC.toISOString()}:`, unloadingsInRange.length);

      // 3. Si no hay unloadings, buscar los más recientes
      if (unloadingsInRange.length === 0) {
        console.log('🔎 Buscando unloadings recientes...');
        const recentUnloadings = await this.unloadingRepository
          .createQueryBuilder('u')
          .orderBy('u.date', 'DESC')
          .limit(5)
          .getMany();
        
        console.log('📦 Unloadings más recientes:');
        recentUnloadings.forEach(u => {
          console.log(`   - ${u.id}: ${u.date} (${this.formatDateForDisplay(u.date.toString())})`);
        });
      }

      // 4. Ahora hacer la consulta completa CON FILTRO EN SHIPMENTS Y CHARGE SHIPMENTS
      const rawData = await this.unloadingRepository
        .createQueryBuilder('u')
        .leftJoinAndSelect('u.subsidiary', 's')
        .leftJoinAndSelect(
          'u.shipments', 
          'sh',
          'sh.commitDateTime >= :startDate AND sh.commitDateTime < :endDate', // FILTRO SHIPMENTS
          { startDate: startDateUTC.toISOString(), endDate: endDateUTC.toISOString() }
        )
        .leftJoinAndSelect('sh.packageDispatch', 'shPD')
        .leftJoinAndSelect('shPD.drivers', 'shDriver')
        .leftJoinAndSelect(
          'u.chargeShipments',
          'cs',
          'cs.commitDateTime >= :startDate AND cs.commitDateTime < :endDate', // FILTRO CHARGE SHIPMENTS
          { startDate: startDateUTC.toISOString(), endDate: endDateUTC.toISOString() }
        )
        .leftJoinAndSelect('cs.packageDispatch', 'csPD')
        .leftJoinAndSelect('csPD.drivers', 'csDriver')
        .where('u.date >= :startDate AND u.date < :endDate', {
          startDate: startDateUTC.toISOString(),
          endDate: endDateUTC.toISOString()
        })
        .getMany();

      console.log('===== RESULTADOS =====');
      console.log('Unloadings encontrados con joins:', rawData.length);

      // DEBUG: Verificar shipments y chargeShipments filtrados
      rawData.forEach((u, index) => {
        console.log(`Unloading ${index + 1}:`, {
          id: u.id,
          date: u.date,
          subsidiary: u.subsidiary?.name,
          shipments: u.shipments?.length || 0,
          chargeShipments: u.chargeShipments?.length || 0,
          shipmentsSample: u.shipments?.slice(0, 2).map(s => ({
            tracking: s.trackingNumber,
            commitDate: s.commitDateTime
          })),
          chargeSample: u.chargeShipments?.slice(0, 2).map(cs => ({
            tracking: cs.trackingNumber,
            commitDate: cs.commitDateTime
          }))
        });
      });

      // Procesar los datos
      const formattedData: UnloadingReportDto[] = rawData.map(unloading => {
        if (!unloading) return null;

        // Filtrar adicionalmente por si algún shipment se coló sin commitDateTime (aunque el join debería prevenirlo)
        const filteredShipments = (unloading.shipments || []).filter(sh => 
          sh.commitDateTime && 
          new Date(sh.commitDateTime) >= startDateUTC && 
          new Date(sh.commitDateTime) < endDateUTC
        );

        const filteredChargeShipments = (unloading.chargeShipments || []).filter(cs => 
          cs.commitDateTime && 
          new Date(cs.commitDateTime) >= startDateUTC && 
          new Date(cs.commitDateTime) < endDateUTC
        );

        const uniqueShipments = this.removeDuplicateShipments(filteredShipments);
        const uniqueChargeShipments = this.removeDuplicateShipments(filteredChargeShipments);

        console.log(`📦 Unloading ${unloading.id}: ${uniqueShipments.length} shipments, ${uniqueChargeShipments.length} chargeShipments después del filtro`);

        return {
          id: unloading.id,
          date: unloading.date,
          subsidiary: {
            id: unloading.subsidiary?.id || 'unknown',
            name: unloading.subsidiary?.name || 'Sucursal Desconocida',
          },
          shipments: uniqueShipments.map(sh => ({
            id: sh.id,
            trackingNumber: sh.trackingNumber,
            status: sh.status,
            commitDateTime: sh.commitDateTime,
            routeId: sh.routeId,
            packageDispatch: sh.packageDispatch ? {
              id: sh.packageDispatch.id,
              trackingNumber: sh.packageDispatch.trackingNumber,
              firstDriverName: this.getFirstDriverName(sh.packageDispatch.drivers),
            } : null,
          })),
          chargeShipments: uniqueChargeShipments.map(cs => ({
            id: cs.id,
            trackingNumber: cs.trackingNumber,
            status: cs.status,
            commitDateTime: cs.commitDateTime,
            routeId: cs.routeId,
            packageDispatch: cs.packageDispatch ? {
              id: cs.packageDispatch.id,
              trackingNumber: cs.packageDispatch.trackingNumber,
              firstDriverName: this.getFirstDriverName(cs.packageDispatch.drivers),
            } : null,
          })),
        };
      }).filter(Boolean);

      console.log('===== DATOS FORMATEADOS =====');
      console.log('Total unloadings a procesar:', formattedData.length);
      
      // Resumen final
      const totalShipments = formattedData.reduce((sum, u) => sum + u.shipments.length, 0);
      const totalChargeShipments = formattedData.reduce((sum, u) => sum + u.chargeShipments.length, 0);
      console.log(`📊 Resumen: ${totalShipments} shipments + ${totalChargeShipments} chargeShipments = ${totalShipments + totalChargeShipments} paquetes total`);

      return formattedData;

    } catch (error) {
      console.error('Error en getUnloadingReport:', error);
      throw error;
    }
  }

  // Métodos auxiliares para conversión de timezone
  private convertHermosilloToUTC(date: Date): Date {
    // Hermosillo es UTC-7, así que para convertir a UTC sumamos 7 horas
    const utcDate = new Date(date.getTime() + (7 * 60 * 60 * 1000));
    return utcDate;
  }

  private convertUTCToHermosillo(date: Date): Date {
    // Para convertir UTC a Hermosillo restamos 7 horas
    const hermosilloDate = new Date(date.getTime() - (7 * 60 * 60 * 1000));
    return hermosilloDate;
  }

  private formatDateForDisplay(dateString: string): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('es-MX', { 
      timeZone: 'America/Hermosillo',
      dateStyle: 'short',
      timeStyle: 'short' 
    });
  }

  private getFirstDriverName(drivers: any[]): string | null {
    if (!drivers || !Array.isArray(drivers) || drivers.length === 0) {
      return null;
    }
    return drivers[0]?.name || null;
  }

  private removeDuplicateShipments(shipments: any[]): any[] {
    if (!shipments || !Array.isArray(shipments)) {
      return [];
    }
    
    const seen = new Set();
    return shipments.filter(shipment => {
      if (!shipment || !shipment.id) {
        return false;
      }
      const key = shipment.id;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async sendUnloadingReportResp() {
    const unloadings = await this.getUnloadingReport();

    // Combinar todos los shipments de todos los unloadings
    let allShipments = [];
    
    unloadings.forEach(unloading => {
        const unloadingShipments = [
            ...(unloading.shipments || []),
            ...(unloading.chargeShipments || [])
        ];
        
        // Agregar información de la descarga a cada shipment
        unloadingShipments.forEach(shipment => {
            if (shipment.trackingNumber) { // Solo incluir si tiene tracking number
                allShipments.push({
                    ...shipment,
                    subsidiaryName: unloading.subsidiary?.name,
                    unloadingDate: unloading.date
                });
            }
        });
    });

    // Si no hay shipments con datos, no enviar correo
    if (allShipments.length === 0) {
        this.logger.debug('No se encontraron shipments para enviar en el reporte');
        return;
    }

    // Ordenar por conductor y luego por tracking number
    allShipments.sort((a, b) => {
        const driverA = a.packageDispatch?.firstDriverName || 'Sin conductor';
        const driverB = b.packageDispatch?.firstDriverName || 'Sin conductor';
        
        if (driverA !== driverB) {
            return driverA.localeCompare(driverB);
        }
        
        return (a.trackingNumber || '').localeCompare(b.trackingNumber || '');
    });

    // Generar filas de la tabla HTML agrupadas por conductor
    let currentDriver = '';
    
    const htmlRows = allShipments
        .map(shipment => {
            const driver = shipment.packageDispatch?.firstDriverName || 'Sin conductor asignado';
            const routeTracking = shipment.packageDispatch?.trackingNumber || 'N/A';
            
            let driverHeader = '';
            if (driver !== currentDriver) {
                currentDriver = driver;
                driverHeader = `
                    <tr style="background-color: #e8f4fd;">
                        <td colspan="6" style="padding: 10px; font-weight: bold; border-bottom: 2px solid #3498db;">
                            🚗 Conductor: ${driver} | Salida a ruta: ${routeTracking}
                        </td>
                    </tr>
                `;
            }

            return `
                ${driverHeader}
                <tr style="border-bottom: 1px solid #ddd;">
                    <td style="padding: 8px; text-align: center;">${shipment.trackingNumber ?? "N/A"}</td>
                    <td style="padding: 8px;">${shipment.subsidiaryName ?? "N/A"}</td>
                    <td style="padding: 8px; text-align: center;">
                        ${
                            shipment.commitDateTime
                            ? new Date(shipment.commitDateTime).toLocaleDateString('es-MX', {
                                timeZone: 'America/Hermosillo',
                            })
                            : "Sin fecha"
                        }
                    </td>
                    <td style="padding: 8px; text-align: center;">
                        <span style="
                            padding: 4px 8px;
                            border-radius: 12px;
                            font-size: 0.85em;
                            font-weight: bold;
                            ${this.getStatusStyle(shipment.status)}
                        ">
                            ${this.translateStatus(shipment.status) ?? "N/A"}
                        </span>
                    </td>
                    <td style="padding: 8px; text-align: center;">${routeTracking}</td>
                </tr>
            `;
        })
        .join("");

    const htmlContent = `
        <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 1000px; margin: auto;">
            <h2 style="border-bottom: 3px solid #e74c3c; padding-bottom: 8px; color: #2c3e50;">
                📦 Reporte Consolidado de Descargas
            </h2>

            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                <h3 style="margin-top: 0; color: #2c3e50;">Resumen General</h3>
                <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 200px;">
                        <strong>Total de paquetes:</strong> ${allShipments.length}<br>
                        <strong>Total de conductores:</strong> ${this.getUniqueDriversCount(allShipments)}<br>
                        <strong>Fecha de generación:</strong> ${new Date().toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo' })}
                    </div>
                    <div style="flex: 1; min-width: 200px;">
                        ${this.generateStatusSummary(allShipments)}
                    </div>
                </div>
            </div>

            <table 
                border="0" 
                cellpadding="0" 
                cellspacing="0" 
                style="border-collapse: collapse; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.05); margin-top: 15px;"
            >
                <thead style="background-color: #2c3e50; color: white; text-align: center;">
                    <tr>
                        <th style="padding: 12px;">Tracking Paquete</th>
                        <th style="padding: 12px;">Sucursal</th>
                        <th style="padding: 12px;">Fecha Compromiso</th>
                        <th style="padding: 12px;">Estatus</th>
                        <th style="padding: 12px;">Tracking Salida</th>
                    </tr>
                </thead>
                <tbody>
                    ${htmlRows}
                </tbody>
            </table>

            <div style="margin-top: 25px; padding: 15px; background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px;">
                <h4 style="margin-top: 0; color: #856404;">📋 Consideraciones</h4>
                <ul style="margin-bottom: 0; color: #856404;">
                    <li>Los paquetes están agrupados por conductor y ordenados por tracking number</li>
                    <li>El <strong>Tracking Salida</strong> corresponde a la salida a ruta del conductor</li>
                    <li>Paquetes con estatus <span style="color: #c0392b; font-weight: bold;">ENTREGADO</span> ya fueron completados</li>
                    <li>Paquetes con estatus <span style="color: #e67e22; font-weight: bold;">EN RUTA</span> están en proceso de entrega</li>
                </ul>
            </div>

            <p style="margin-top: 25px; text-align: center;">
                Para un monitoreo detallado de los envíos, visite: 
                <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none; font-weight: bold;">
                    https://app-pmy.vercel.app/
                </a>
            </p>

            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

            <p style="font-size: 0.9em; color: #7f8c8d; text-align: center;">
                📧 Este correo fue generado automáticamente por el sistema de seguimiento<br />
                ⏰ Hora de generación: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Hermosillo' })}<br />
                🙏 Por favor, no responda a este mensaje
            </p>
        </div>
    `;

    try {
        const result = await this.mailService.sendHighPriorityUnloadingPriorityPackages({
            //to: 'paqueteriaymensajeriadelyaqui@hotmail.com',
            //cc: 'sistemas@paqueteriaymensajeriadelyaqui.com',
            to: 'javier.rappaz@gmail.com',
            htmlContent
        });

        console.log("🚀 ~ UnloadingService ~ sendUnloadingReport ~ result:", result)

        this.logger.debug(`Correo consolidado enviado correctamente con ${allShipments.length} paquetes:`, result);
    } catch (error) {
        this.logger.error('Error al enviar correo consolidado:', error);
    }
  }

  async sendUnloadingReport(startDate?: Date, endDate?: Date) {
    const unloadings = await this.getUnloadingReport(startDate, endDate);

    console.log('===== DEBUG UNLOADINGS =====');
    console.log('Total unloadings:', unloadings.length);
    unloadings.forEach((u, index) => {
        console.log(`Unloading ${index + 1}:`, {
            id: u.id,
            subsidiary: u.subsidiary.name,
            shipments: u.shipments.length,
            chargeShipments: u.chargeShipments.length,
            shipmentsSinRuta: u.shipments.filter(s => !s.packageDispatch?.firstDriverName).length,
            chargeSinRuta: u.chargeShipments.filter(cs => !cs.packageDispatch?.firstDriverName).length
        });
    });

    // Separar paquetes con y sin ruta
    let shipmentsWithRoute = [];
    let shipmentsWithoutRoute = [];
    
    unloadings.forEach(unloading => {
        const unloadingShipments = [
            ...(unloading.shipments || []),
            ...(unloading.chargeShipments || [])
        ];
        
        unloadingShipments.forEach(shipment => {
            if (shipment.trackingNumber) {
                const shipmentWithMeta = {
                    ...shipment,
                    subsidiaryName: unloading.subsidiary?.name,
                    unloadingDate: unloading.date
                };
                
                // DEBUG DETALLADO de cada shipment
                const hasDriver = shipment.packageDispatch?.firstDriverName;
                console.log(`📦 ${shipment.trackingNumber}: ${hasDriver ? 'CON RUTA' : 'SIN RUTA'} - Driver: ${shipment.packageDispatch?.firstDriverName || 'N/A'}`);
                
                if (hasDriver) {
                    shipmentsWithRoute.push(shipmentWithMeta);
                } else {
                    shipmentsWithoutRoute.push(shipmentWithMeta);
                }
            }
        });
    });

    console.log('===== RESUMEN FINAL =====');
    console.log('Total con ruta:', shipmentsWithRoute.length);
    console.log('Total sin ruta:', shipmentsWithoutRoute.length);
    console.log('Ejemplos sin ruta:', shipmentsWithoutRoute.slice(0, 3).map(s => s.trackingNumber));

    // Si no hay shipments con datos, no enviar correo
    if (shipmentsWithRoute.length === 0 && shipmentsWithoutRoute.length === 0) {
        this.logger.debug('No se encontraron shipments para enviar en el reporte');
        return;
    }

    // Ordenar paquetes con ruta por conductor Y por salida a ruta
    shipmentsWithRoute.sort((a, b) => {
        const driverA = a.packageDispatch?.firstDriverName || 'Sin conductor';
        const driverB = b.packageDispatch?.firstDriverName || 'Sin conductor';
        
        if (driverA !== driverB) {
            return driverA.localeCompare(driverB);
        }
        
        const routeA = a.packageDispatch?.trackingNumber || '';
        const routeB = b.packageDispatch?.trackingNumber || '';
        
        if (routeA !== routeB) {
            return routeA.localeCompare(routeB);
        }
        
        return (a.trackingNumber || '').localeCompare(b.trackingNumber || '');
    });

    // Ordenar paquetes sin ruta por tracking number
    shipmentsWithoutRoute.sort((a, b) => {
        return (a.trackingNumber || '').localeCompare(b.trackingNumber || '');
    });

    // Generar HTML para ambas secciones
    const htmlWithRoute = this.generateRouteSection(shipmentsWithRoute, 'Con Salida a Ruta');
    const htmlWithoutRoute = this.generateNoRouteSection(shipmentsWithoutRoute, 'Sin Salida a Ruta');

    // Crear contenido HTML más robusto
    const htmlContent = this.generateEmailContent(
        shipmentsWithRoute, 
        shipmentsWithoutRoute, 
        htmlWithRoute, 
        htmlWithoutRoute
    );

    console.log('===== ENVIANDO CORREO =====');
    console.log('Tamaño aproximado del HTML:', htmlContent.length, 'caracteres');
    
    try {
        const result = await this.mailService.sendHighPriorityUnloadingPriorityPackages({
            to: 'paqueteriaymensajeriadelyaqui@hotmail.com',
            cc: ['sistemas@paqueteriaymensajeriadelyaqui.com','bodegacsl@paqueteriaymensajeriadelyaqui.com'],
            //to: 'javier.rappaz@gmail.com',
            //subject: this.generateEmailSubject(shipmentsWithRoute, shipmentsWithoutRoute, startDate, endDate),
            htmlContent
        });

        this.logger.debug(`✅ Correo enviado: ${shipmentsWithRoute.length} con ruta, ${shipmentsWithoutRoute.length} sin ruta`);
        return {
            success: true,
            withRoute: shipmentsWithRoute.length,
            withoutRoute: shipmentsWithoutRoute.length,
            totalUnloadings: unloadings.length
        };
    } catch (error) {
        console.error('❌ Error al enviar correo:', error);
        this.logger.error('Error al enviar correo:', error);
        throw error;
    }
  }

  // NUEVO MÉTODO para generar el contenido del email de forma más robusta
  private generateEmailContent(
      shipmentsWithRoute: any[], 
      shipmentsWithoutRoute: any[], 
      htmlWithRoute: string, 
      htmlWithoutRoute: string
  ): string {
      return `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reporte de Descargas</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 1000px; margin: auto; padding: 20px;">
      <h2 style="border-bottom: 3px solid #e74c3c; padding-bottom: 8px; color: #2c3e50;">
          📦 Reporte Consolidado de Descargas
      </h2>

      <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #2c3e50;">Resumen General</h3>
          <div style="display: flex; gap: 20px; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 200px;">
                  <strong>Total de paquetes:</strong> ${shipmentsWithRoute.length + shipmentsWithoutRoute.length}<br>
                  <strong>Con salida a ruta:</strong> ${shipmentsWithRoute.length}<br>
                  <strong>Sin salida a ruta:</strong> ${shipmentsWithoutRoute.length}<br>
                  <strong>Total de conductores:</strong> ${this.getUniqueDriversCount(shipmentsWithRoute)}<br>
                  <strong>Total de salidas a ruta:</strong> ${this.getUniqueRoutesCount(shipmentsWithRoute)}<br>
                  <strong>Fecha de generación:</strong> ${new Date().toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo' })}
              </div>
              <div style="flex: 1; min-width: 200px;">
                  ${this.generateStatusSummary([...shipmentsWithRoute, ...shipmentsWithoutRoute])}
              </div>
          </div>
      </div>

      ${htmlWithRoute}
      ${shipmentsWithoutRoute.length > 0 ? htmlWithoutRoute : '<div style="margin-bottom: 30px;"><p>✅ No hay paquetes sin salida a ruta.</p></div>'}

      <div style="margin-top: 25px; padding: 15px; background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px;">
          <h4 style="margin-top: 0; color: #856404;">📋 Consideraciones</h4>
          <ul style="margin-bottom: 0; color: #856404;">
              <li>Los paquetes están agrupados por conductor y salida a ruta, ordenados por tracking number</li>
              <li>El <strong>Tracking Salida</strong> corresponde a la salida a ruta del conductor</li>
              <li>Paquetes <strong>Sin Salida a Ruta</strong> requieren atención inmediata para asignación</li>
              <li>Paquetes con estatus <span style="color: #c0392b; font-weight: bold;">ENTREGADO</span> ya fueron completados</li>
              <li>Paquetes con estatus <span style="color: #e67e22; font-weight: bold;">EN RUTA</span> están en proceso de entrega</li>
          </ul>
      </div>

      <p style="margin-top: 25px; text-align: center;">
          Para un monitoreo detallado de los envíos, visite: 
          <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none; font-weight: bold;">
              https://app-pmy.vercel.app/
          </a>
      </p>

      <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

      <p style="font-size: 0.9em; color: #7f8c8d; text-align: center;">
          📧 Este correo fue generado automáticamente por el sistema de seguimiento<br />
          ⏰ Hora de generación: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Hermosillo' })}<br />
          🙏 Por favor, no responda a este mensaje
      </p>
  </body>
  </html>`;
  }

  // NUEVO MÉTODO para generar el asunto del correo
  private generateEmailSubject(shipmentsWithRoute: any[], shipmentsWithoutRoute: any[], startDate?: Date, endDate?: Date): string {
      const total = shipmentsWithRoute.length + shipmentsWithoutRoute.length;
      const period = startDate && endDate 
          ? `${startDate.toLocaleDateString('es-MX')} a ${endDate.toLocaleDateString('es-MX')}`
          : 'del día';
      
      return `📦 Reporte Descargas: ${total} paquetes (${shipmentsWithRoute.length} con ruta, ${shipmentsWithoutRoute.length} sin ruta) - ${period}`;
  }

  // MÉTODO MEJORADO para sección sin ruta
  private generateNoRouteSection(shipments: any[], title: string): string {
      if (shipments.length === 0) {
          return '';
      }

      const htmlRows = shipments
          .map(shipment => `
              <tr style="border-bottom: 1px solid #ddd;">
                  <td style="padding: 8px; text-align: center;">${shipment.trackingNumber ?? "N/A"}</td>
                  <td style="padding: 8px;">${shipment.subsidiaryName ?? "N/A"}</td>
                  <td style="padding: 8px; text-align: center;">
                      ${
                          shipment.commitDateTime
                          ? new Date(shipment.commitDateTime).toLocaleDateString('es-MX', {
                              timeZone: 'America/Hermosillo',
                          })
                          : "Sin fecha"
                      }
                  </td>
                  <td style="padding: 8px; text-align: center;">
                      <span style="
                          padding: 4px 8px;
                          border-radius: 12px;
                          font-size: 0.85em;
                          font-weight: bold;
                          ${this.getStatusStyle(shipment.status)}
                      ">
                          ${this.translateStatus(shipment.status) ?? "N/A"}
                      </span>
                  </td>
                  <td style="padding: 8px; text-align: center; color: #e74c3c; font-weight: bold;">
                      ⚠️ SIN ASIGNAR
                  </td>
              </tr>
          `)
          .join("");

      return `
          <div style="margin-bottom: 30px;">
              <h3 style="color: #e74c3c; border-left: 4px solid #e74c3c; padding-left: 10px; background-color: #fdf2f2; padding: 10px; border-radius: 4px;">
                  ⚠️ ${title} <span style="font-size: 0.8em; color: #7f8c8d;">(${shipments.length} paquetes)</span>
              </h3>
              <div style="background-color: #fdf2f2; padding: 10px; border-radius: 4px; margin-bottom: 10px;">
                  <p style="margin: 0; color: #e74c3c; font-weight: bold;">
                      ❗ Estos ${shipments.length} paquetes requieren asignación inmediata a una ruta
                  </p>
              </div>
              <table 
                  border="0" 
                  cellpadding="0" 
                  cellspacing="0" 
                  style="border-collapse: collapse; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.05);"
              >
                  <thead style="background-color: #f8d7da; color: #721c24; text-align: center;">
                      <tr>
                          <th style="padding: 12px;">Tracking Paquete</th>
                          <th style="padding: 12px;">Sucursal</th>
                          <th style="padding: 12px;">Fecha Compromiso</th>
                          <th style="padding: 12px;">Estatus</th>
                          <th style="padding: 12px;">Situación</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${htmlRows}
                  </tbody>
              </table>
          </div>
      `;
  }

  // MÉTODO ACTUALIZADO para paquetes con ruta (agrupa por conductor Y salida a ruta)
  private generateRouteSection(shipments: any[], title: string): string {
      let currentDriver = '';
      let currentRoute = '';
      
      const htmlRows = shipments
          .map(shipment => {
              const driver = shipment.packageDispatch?.firstDriverName || 'Sin conductor asignado';
              const routeTracking = shipment.packageDispatch?.trackingNumber || 'N/A';
              
              let routeHeader = '';
              if (driver !== currentDriver || routeTracking !== currentRoute) {
                  currentDriver = driver;
                  currentRoute = routeTracking;
                  routeHeader = `
                      <tr style="background-color: #e8f4fd;">
                          <td colspan="5" style="padding: 10px; font-weight: bold; border-bottom: 2px solid #3498db;">
                              🚗 Conductor: ${driver} | 📦 Salida a ruta: ${routeTracking}
                          </td>
                      </tr>
                  `;
              }

              return `
                  ${routeHeader}
                  <tr style="border-bottom: 1px solid #ddd;">
                      <td style="padding: 8px; text-align: center;">${shipment.trackingNumber ?? "N/A"}</td>
                      <td style="padding: 8px;">${shipment.subsidiaryName ?? "N/A"}</td>
                      <td style="padding: 8px; text-align: center;">
                          ${
                              shipment.commitDateTime
                              ? new Date(shipment.commitDateTime).toLocaleDateString('es-MX', {
                                  timeZone: 'America/Hermosillo',
                              })
                              : "Sin fecha"
                          }
                      </td>
                      <td style="padding: 8px; text-align: center;">
                          <span style="
                              padding: 4px 8px;
                              border-radius: 12px;
                              font-size: 0.85em;
                              font-weight: bold;
                              ${this.getStatusStyle(shipment.status)}
                          ">
                              ${this.translateStatus(shipment.status) ?? "N/A"}
                          </span>
                      </td>
                      <td style="padding: 8px; text-align: center;">${routeTracking}</td>
                  </tr>
              `;
          })
          .join("");

      return `
          <div style="margin-bottom: 30px;">
              <h3 style="color: #2c3e50; border-left: 4px solid #3498db; padding-left: 10px;">
                  📋 ${title} <span style="font-size: 0.8em; color: #7f8c8d;">(${shipments.length} paquetes)</span>
              </h3>
              <table 
                  border="0" 
                  cellpadding="0" 
                  cellspacing="0" 
                  style="border-collapse: collapse; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.05);"
              >
                  <thead style="background-color: #2c3e50; color: white; text-align: center;">
                      <tr>
                          <th style="padding: 12px;">Tracking Paquete</th>
                          <th style="padding: 12px;">Sucursal</th>
                          <th style="padding: 12px;">Fecha Compromiso</th>
                          <th style="padding: 12px;">Estatus</th>
                          <th style="padding: 12px;">Tracking Salida</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${htmlRows || `
                          <tr>
                              <td colspan="5" style="text-align: center; padding: 20px; color: #7f8c8d;">
                                  No hay paquetes en esta categoría
                              </td>
                          </tr>
                      `}
                  </tbody>
              </table>
          </div>
      `;
  }

  // NUEVO MÉTODO para contar salidas a ruta únicas
  private getUniqueRoutesCount(shipments: any[]): number {
      const routes = new Set();
      shipments.forEach(shipment => {
          if (shipment.packageDispatch?.trackingNumber) {
              routes.add(shipment.packageDispatch.trackingNumber);
          }
      });
      return routes.size;
  }

  // Métodos auxiliares
  getUniqueDriversCount(shipments) {
      const drivers = new Set();
      shipments.forEach(shipment => {
          if (shipment.packageDispatch?.firstDriverName) {
              drivers.add(shipment.packageDispatch.firstDriverName);
          }
      });
      return drivers.size;
  }

  generateStatusSummary(shipments) {
      const statusCount = {};
      
      shipments.forEach(shipment => {
          const status = shipment.status || 'desconocido';
          statusCount[status] = (statusCount[status] || 0) + 1;
      });

      const summaryItems = Object.entries(statusCount)
          .map(([status, count]) => 
              `<div style="margin: 3px 0;">
                  <strong>${this.translateStatus(status)}:</strong> ${count}
              </div>`
          )
          .join('');

      return summaryItems;
  }

  getStatusStyle(status) {
      const styles = {
          'entregado': 'background-color: #d4edda; color: #155724;',
          'en_ruta': 'background-color: #fff3cd; color: #856404;',
          'recoleccion': 'background-color: #cce7ff; color: #004085;',
          'no_entregado': 'background-color: #f8d7da; color: #721c24;',
          'desconocido': 'background-color: #e2e3e5; color: #383d41;'
      };
      
      return styles[status] || 'background-color: #f8f9fa; color: #6c757d;';
  }

  translateStatus(status) {
      const translations = {
          'entregado': 'ENTREGADO',
          'en_ruta': 'EN RUTA',
          'recoleccion': 'RECOLECCIÓN',
          'no_entregado': 'NO ENTREGADO',
          'desconocido': 'DESCONOCIDO'
      };
      
      return translations[status] || status?.toUpperCase() || 'N/A';
  }

  async getPriorityFromUnloading(unloading: Unloading) {
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);

    const tomorrowUTC = new Date(todayUTC);
    tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);

    if (!unloading) return null;

    const shipments = (unloading.shipments || []).filter(
      s => s.commitDateTime >= todayUTC && s.commitDateTime < tomorrowUTC
    );

    const chargeShipments = (unloading.chargeShipments || []).filter(
      cs => cs.commitDateTime >= todayUTC && cs.commitDateTime < tomorrowUTC
    );

    const htmlRows = [...shipments, ...chargeShipments]
      .map(
        s => `
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 8px; text-align: center;">${s.trackingNumber ?? "N/A"}</td>
            <td style="padding: 8px;">${s.subsidiary?.name ?? "N/A"}</td>
            <td style="padding: 8px; text-align: center;">
              ${
                s.commitDateTime
                  ? new Date(s.commitDateTime).toLocaleDateString('es-MX', {
                      timeZone: 'America/Hermosillo',
                    })
                  : "Sin fecha"
              }
            </td>
            <td style="padding: 8px; text-align: center;">${s.status ?? "N/A"}</td>
          </tr>
        `
      )
      .join("");

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
        <h2 style="border-bottom: 3px solid #e74c3c; padding-bottom: 8px;">
          Reporte de Descarga con Paquetes Críticos
        </h2>

        <p>
          Dentro de la descarga <strong>${unloading.trackingNumber ?? "N/A"}</strong>
          se han detectado paquetes con fecha de vencimiento el día de hoy 
          (<strong>${new Date(unloading.date).toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo' })}</strong>).
        </p>

        <p style="color:#c0392b; font-weight:bold;">
          Estos envíos deben ser considerados para <u>entrega inmediata</u>.
        </p>

        <table 
          border="0" 
          cellpadding="0" 
          cellspacing="0" 
          style="border-collapse: collapse; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.05); margin-top: 15px;"
        >
          <thead style="background-color: #f7f7f7; text-align: center;">
            <tr>
              <th style="padding: 10px;">Tracking Number</th>
              <th style="padding: 10px;">Destino</th>
              <th style="padding: 10px;">Fecha de Vencimiento</th>
              <th style="padding: 10px;">Estatus</th>
            </tr>
          </thead>
          <tbody>
            ${
              htmlRows ||
              `<tr>
                <td colspan="5" style="text-align: center; padding: 15px; color: #7f8c8d;">
                  No se encontraron paquetes vencidos en el día.
                </td>
              </tr>`
            }
          </tbody>
        </table>

        <p style="margin-top: 20px; font-weight: bold; color: #c0392b;">
          Este correo se genera automáticamente debido a la criticidad de la descarga.
        </p>

        <p style="margin-top: 20px;">
          Para un monitoreo detallado de los envíos, por favor visite: 
          <a href="https://app-pmy.vercel.app/" target="_blank" style="color: #2980b9; text-decoration: none;">
            https://app-pmy.vercel.app/
          </a>
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <p style="font-size: 0.9em; color: #7f8c8d;">
          Este correo fue enviado automáticamente por el sistema.<br />
          Por favor, no responda a este mensaje.
        </p>
      </div>
    `;

    const result = await this.mailService.sendHighPriorityUnloadingPriorityPackages({
      to: 'paqueteriaymensajeriadelyaqui@hotmail.com',
      cc: 'sistemas@paqueteriaymensajeriadelyaqui.com',
      //cc: 'javier.rappaz@gmail.com'
      htmlContent
    });

    this.logger.debug('Correo enviado correctamente:', result);

    return { ...unloading, shipments, chargeShipments };
  }

  async sendByEmail(
    file: Express.Multer.File, 
    excelFile: Express.Multer.File, 
    subsidiaryName: string, 
    unloadingId: string
  ) {
    const unloading = await this.unloadingRepository.findOne({
      where: { id: unloadingId },
      relations: [
        'vehicle', 
        'shipments', 
        'shipments.subsidiary', 
        'chargeShipments', 
        'chargeShipments.subsidiary'
      ],
    });

    if (!unloading) {
      throw new NotFoundException(`Unloading con id ${unloadingId} no encontrado`);
    }

    this.logger.debug(`Unloading encontrado: ${unloading.id}`);

    try {
      // enviar correo con las prioridades
      await this.getPriorityFromUnloading(unloading);
    } catch (err) {
      this.logger.error(`Error enviando correo de prioridades para unloading ${unloading.id}`, err);
    }

    // segundo correo con los archivos adjuntos
    try {
      return await this.mailService.sendHighPriorityUnloadingEmail(
        file,
        excelFile,
        subsidiaryName,
        unloading,
      );
    } catch (err) {
      this.logger.error(`Error enviando correo de unloading con archivos adjuntos para ${unloading.id}`, err);
      throw err; // importante propagar para que el flujo lo sepa
    }
  }

  async findShipmentsByUnloadingId(id: string) {
    // Buscar el Unloading
    const unloading = await this.unloadingRepository.findOne({
      where: { id },
      relations: ['subsidiary'],
    });

    if (!unloading) {
      throw new Error(`No se encontró ningún Unloading con id: ${id}`);
    }

    // Buscar Shipments y ChargeShipments relacionados directamente con el Unloading
    const [shipments, chargeShipments] = await Promise.all([
      this.shipmentRepository.find({
        where: { unloading: { id } },
        relations: [
          'packageDispatch',
          'packageDispatch.drivers',
          'packageDispatch.vehicle',
          'packageDispatch.routes',
          'packageDispatch.subsidiary',
          'packageDispatch.routeClosure',
          'packageDispatch.routeClosure.createdBy',
          'unloading',
          'unloading.subsidiary',
          'subsidiary',
          'payment',
        ],
      }),
      this.chargeShipmentRepository.find({
        where: { unloading: { id } },
        relations: [
          'packageDispatch',
          'packageDispatch.drivers',
          'packageDispatch.vehicle',
          'packageDispatch.routes',
          'packageDispatch.subsidiary',
          'packageDispatch.routeClosure',
          'packageDispatch.routeClosure.createdBy',
          'unloading',
          'unloading.subsidiary',
          'payment',
          'subsidiary'
        ],
      }),
    ]);

    if (shipments.length === 0 && chargeShipments.length === 0) {
      return [];
    }

    const mapShipment = async (shipment: any, isCharge: boolean) => {
      const dispatch = shipment.packageDispatch;
      const inWarehouse = !dispatch;
      const ubication = inWarehouse ? 'EN BODEGA' : 'EN RUTA';
      const driverName =
        dispatch?.drivers?.length && dispatch.drivers[0]
          ? dispatch.drivers[0].name
          : null;

      // 🔍 Buscar el Consolidated manualmente por consNumber
      let consolidated = null;
      if (shipment.consNumber) {
        consolidated = await this.consolidatedReporsitory.findOne({
          where: { consNumber: shipment.consNumber },
        });
      }

      return {
        shipmentData: {
          id: shipment.id,
          trackingNumber: shipment.trackingNumber,
          shipmentStatus: shipment.status,
          commitDateTime: shipment.commitDateTime,
          ubication,
          warehouse: shipment.subsidiary.name,
          unloading: shipment.unloading
            ? {
                trackingNumber: shipment.unloading.trackingNumber,
                date: shipment.unloading.date,
                subsidiary: shipment.unloading.subsidiary
                  ? shipment.unloading.subsidiary.name
                  : null,
              }
            : null,
          consolidated: consolidated
            ? {
                consNumber: consolidated.consNumber,
                date: consolidated.createdAt,
              }
            : null,
          destination: shipment.recipientCity || null,
          payment: shipment.payment ? {
            type: shipment.payment.type,
            amount: +shipment.payment.amount
          } : null,
          createdDate: shipment.createdAt,
          isCharge,
        },
        packageDispatch: dispatch
          ? {
              id: dispatch.id,
              trackingNumber: dispatch.trackingNumber,
              createdAt: dispatch.createdAt,
              status: dispatch.status,
              driver: driverName,
              vehicle: dispatch.vehicle
                ? {
                    name: dispatch.vehicle.name || null,
                    plateNumber: dispatch.vehicle.plateNumber || null,
                  }
                : null,
              routes: dispatch.routes?.length
                ? dispatch.routes.map((r) => r.name)
                : [],
              subsidiary: dispatch.subsidiary
                ? {
                    id: dispatch.subsidiary.id,
                    name: dispatch.subsidiary.name,
                  }
                : null,
              routeClosure: dispatch.routeClosure
                ? {
                    closeDate: dispatch.routeClosure.closeDate,
                    closedBy: dispatch.routeClosure.createdBy
                      ? dispatch.routeClosure.createdBy.name
                      : null,
                  }
                : null,
            }
          : null,
      };
    };

    // Esperar todos los map async
    const normalShipments = await Promise.all(
      shipments.map((s) => mapShipment(s, false)),
    );
    const chargeShipmentsMapped = await Promise.all(
      chargeShipments.map((s) => mapShipment(s, true)),
    );

    return [...normalShipments, ...chargeShipmentsMapped];
  }

  async updateFedexDataByUnloadingId(unloadingId: string) {
    // Validar que se proporcione el ID del unloading
    if (!unloadingId) {
      throw new Error('El ID del unloading es requerido');
    }

    // 1. Buscar el unloading específico por ID
    const unloading = await this.unloadingRepository.findOne({
      where: { id: unloadingId },
      select: ['id', 'trackingNumber'] // Ajusta según el nombre del campo en tu entidad
    });

    if (!unloading) {
      console.warn(`No se encontró el unloading con ID: ${unloadingId}`);
      return [];
    }

    console.log(`🔍 Procesando unloading: ${unloading.trackingNumber}`);

    // 2. Obtener solo IDs y tracking numbers de shipments
    const shipmentsForFedex = [];
    const shipmentsTrackingNumbers = [];
    const chargeShipmentsTrackingNumbers = [];

    // Obtener solo ID y trackingNumber de shipments normales
    const shipments = await this.shipmentRepository.find({
      where: { 
        unloading: { id: unloading.id },
        status: In([ShipmentStatusType.EN_RUTA, ShipmentStatusType.DESCONOCIDO, ShipmentStatusType.PENDIENTE, ShipmentStatusType.NO_ENTREGADO]) 
      },
      select: ['id', 'trackingNumber']
    });

    // Obtener solo ID y trackingNumber de chargeShipments
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { 
        unloading: { id: unloading.id }, 
        status: In([ShipmentStatusType.EN_RUTA, ShipmentStatusType.DESCONOCIDO, ShipmentStatusType.PENDIENTE, ShipmentStatusType.NO_ENTREGADO])
      },
      select: ['id', 'trackingNumber']
    });

    console.log(`📦 Shipments: ${shipments.length}, ChargeShipments: ${chargeShipments.length}`);

    if (shipments.length === 0 && chargeShipments.length === 0) {
      console.warn(`⚠️ No se encontraron shipments para unloading ${unloading.trackingNumber}`);
      return [];
    }

    // Combinar y mapear solo los datos necesarios
    const allShipments = [
      ...shipments.map(s => ({
        id: s.id,
        trackingNumber: s.trackingNumber,
        isCharge: false
      })),
      ...chargeShipments.map(s => ({
        id: s.id,
        trackingNumber: s.trackingNumber,
        isCharge: true
      }))
    ];

    shipmentsTrackingNumbers.push(...shipments.map(s => s.trackingNumber));
    chargeShipmentsTrackingNumbers.push(...chargeShipments.map(s => s.trackingNumber));
    shipmentsForFedex.push(...allShipments);

    console.log(`✅ Unloading ${unloading.trackingNumber}: ${allShipments.length} shipments listos para FedEx`);

    // 3. Procesar con FedEx
    try {
      const result = await this.shipmentService.checkStatusOnFedexBySubsidiaryRulesTesting(shipmentsTrackingNumbers, true);
      const resultChargShipments = await this.shipmentService.checkStatusOnFedexChargeShipment(chargeShipmentsTrackingNumbers);

      // Registrar resultados para auditoría
      this.logger.log(
        `✅ Resultado para unloading ${unloading.trackingNumber}: ` +
        `${result.updatedShipments.length} envíos actualizados, ` +
        `${resultChargShipments.updatedChargeShipments.length} envíos F2 actualizados, ` +
        `${result.shipmentsWithError.length} errores, ` +
        `${resultChargShipments.chargeShipmentsWithError.length} errores de F2, ` +
        `${result.unusualCodes.length} códigos inusuales, ` +
        `${result.shipmentsWithOD.length} excepciones OD o fallos de validación`
      );

      // Registrar detalles de errores, códigos inusuales y excepciones OD si los hay
      if (result.shipmentsWithError.length) {
        this.logger.warn(`⚠️ Errores detectados: ${JSON.stringify(result.shipmentsWithError, null, 2)}`);
      }

      if (resultChargShipments.chargeShipmentsWithError.length) {
        this.logger.warn(`⚠️ Errores detectados en F2: ${JSON.stringify(resultChargShipments.chargeShipmentsWithError, null, 2)}`);
      }

      if (result.unusualCodes.length) {
        this.logger.warn(`⚠️ Códigos inusuales: ${JSON.stringify(result.unusualCodes, null, 2)}`);
      }
      
      if (result.shipmentsWithOD.length) {
        this.logger.warn(`⚠️ Excepciones OD o fallos de validación: ${JSON.stringify(result.shipmentsWithOD, null, 2)}`);
      }

    } catch (err) {
      this.logger.error(`❌ Error al actualizar FedEx para unloading ${unloading.trackingNumber}: ${err.message}`);
    }

    return shipmentsForFedex;
  }




}
