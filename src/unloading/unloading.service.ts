import { forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateUnloadingDto } from './dto/create-unloading.dto';
import { UpdateUnloadingDto } from './dto/update-unloading.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Unloading } from 'src/entities/unloading.entity';
import { Between, In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { Charge, ChargeShipment, Consolidated, Shipment, ShipmentStatus } from 'src/entities';
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
    private readonly shipmentService: ShipmentsService,
    @InjectRepository(ShipmentStatus)
    private readonly shipmentStatusRepository: Repository<ShipmentStatus>
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

    const f2Consolidated = []

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

  async validateTrackingNumbersResp(
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
        // Para cargas: asignar al consolidated indicado por consolidatedId en el charge_shipment
        const mostRecentCharge = chargeMap.get(validated.trackingNumber);
        if (!mostRecentCharge) continue;

        const consolidatedId = (mostRecentCharge as any).consolidatedId;
        if (!consolidatedId) continue; // no consolidatedId -> omitimos (no validar contra charge)

        const consolidated = allConsolidateds.find(c => c.id === consolidatedId);
        if (!consolidated) continue;

        consolidated.added.push({
          trackingNumber: validated.trackingNumber,
          recipientName: validated.recipientName,
          recipientAddress: validated.recipientAddress,
          recipientPhone: validated.recipientPhone,
          recipientZip: validated.recipientZip,
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
          recipientPhone: validated.recipientPhone,
          recipientZip: validated.recipientZip,
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
        select: ['trackingNumber', 'recipientName', 'recipientAddress', 'recipientPhone', 'recipientZip','createdAt'],
      });

      const relatedChargeShipments = await this.chargeShipmentRepository.find({
        where: {
          consolidatedId: consolidated.id,
          status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
        },
        select: ['trackingNumber', 'recipientName', 'recipientAddress', 'recipientPhone', 'recipientZip', 'createdAt'],
      });

      // Combinar y tomar solo el más reciente por tracking number
      const combined = [...relatedShipments, ...relatedChargeShipments];
      const uniqueRelated = getMostRecentByTrackingNumber(combined as any);

      consolidated.notFound = Array.from(uniqueRelated.values())
        .filter(s => !consolidated.added.some(a => a.trackingNumber === (s as any).trackingNumber))
        .map(s => ({
          trackingNumber: (s as any).trackingNumber,
          recipientName: (s as any).recipientName,
          recipientAddress: (s as any).recipientAddress,
          recipientPhone: (s as any).recipientPhone,
          recipientZip: (s as any).recipientZip,
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
        select: ['trackingNumber', 'recipientName', 'recipientAddress', 'recipientPhone', 'recipientZip'],
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
          recipientZip: cs.recipientZip,
        }));
    }

    return { validatedShipments, consolidateds: consolidatedsToValidate };
  }

  async validateTrackingNumbersNew(
    trackingNumbers: string[],
    subsidiaryId?: string
  ): Promise<{
    validatedShipments: (ValidatedUnloadingDto & { isCharge?: boolean })[];
    consolidateds: ConsolidatedsDto;
  }> {
    // 1️⃣ Optimización: Un solo query por tabla con select específico
    const [shipments, chargeShipments] = await Promise.all([
      this.shipmentRepository.find({
        where: { 
          trackingNumber: In(trackingNumbers), 
          status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) 
        },
        select: [
          'id', 'trackingNumber', 'commitDateTime', 'subsidiary', 
          'consolidatedId', 'status', 'recipientName', 
          'recipientAddress', 'recipientPhone', 'recipientZip'
        ],
        relations: ['subsidiary', 'payment'],
        order: { createdAt: 'DESC' },
      }),
      this.chargeShipmentRepository.find({
        where: { 
          trackingNumber: In(trackingNumbers),
          status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
        },
        select: [
          'id', 'trackingNumber', 'commitDateTime', 'subsidiary', 
          'consolidatedId', 'status', 'recipientName', 
          'recipientAddress', 'recipientPhone', 'recipientZip'
        ],
        relations: ['subsidiary'],
        order: { createdAt: 'DESC' },
      })
    ]);

    // 2️⃣ Optimización: Función mejorada para manejar duplicados
    const getMostRecentMap = <T extends { trackingNumber: string; createdAt: Date }>(
      items: T[]
    ): Map<string, T> => {
      const map = new Map<string, T>();
      
      // Orden inverso ya que items ya viene ordenado DESC por createdAt
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        map.set(item.trackingNumber, item); // El primero encontrado es el más reciente
      }
      
      return map;
    };

    // Crear mapas con los registros más recientes
    const shipmentsMap = getMostRecentMap(shipments);
    const chargeMap = getMostRecentMap(chargeShipments);

    // 3️⃣ DEBUG solo en desarrollo
    if (process.env.NODE_ENV === 'development') {
      console.log('=== DEBUG DUPLICADOS ===');
      console.log('Total shipments:', shipments.length);
      console.log('Total chargeShipments:', chargeShipments.length);
      console.log('Shipments únicos:', shipmentsMap.size);
      console.log('ChargeShipments únicos:', chargeMap.size);
    }

    // 4️⃣ Obtener consolidados en paralelo con la validación
    const [consolidatedsToValidate, validatedShipments] = await Promise.all([
      this.getConsolidateToStartUnloading(subsidiaryId),
      (async () => {
        const validated: (ValidatedUnloadingDto & { isCharge?: boolean })[] = [];
        const validationPromises: Promise<void>[] = [];

        // Preprocesar tracking numbers únicos para evitar validaciones duplicadas
        const uniqueTNs = [...new Set(trackingNumbers)];
        const processedTNs = new Set<string>();

        for (const tn of uniqueTNs) {
          // Verificar si ya procesamos este TN
          if (processedTNs.has(tn)) continue;
          processedTNs.add(tn);

          // Determinar el registro más reciente
          const shipment = shipmentsMap.get(tn);
          const charge = chargeMap.get(tn);
          let recordToValidate: any = null;
          let isCharge = false;

          if (shipment && charge) {
            // Comparar fechas directamente (ya vienen ordenadas)
            isCharge = new Date(charge.createdAt) > new Date(shipment.createdAt);
            recordToValidate = isCharge ? charge : shipment;
            
            if (process.env.NODE_ENV === 'development') {
              console.log(`⚠️ TN ${tn} duplicado. Usando: ${isCharge ? 'CHARGE' : 'SHIPMENT'}`);
            }
          } else if (shipment) {
            recordToValidate = shipment;
            isCharge = false;
          } else if (charge) {
            recordToValidate = charge;
            isCharge = true;
          }

          if (recordToValidate) {
            // Validar en paralelo
            validationPromises.push(
              this.validatePackage({ ...recordToValidate, isValid: false }, subsidiaryId)
                .then(validatedResult => {
                  validated.push({ ...validatedResult, isCharge });
                })
            );
          } else {
            validated.push({
              trackingNumber: tn,
              isValid: false,
              reason: 'No se encontraron datos para el tracking number en la base de datos',
              subsidiary: null,
              status: null,
              isCharge: false,
            });
          }
        }

        await Promise.all(validationPromises);
        return validated;
      })()
    ]);

    const allConsolidateds: ConsolidatedItemDto[] = Object.values(consolidatedsToValidate).flat();

    // 5️⃣ Inicializar arrays added/notFound
    allConsolidateds.forEach(consolidated => {
      consolidated.added = [];
      consolidated.notFound = [];
    });

    // 6️⃣ Optimización: Crear índices para búsqueda rápida
    const consolidatedById = new Map<string, ConsolidatedItemDto>(
      allConsolidateds.map(c => [c.id, c])
    );

    // 7️⃣ Asignar válidos a added (solo los que existen en los mapas)
    const validShipments = validatedShipments.filter(v => v.isValid);
    
    for (const validated of validShipments) {
      const tn = validated.trackingNumber;
      let consolidated: ConsolidatedItemDto | undefined;
      let consolidatedId: string | undefined;

      // Determinar consolidatedId según tipo
      if (validated.isCharge) {
        const chargeRecord = chargeMap.get(tn);
        consolidatedId = chargeRecord?.consolidatedId || (chargeRecord as any)?.charge?.id;
      } else {
        const shipmentRecord = shipmentsMap.get(tn);
        consolidatedId = shipmentRecord?.consolidatedId;
      }

      if (consolidatedId) {
        consolidated = consolidatedById.get(consolidatedId);
      }

      if (consolidated) {
        consolidated.added.push({
          trackingNumber: validated.trackingNumber,
          recipientName: validated.recipientName,
          recipientAddress: validated.recipientAddress,
          recipientPhone: validated.recipientPhone,
          recipientZip: validated.recipientZip,
        });
      }
    }

    // 8️⃣ Optimización: Procesar notFound en paralelo por tipo de consolidado
    const notFoundPromises = allConsolidateds.map(async (consolidated) => {
      if (consolidated.typeCode === 'F2') {
        // Caso especial F2
        const f2ChargeShipments = await this.chargeShipmentRepository.find({
          where: { 
            charge: { id: consolidated.id },
            status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
          },
          select: [
            'trackingNumber', 'createdAt', 'recipientName', 
            'recipientAddress', 'recipientPhone', 'recipientZip'
          ],
          relations: ['charge'],
          order: { createdAt: 'DESC' },
        });

        const uniqueF2Shipments = getMostRecentMap(f2ChargeShipments);
        
        consolidated.notFound = Array.from(uniqueF2Shipments.values())
          .filter(cs => !consolidated.added.some(a => a.trackingNumber === cs.trackingNumber))
          .map(cs => ({
            trackingNumber: cs.trackingNumber,
            recipientName: cs.recipientName,
            recipientAddress: cs.recipientAddress,
            recipientPhone: cs.recipientPhone,
            recipientZip: cs.recipientZip,
          }));
      } else {
        // Para AÉREO / TERRESTRE
        const [relatedShipments, relatedChargeShipments] = await Promise.all([
          this.shipmentRepository.find({
            where: { 
              consolidatedId: consolidated.id,
              status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
            },
            select: [
              'trackingNumber', 'createdAt', 'recipientName', 
              'recipientAddress', 'recipientPhone', 'recipientZip'
            ],
            order: { createdAt: 'DESC' },
          }),
          this.chargeShipmentRepository.find({
            where: {
              consolidatedId: consolidated.id,
              status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
            },
            select: [
              'trackingNumber', 'createdAt', 'recipientName', 
              'recipientAddress', 'recipientPhone', 'recipientZip'
            ],
            order: { createdAt: 'DESC' },
          })
        ]);

        const combined = [...relatedShipments, ...relatedChargeShipments];
        const uniqueRelated = getMostRecentMap(combined);
        
        consolidated.notFound = Array.from(uniqueRelated.values())
          .filter(s => !consolidated.added.some(a => a.trackingNumber === s.trackingNumber))
          .map(s => ({
            trackingNumber: s.trackingNumber,
            recipientName: s.recipientName,
            recipientAddress: s.recipientAddress,
            recipientPhone: s.recipientPhone,
            recipientZip: s.recipientZip,
          }));
      }
    });

    await Promise.all(notFoundPromises);

    // 9️⃣ DEBUG solo en desarrollo
    if (process.env.NODE_ENV === 'development') {
      console.log('=== DEBUG ASIGNACIÓN ===');
      console.log('Total validados:', validatedShipments.length);
      console.log('Válidos:', validShipments.length);
      
      allConsolidateds.forEach(consolidated => {
        console.log(`Consolidado ${consolidated.id} (${consolidated.typeCode}): ${consolidated.added.length} added, ${consolidated.notFound.length} notFound`);
      });
      console.log('=== FIN DEBUG ===');
    }

    return { validatedShipments, consolidateds: consolidatedsToValidate };
  }

  async validateTrackingNumbers(
    trackingNumbers: string[],
    subsidiaryId?: string
  ): Promise<{
    validatedShipments: (ValidatedUnloadingDto & { isCharge?: boolean })[];
    consolidateds: ConsolidatedsDto;
  }> {
    // 0️⃣ Limpiar y normalizar tracking numbers
    const cleanTrackingNumbers = trackingNumbers
      .map(tn => tn.trim().toUpperCase())
      .filter(tn => tn.length > 0);
    
    if (cleanTrackingNumbers.length === 0) {
      const emptyConsolidateds = await this.getConsolidateToStartUnloading(subsidiaryId);
      return { validatedShipments: [], consolidateds: emptyConsolidateds };
    }

    const uniqueTNs = [...new Set(cleanTrackingNumbers)];
    const tnCount = uniqueTNs.length;

    // 1️⃣ Estrategia según volumen
    const useBatches = tnCount > 50;
    const batchSize = tnCount > 200 ? 50 : 25;

    // 2️⃣ Obtener datos en paralelo
    const [shipments, chargeShipments, consolidatedsToValidate] = await Promise.all([
      this.shipmentRepository.find({
        where: { 
          trackingNumber: In(uniqueTNs), 
          status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX) 
        },
        select: [
          'id', 'trackingNumber', 'commitDateTime', 'createdAt',
          'consolidatedId', 'status', 'recipientName', 
          'recipientAddress', 'recipientPhone', 'recipientZip'
        ],
        relations: ['subsidiary'],
        order: { createdAt: 'DESC' },
        take: Math.min(uniqueTNs.length * 2, 5000),
      }),
      this.chargeShipmentRepository.find({
        where: { 
          trackingNumber: In(uniqueTNs),
          status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
        },
        select: [
          'id', 'trackingNumber', 'commitDateTime','createdAt',
          'consolidatedId', 'status', 'recipientName', 
          'recipientAddress', 'recipientPhone', 'recipientZip'
        ],
        relations: ['subsidiary'],
        order: { createdAt: 'DESC' },
        take: Math.min(uniqueTNs.length * 2, 5000),
      }),
      this.getConsolidateToStartUnloading(subsidiaryId)
    ]);

    // 3️⃣ Crear mapas con los registros más recientes
    const shipmentsMap = this.createMostRecentMap(shipments);
    const chargeMap = this.createMostRecentMap(chargeShipments);

    // 4️⃣ Validación optimizada
    const validatedShipments = useBatches 
      ? await this.validateInBatches(uniqueTNs, shipmentsMap, chargeMap, subsidiaryId, batchSize)
      : await this.validateSequentially(uniqueTNs, shipmentsMap, chargeMap, subsidiaryId);

    const allConsolidateds: ConsolidatedItemDto[] = Object.values(consolidatedsToValidate).flat();

    // 5️⃣ Inicializar arrays
    allConsolidateds.forEach(consolidated => {
      consolidated.added = [];
      consolidated.notFound = [];
    });

    // 6️⃣ Crear índice de consolidados
    const consolidatedById = new Map<string, ConsolidatedItemDto>(
      allConsolidateds.map(c => [c.id, c])
    );

    // 7️⃣ Asignar válidos a added
    const validShipments = validatedShipments.filter(v => v.isValid);
    
    for (const validated of validShipments) {
      const tn = validated.trackingNumber;
      let consolidatedId: string | undefined;

      if (validated.isCharge) {
        const chargeRecord = chargeMap.get(tn);
        consolidatedId = chargeRecord?.consolidatedId;
      } else {
        const shipmentRecord = shipmentsMap.get(tn);
        consolidatedId = shipmentRecord?.consolidatedId;
      }

      if (consolidatedId) {
        const consolidated = consolidatedById.get(consolidatedId);
        if (consolidated) {
          consolidated.added.push({
            trackingNumber: validated.trackingNumber,
            recipientName: validated.recipientName,
            recipientAddress: validated.recipientAddress,
            recipientPhone: validated.recipientPhone,
            recipientZip: validated.recipientZip,
          });
        }
      }
    }

    // 8️⃣ Calcular notFound DIRECTAMENTE desde consolidados
    await this.calculateNotFoundFromConsolidates(
      allConsolidateds,
      validatedShipments.filter(v => v.isValid)
    );

    // 9️⃣ Logs opcionales
    if (process.env.NODE_ENV === 'development') {
      console.log(`📊 Validados: ${validatedShipments.length}, Válidos: ${validShipments.length}`);
      allConsolidateds.forEach(c => {
        console.log(`🏷️ ${c.typeCode} ${c.id}: ${c.added.length} added, ${c.notFound.length} notFound`);
      });
    }

    return { validatedShipments, consolidateds: consolidatedsToValidate };
  }

  // ============ MÉTODOS HELPER ============

  private createMostRecentMap<T extends { trackingNumber: string; createdAt: Date }>(
    items: T[]
  ): Map<string, T> {
    const map = new Map<string, T>();
    
    for (const item of items) {
      if (!map.has(item.trackingNumber)) {
        map.set(item.trackingNumber, item);
      }
    }
    
    return map;
  }

  private async validateSequentially(
    trackingNumbers: string[],
    shipmentsMap: Map<string, any>,
    chargeMap: Map<string, any>,
    subsidiaryId?: string
  ): Promise<(ValidatedUnloadingDto & { isCharge?: boolean })[]> {
    const results: (ValidatedUnloadingDto & { isCharge?: boolean })[] = [];

    for (const tn of trackingNumbers) {
      const shipment = shipmentsMap.get(tn);
      const charge = chargeMap.get(tn);
      
      let recordToValidate: any = null;
      let isCharge = false;

      if (shipment && charge) {
        const shipmentDate = shipment.updatedAt || shipment.createdAt;
        const chargeDate = charge.updatedAt || charge.createdAt;
        isCharge = new Date(chargeDate) > new Date(shipmentDate);
        recordToValidate = isCharge ? charge : shipment;
      } else if (shipment) {
        recordToValidate = shipment;
      } else if (charge) {
        recordToValidate = charge;
        isCharge = true;
      }

      if (recordToValidate) {
        try {
          const validated = await this.validatePackage(
            { ...recordToValidate, isValid: false },
            subsidiaryId
          );
          results.push({ ...validated, isCharge });
        } catch (error) {
          results.push({
            trackingNumber: tn,
            isValid: false,
            reason: `Error: ${error instanceof Error ? error.message : 'Desconocido'}`,
            subsidiary: null,
            status: null,
            isCharge: false,
          });
        }
      } else {
        results.push({
          trackingNumber: tn,
          isValid: false,
          reason: 'No se encontraron datos para el tracking number',
          subsidiary: null,
          status: null,
          isCharge: false,
        });
      }
    }

    return results;
  }

  private async validateInBatches(
    trackingNumbers: string[],
    shipmentsMap: Map<string, any>,
    chargeMap: Map<string, any>,
    subsidiaryId?: string,
    batchSize: number = 25
  ): Promise<(ValidatedUnloadingDto & { isCharge?: boolean })[]> {
    const results: (ValidatedUnloadingDto & { isCharge?: boolean })[] = [];
    const batches = this.chunkArray(trackingNumbers, batchSize);

    for (const batch of batches) {
      const batchPromises = batch.map(async (tn) => {
        const shipment = shipmentsMap.get(tn);
        const charge = chargeMap.get(tn);
        
        let recordToValidate: any = null;
        let isCharge = false;

        if (shipment && charge) {
          const shipmentDate = shipment.createdAt;
          const chargeDate = charge.createdAt;
          isCharge = new Date(chargeDate) > new Date(shipmentDate);
          recordToValidate = isCharge ? charge : shipment;
        } else if (shipment) {
          recordToValidate = shipment;
        } else if (charge) {
          recordToValidate = charge;
          isCharge = true;
        }

        if (recordToValidate) {
          try {
            const validated = await this.validatePackage(
              { ...recordToValidate, isValid: false },
              subsidiaryId
            );
            return { ...validated, isCharge };
          } catch (error) {
            return {
              trackingNumber: tn,
              isValid: false,
              reason: `Error: ${error instanceof Error ? error.message : 'Desconocido'}`,
              subsidiary: null,
              status: null,
              isCharge: false,
            };
          }
        }
        
        return {
          trackingNumber: tn,
          isValid: false,
          reason: 'No encontrado',
          subsidiary: null,
          status: null,
          isCharge: false,
        };
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private async calculateNotFoundFromConsolidates(
    allConsolidateds: ConsolidatedItemDto[],
    validShipments: ValidatedUnloadingDto[]
  ): Promise<void> {
    const validTNs = new Set(validShipments.map(v => v.trackingNumber));
    
    const f2Consolidateds = allConsolidateds.filter(c => c.typeCode === 'F2');
    const nonF2Consolidateds = allConsolidateds.filter(c => c.typeCode !== 'F2');

    const processPromises: Promise<void>[] = [];

    if (nonF2Consolidateds.length > 0) {
      const nonF2Ids = nonF2Consolidateds.map(c => c.id);
      
      const [allShipments, allChargeShipments] = await Promise.all([
        this.shipmentRepository.find({
          where: {
            consolidatedId: In(nonF2Ids),
            status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
          },
          select: ['trackingNumber', 'consolidatedId', 'recipientName', 'recipientAddress', 'recipientPhone', 'recipientZip'],
        }),
        this.chargeShipmentRepository.find({
          where: {
            consolidatedId: In(nonF2Ids),
            status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
          },
          select: ['trackingNumber', 'consolidatedId', 'recipientName', 'recipientAddress', 'recipientPhone', 'recipientZip'],
        })
      ]);

      const shipmentsByConsolidated = this.groupByConsolidatedId(allShipments);
      const chargesByConsolidated = this.groupByConsolidatedId(allChargeShipments);

      nonF2Consolidateds.forEach(consolidated => {
        const shipments = shipmentsByConsolidated.get(consolidated.id) || [];
        const charges = chargesByConsolidated.get(consolidated.id) || [];
        
        const allItems = [...shipments, ...charges];
        const uniqueItems = this.removeDuplicateTNs(allItems);
        
        consolidated.notFound = uniqueItems
          .filter(item => !validTNs.has(item.trackingNumber))
          .map(item => ({
            trackingNumber: item.trackingNumber,
            recipientName: item.recipientName,
            recipientAddress: item.recipientAddress,
            recipientPhone: item.recipientPhone,
            recipientZip: item.recipientZip,
          }));
      });
    }

    /*if (f2Consolidateds.length > 0) {
      const f2Ids = f2Consolidateds.map(c => c.id);
      
      const f2ChargeShipments = await this.chargeShipmentRepository.find({
        where: {
          chargeId: In(f2Ids),
          status: Not(ShipmentStatusType.DEVUELTO_A_FEDEX)
        },
        select: ['trackingNumber', 'chargeId', 'recipientName', 'recipientAddress', 'recipientPhone', 'recipientZip'],
      });

      const chargesByF2Id = this.groupByChargeId(f2ChargeShipments);

      f2Consolidateds.forEach(consolidated => {
        const charges = chargesByF2Id.get(consolidated.id) || [];
        const uniqueItems = this.removeDuplicateTNs(charges);
        
        consolidated.notFound = uniqueItems
          .filter(item => !validTNs.has(item.trackingNumber))
          .map(item => ({
            trackingNumber: item.trackingNumber,
            recipientName: item.recipientName,
            recipientAddress: item.recipientAddress,
            recipientPhone: item.recipientPhone,
            recipientZip: item.recipientZip,
          }));
      });
    }*/

    await Promise.all(processPromises);
  }

  private groupByConsolidatedId(items: any[]): Map<string, any[]> {
    const map = new Map<string, any[]>();
    items.forEach(item => {
      if (item.consolidatedId) {
        if (!map.has(item.consolidatedId)) {
          map.set(item.consolidatedId, []);
        }
        map.get(item.consolidatedId)!.push(item);
      }
    });
    return map;
  }

  private groupByChargeId(items: any[]): Map<string, any[]> {
    const map = new Map<string, any[]>();
    items.forEach(item => {
      if (item.chargeId) {
        if (!map.has(item.chargeId)) {
          map.set(item.chargeId, []);
        }
        map.get(item.chargeId)!.push(item);
      }
    });
    return map;
  }

  private removeDuplicateTNs(items: any[]): any[] {
    const uniqueMap = new Map<string, any>();
    
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (!uniqueMap.has(item.trackingNumber)) {
        uniqueMap.set(item.trackingNumber, item);
      }
    }
    
    return Array.from(uniqueMap.values());
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

    // Reutilidad local: tomar el más reciente por trackingNumber
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
        // Para cargas: asignar al consolidated indicado por consolidatedId del charge_shipment
        const mostRecentCharge = chargeShipment; // ya obtuvimos el chargeShipment al inicio
        if (mostRecentCharge && (mostRecentCharge as any).consolidatedId) {
          const consolidated = allConsolidateds.find(c => c.id === (mostRecentCharge as any).consolidatedId);
          if (consolidated) {
            consolidated.added.push({
              trackingNumber: validated.trackingNumber,
              recipientName: validated.recipientName,
              recipientAddress: validated.recipientAddress,
              recipientPhone: validated.recipientPhone
            });
          }
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
        select: ['trackingNumber', 'recipientName', 'recipientAddress', 'recipientPhone', 'createdAt'],
      });

      const relatedChargeShipments = await this.chargeShipmentRepository.find({
        where: { consolidatedId: consolidated.id },
        select: ['trackingNumber', 'recipientName', 'recipientAddress', 'recipientPhone', 'createdAt'],
      });

      const combined = [...relatedShipments, ...relatedChargeShipments];
      const unique = getMostRecentByTrackingNumber(combined as any);

      consolidated.notFound = Array.from(unique.values())
        .filter(s => !consolidated.added.some(a => a.trackingNumber === (s as any).trackingNumber))
        .map(s => ({
          trackingNumber: (s as any).trackingNumber,
          recipientName: (s as any).recipientName,
          recipientAddress: (s as any).recipientAddress,
          recipientPhone: (s as any).recipientPhone,
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
  async findBySubsidiaryIdResp(subsidiaryId: string) {
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

  async findBySubsidiaryId(subsidiaryId: string) {
    // Calcular la fecha límite (5 días antes de hoy)
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    // Opcional: establecer a medianoche para incluir todo el día
    fiveDaysAgo.setHours(0, 0, 0, 0);


    // Traer unloadings con la relación directa a vehicle
    const unloadings = await this.unloadingRepository.find({
      where: { 
        subsidiary: { id: subsidiaryId },
        date: MoreThanOrEqual(fiveDaysAgo)
      },
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
      relations: ['vehicle', 'subsidiary'],
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
      to: unloading.subsidiary.officeEmail,
      cc: `${unloading.subsidiary.officeEmailToCopy}, sistemas@paqueteriaymensajeriadelyaqui.com`,
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
        'subsidiary',
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

    // Buscar Shipments y ChargeShipments
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

    // ===================================================
    // 🔥 NUEVA FUNCIONES REUSABLES
    // ===================================================

    // 1. DaysInWarehouse
    const calcDaysInWarehouse = (createdAt: Date, status: string) => {
      //if (status !== 'entre') return "N/A";
      const today = new Date();
      const created = new Date(createdAt);
      const diff = Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      return diff;
    };

    // ========= 🔥 Helper: obtener dexCode =========
    const getDexCode = async (shipmentId: string, status: string) => {
      if (status !== 'no_entregado') return null;

      const row = await this.shipmentStatusRepository
        .createQueryBuilder('ss')
        .select('ss.exceptionCode', 'exceptionCode')
        .where('ss.shipmentId = :shipmentId', { shipmentId })
        .orderBy('ss.createdAt', 'DESC')
        .limit(1)
        .getRawOne();

      return row?.exceptionCode ?? null;
    };



    // ===================================================
    // MAPEO
    // ===================================================

    const mapShipment = async (shipment: any, isCharge: boolean) => {
      const dispatch = shipment.packageDispatch;

      const inWarehouse = !dispatch;
      const ubication = inWarehouse ? 'EN BODEGA' : 'EN RUTA';

      const driverName =
        dispatch?.drivers?.length && dispatch.drivers[0]
          ? dispatch.drivers[0].name
          : null;

      // Consolidated manual por consNumber
      let consolidated = null;
      if (shipment.consNumber) {
        consolidated = await this.consolidatedReporsitory.findOne({
          where: { consNumber: shipment.consNumber },
        });
      }

      // =============================
      // NUEVO: Calculamos valores
      // =============================
      const daysInWarehouse = calcDaysInWarehouse(
        shipment.createdAt,
        shipment.status
      );

      const dexCode = await getDexCode(
        shipment.id,
        shipment.status
      );


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

          payment: shipment.payment
            ? {
                type: shipment.payment.type,
                amount: +shipment.payment.amount
              }
            : null,

          createdDate: shipment.createdAt,

          recipientName: shipment.recipientName,
          recipientAddress: shipment.recipientAddress,
          recipientPhone: shipment.recipientPhone,
          recipientZip: shipment.recipientZip,

          shipmentType: shipment.shipmentType,

          daysInWareHouse: daysInWarehouse,
          dexCode,

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

    // Ejecutar mapeo async
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

  async getShipmentsWithout67ByUnloading(id: string){
    const shipmentsWithout67 = [];

    const shipments = await this.shipmentRepository.find({
      where: { unloading: { id } },
      relations: [
        'statusHistory',

      ],
    });

    console.log("📦 Shipments encontrados:", shipments.length);

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { unloading: { id } },
      relations: [
        'statusHistory',
      ],
    });

    console.log("⚡ ChargeShipments encontrados:", chargeShipments.length);

    const allShipments = [...shipments, chargeShipments]

    for (const shipment of shipments) {
        try {
          if (!shipment.statusHistory || shipment.statusHistory.length === 0) {
            shipmentsWithout67.push({
              trackingNumber: shipment.trackingNumber,
              currentStatus: shipment.status,
              statusHistoryCount: 0,
              exceptionCodes: [],
              firstStatusDate: null,
              lastStatusDate: null,
              comment: 'Sin historial de estados',
            });
            continue;
          }

          const sortedHistory = shipment.statusHistory.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );

          const hasExceptionCode67 = sortedHistory.some(status => 
            status.exceptionCode === '67'
          );

          if (!hasExceptionCode67) {
            const firstStatus = sortedHistory[0];
            const lastStatus = sortedHistory[sortedHistory.length - 1];

            const exceptionCodes = sortedHistory
              .map(h => h.exceptionCode)
              .filter(code => code !== null && code !== undefined);

            shipmentsWithout67.push({
              trackingNumber: shipment.trackingNumber,
              recipientAddress: shipment.recipientAddress,
              recipientName: shipment.recipientName,
              recipientCity: shipment.recipientCity,
              recipientZip: shipment.recipientZip,
              currentStatus: shipment.status,
              statusHistoryCount: sortedHistory.length,
              exceptionCodes: [...new Set(exceptionCodes)],
              firstStatusDate: firstStatus?.timestamp,
              lastStatusDate: lastStatus?.timestamp,
              comment: 'No tiene exceptionCode 67',
            });
          }

        } catch (error) {
          shipmentsWithout67.push({
            trackingNumber: shipment.trackingNumber,
            currentStatus: shipment.status,
            statusHistoryCount: 0,
            exceptionCodes: [],
            firstStatusDate: null,
            lastStatusDate: null,
            comment: `Error: ${error.message}`,
          });
        }
      }

    return { 
      count: shipmentsWithout67.length,
      shipments: shipmentsWithout67
    };

  }


}
