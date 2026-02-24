import { BadRequestException, forwardRef, Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Brackets, EntityManager, In, Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import * as XLSX from 'xlsx';
import { FedexService } from './fedex.service';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { getPriority, parseDynamicFileF2, parseDynamicHighValue, parseDynamicSheet, parseDynamicSheetCharge, parseDynamicSheetDHL } from 'src/utils/file-upload.utils';
import { scanEventsFilter } from 'src/utils/scan-events-filter';
import { ParsedShipmentDto } from './dto/parsed-shipment.dto';
import { mapFedexStatusToLocalStatus } from 'src/utils/fedex.utils';
import { addDays, differenceInDays, endOfToday, format, isSameDay, parse, parseISO, startOfToday } from 'date-fns';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { Consolidated, Income, Payment, Subsidiary } from 'src/entities';
import { PaymentStatus } from 'src/common/enums/payment-status.enum';
import { DHLService } from './dto/dhl.service';
import { DhlShipmentDto } from './dto/dhl/dhl-shipment.dto';
import { FedExScanEventDto, FedExTrackingResponseDto } from './dto/fedex/fedex-tracking-response.dto';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { Priority } from 'src/common/enums/priority.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import * as stringSimilarity from 'string-similarity';
import * as path from 'path';
import { Charge } from 'src/entities/charge.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { ShipmentAndChargeDto } from './dto/shipment-and-charge.dto';
import { ChargeWithStatusDto } from './dto/charge-with-status.dto';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { GetShipmentKpisDto } from './dto/get-shipment-kpis.dto';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { ConsolidatedType } from 'src/common/enums/consolidated-type.enum';
import { fromZonedTime, toDate, toZonedTime } from 'date-fns-tz';
import { MailService } from 'src/mail/mail.service';
import { SubsidiaryRules } from './dto/subsidiary-rules';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { ForPickUpDto } from './dto/for-pick-up.dto';
import { IncomeValidationResult } from './dto/income-validation.dto';
import { FedexTrackingResponseDto } from './dto/check-status-result.dto';
import { PaymentTypeEnum } from 'src/common/enums/payment-type.enum';
import { ShipmentStatusForReportDto } from 'src/mail/dtos/shipment.dto';
import { SearchShipmentDto } from './dto/search-package.dto';
import { ShipmentToSaveDto } from './dto/shipment-to-save.dto';
import * as ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import pLimit from 'p-limit';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import * as fs from 'node:fs/promises'; // Para el código viejo (await)
import * as fsSync from 'node:fs';
import { Unloading } from 'src/entities/unloading.entity';
import * as dayjs from 'dayjs';
import * as isoWeek from 'dayjs/plugin/isoWeek';
import { ReturnValidationDto } from './dto/returning-validation.dto';

dayjs.extend(isoWeek);

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);
  
  /*** Temporal */
  private citiesNotClasified = [];

  private timestamp = new Date().toISOString();
  private logBuffer: string[] = [];
  private shipmentBatch: Shipment[] = [];
  private readonly logFilePath = path.join(__dirname, `../../logs/shipment-logs.log`);
  private readonly BATCH_SIZE = 100;

  constructor(
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>,
    @InjectRepository(Income)
    private incomeRepository: Repository<Income>,
    @InjectRepository(Subsidiary)
    private subsidiaryRepository: Repository<Subsidiary>,
    @InjectRepository(Charge)
    private chargeRepository: Repository<Charge>,    
    @InjectRepository(ChargeShipment)
    private chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(ShipmentStatus)
    private shipmentStatusRepository: Repository<ShipmentStatus>,
    @InjectRepository(Unloading)
    private unloadingRepository: Repository<Unloading>,
    @InjectRepository(PackageDispatch)
    private packageDispatchRepository: Repository<PackageDispatch>,
    @InjectRepository(Consolidated)
    private consolidatedRepository: Repository<Consolidated>,
    @InjectRepository(ForPickUp)
    private forPickUpRepository: Repository<ForPickUp>,
    private readonly fedexService: FedexService,
    private readonly dhlService: DHLService,
    private readonly subsidiaryService: SubsidiariesService,
    @Inject(forwardRef(() => ConsolidatedService))
    private readonly consolidatedService: ConsolidatedService,
    private readonly mailService: MailService,
    private dataSource: DataSource,
  ) { }

  async appendLogToFile(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    const logFilePath = path.resolve(__dirname, `../../logs/shipment-process-errors-${timestamp}.log`);
        
    try {
      await fs.appendFile(logFilePath, logMessage);
    } catch (error) {
      console.error('Error escribiendo en el archivo de log:', error);
    }
  }

  /*** Puede quedar obsoleta */
  async processScanEvents(
    scanEvents: FedExScanEventDto[],
    fedexShipmentData: FedExTrackingResponseDto,
    savedShipment: Shipment
  ): Promise<ShipmentStatus[]> {
    const shipmentStatus: ShipmentStatus[] = [];
    const filteredScanEvents: FedExScanEventDto[] = [];

    if (scanEvents.length === 0) {
      filteredScanEvents.push(
        ...scanEventsFilter(
          fedexShipmentData.output.completeTrackResults[0].trackResults[0].scanEvents,
          "At local FedEx facility"
        )
      );
    } else {
      filteredScanEvents.push(...scanEvents);
    }

    if (filteredScanEvents.length === 0) {
      filteredScanEvents.push(
        ...scanEventsFilter(
          fedexShipmentData.output.completeTrackResults[0].trackResults[0].scanEvents,
          "On FedEx vehicle for delivery"
        )
      );
    }

    const targetExceptionCodes = ['07', '03'];

    for (const scanEvent of filteredScanEvents) {
      const isInicialState =
        scanEvent.date === filteredScanEvents[filteredScanEvents.length - 1].date;

      const newShipmentStatus = new ShipmentStatus();
      const rawDate = scanEvent.date;
      const eventDate = new Date(rawDate);

      newShipmentStatus.status = isInicialState
        ? ShipmentStatusType.RECOLECCION
        : mapFedexStatusToLocalStatus(scanEvent.eventDescription);

      newShipmentStatus.timestamp = eventDate;
      newShipmentStatus.notes = scanEvent.exceptionCode ? `${scanEvent.exceptionCode} - ${scanEvent.exceptionDescription}` : `${scanEvent.eventType} - ${scanEvent.eventDescription}`//this.generateNote(scanEvent, isInicialState);
      newShipmentStatus.shipment = savedShipment;

      if (
        newShipmentStatus.status === ShipmentStatusType.NO_ENTREGADO &&
        scanEvent.exceptionCode &&
        targetExceptionCodes.includes(scanEvent.exceptionCode)
      ) {
        this.logger.warn(`⛔ Se encontro no entregado tracking: ${newShipmentStatus.shipment.trackingNumber} evento: ${JSON.stringify(scanEvent)}`)
        newShipmentStatus.exceptionCode = scanEvent.exceptionCode;
        shipmentStatus.push(newShipmentStatus); // ✅ se guarda el evento actual
        break; // ⛔ se detiene aquí, no se guardan más
      }

      shipmentStatus.push(newShipmentStatus); // solo se guarda si no hubo break
    }

    return shipmentStatus;
  }

  /** Este esta de mas refactorizar */
  async createShipmentHistory(savedShipment: Shipment, fedexShipmentData: FedExTrackingResponseDto): Promise<ShipmentStatus[]> {
    try {
      const scanEvents = scanEventsFilter(fedexShipmentData.output.completeTrackResults[0].trackResults[0].scanEvents, "A trusted third-party vendor is on the way with your package");
      const histories = await this.processScanEvents(scanEvents, fedexShipmentData, savedShipment);    

      return histories;
    } catch (error) {
      console.error(error);
      return []; // o lanza una excepción si prefieres
    }
  }
 
  async findAll() {
    return await this.shipmentRepository.find({
      relations: ['statusHistory', 'payment', 'subsidiary'],
      order: {
        commitDateTime: "ASC",
      },
      select: {
        id: true,
        trackingNumber: true,
        recipientName: true,
        commitDateTime: true,
        status: true,
        statusHistory: {
          id: true,
          status: true,
          exceptionCode: true,
          timestamp: true,
          createdAt: true,
        },
        payment: {
          id: true,
          amount: true,
          type: true,
          status: true,
        },
        subsidiary: {
          id: true,
          name: true,
        },
      },
    });
  }

  async findOne(id: string) {
    return await this.shipmentRepository.findOneBy({ id });
  }

  async update(id: string, updateUserDto: any) {
    return await this.shipmentRepository.update(id, updateUserDto);
  }

  remove(id: string) {
    return this.shipmentRepository.delete(id);
  }

  async parseCityOfFile(filename: string): Promise<Subsidiary | null> {
    this.logger.log(`📂 Validating recipientCity on filename: ${filename}`);

    const subsidiaries = await this.subsidiaryRepository.find({
      where: { active: true },
      select: ['id', 'name'],
    });

    const cleanFilename = filename
      .toLowerCase()
      .replace(/\.[^/.]+$/, '') // eliminar extensión
      .replace(/[^a-zA-Z0-9\s]/g, '') // quitar símbolos
      .replace(/\s+/g, ' ') // espacios múltiples
      .trim();

    const filenameWords = cleanFilename.split(' '); // ej: ["semana", "0207", "junio", "cargas", "cabos"]

    for (const subsidiary of subsidiaries) {
      const cityWords = subsidiary.name.toLowerCase().split(/\s+/); // ej: ["cabo", "san", "lucas"]

      for (const word of filenameWords) {
        const cleanWord = word.toLowerCase().replace(/[^a-z]/g, '');

        const match = stringSimilarity.findBestMatch(cleanWord, cityWords);

        if (match.bestMatch.rating >= 0.6) {
          this.logger.log(
            `✅ Match detectado: "${cleanWord}" ≈ "${match.bestMatch.target}" de "${subsidiary.name}" (score: ${match.bestMatch.rating})`
          );
          return subsidiary;
        }
      }
    }

    this.logger.warn('⚠️ No se detectó ciudad en el nombre del archivo');
    return null;
  }

  /***** Just for testing ONE tracking ---- Este si se utiliza creo*/ 
    async validateDataforTracking(file: Express.Multer.File) {
       const startTime = Date.now();
      this.logger.log(`📂 Iniciando procesamiento de archivo: ${file?.originalname}`);

      if (!file) {
        const reason = 'No se subió ningún archivo';
        this.logger.error(`❌ ${reason}`);
        this.logBuffer.push(reason);
        throw new BadRequestException(reason);
      }

      if (!file.originalname.toLowerCase().match(/\.(csv|xlsx?)$/)) {
        const reason = 'Tipo de archivo no soportado';
        this.logger.error(`❌ ${reason}`);
        this.logBuffer.push(reason);
        throw new BadRequestException(reason);
      }


      this.logger.log(`📄 Leyendo archivo Excel: ${file.originalname}`);
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const shipmentsToSave = workbook.SheetNames.flatMap((sheetName) =>
        parseDynamicSheet(workbook, { fileName: file.originalname, sheetName })
      );

      //console.log("🚀 ~ ShipmentsService ~ validateDataforTracking ~ shipmentsToSave:", shipmentsToSave)
      
      return shipmentsToSave;
    }

  async normalizeCities() {
    const shipments = await this.shipmentRepository.find();

    for (const shipment of shipments) {
      const subsidiary = await this.cityClasification(shipment.recipientCity);
    
      if (subsidiary) {
        shipment.subsidiary = subsidiary;
        await this.shipmentRepository.save(shipment); // Asegúrate de guardar los cambios
      }
    }
  }

  /** refactorizar para que todo lo haga upperCase y sin espacios o que haga includes */
  async cityClasification(cityToClasificate: string) {
    
    let subsidiary: Subsidiary;

    console.log("🚀 ~ ShipmentsService ~ cityClasification ~ cityToClasificate:", cityToClasificate)

    switch (cityToClasificate) {
      case "CIUDAD OBREGON":
      case "OBREGON":
      case "OBREG?N":
      case "CD. OBREGON":
      case "CD OBREGON":
      case "CAJEME":
      case "CIUDAD OBREG&OACUTE;N":
      case "CIUDAD OBREG?N":
      case "SAN IGNACIO RIO MUERTO":
      case "BENITO JUAREZ":
      case "BENITO JU?REZ":
      case "BENITOXA0JUAREZ":
      case "ZONA URBANA , BENITO JUAREZ":
      case "QUETCHEHUECA":
      case "VILLA JUAREZ":
      case "VILLA JU?REZ":
      case "VILLA JUAREZ CENTRO":
        subsidiary = await this.subsidiaryService.getByName("Cd Obregon");
        break;

      case "NAVOJOA":
        subsidiary = await this.subsidiaryService.getByName("Navojoa");
        break;
      
      case "HUATABAMPO":
      case "ETCHOJOA":
      case "CRISTOBAL CAMPOS":
        subsidiary = await this.subsidiaryService.getByName("Huatabampo");
        break;
      case "PUERTO PE&ASCO":
      case "PENASCO":
      case "PUERTO PE?ASCO":
      case "PUERTO PENASCO":
      case "PUERTO PENAZCO":
        subsidiary = await this.subsidiaryService.getByName("Puerto Peñasco");
        break;
      
      case "CABO SAN LUCAS":
      case "LOS CABOS":
      case "SAN JOSE DEL CABO":
      case "SAN JOSE LOS CABOS":
      case "SAN JOS? DEL CABO":
      case "CABO MARINA":
      case "CABO SAN LUCAS BAJA":
      case "BAJA CALIFORNIA SUR":
      case "PABLO L MARTINEZ":
      case "FUENTES DE BELLAVISTA":
      case "LE?NARDO GAST?LUM":
      case "MAURICIO CASTRO":
      case "SAN JOSE DEL CABO, LOS CABOS":
      case "INFONAVIT BRISAS":
      case "COLORADO SAN JOSE DEL CABO":
      case "1RA ETAPA CABO SAN LUCAS":
      case "COUNTRY DEL MAR":
      case "SAN JOSE DEL CABO BCS":
      case "SAN JOSE DEL":
      case "FRESNILLO":
      case "LOS CABOS. SAN JOSE DEL CABO":
      case "MORELOS":
      case "MUNICIPIO DE LOS CABOS":
      case "SAN JOSE DEL CABO, B.C. S.":
      case "CAMPO DE GOLF , SAN JOSE DEL CABO":
      case "LA PLAYA":
      case "COLONIA DEL SOL":
      case "LA PAZ":
      case "INSURGENTES":
      case "MONTE REAL RESIDENCIAL":
      case "SAN JOSE DEL CABO LOS CABOS":
      case "SAN JOSE DEL CABO BAJ":
      case "PLAZA LOS PORTALES LOCAL 205":
      case "DEPARTAMENTO G3 CAMPO DE GOLF":
      case "Cabo San Lucas":
      case "SAN JOSE DEL CABO,BAJA CALIFORNIA S":
      case "CERRO DEL VIGIA":
      case "LOS CABOS SAN LUCAS":
      case "GUAYMITAS":
      case "LOMAS DEL SOL":
      case "SANJOSEDELCABO":
      case "SAN JOS? DEL CABO BAJ":
      case "COL. MONTERREAL":
      case "Cabo San Lucas":
      case "Los Cabos":
      case "LOS CABOS, B.C.S.":
      case "San Jose del Cabo":
      case "SAN JOSE  DEL  CABO":
      case "san jose del cabo":
      case "San jose del cabo":
      case "San JosA del Cabo":
      case "San Jos? del Cabo":
      case "los cabos":
      case "Los cabos":
      case "LOS CABOS,COLONIA DEL SOL":
      case "Los cabos Cabo san lucas":
      case "Palmillas":
      case "SAN JOSE DELCABO":
      case "San Jose del cabo":
        subsidiary = await this.subsidiaryService.getByName("Cabo San Lucas");
        break;
      default:
        this.citiesNotClasified.push(cityToClasificate);
    }
    
    console.log("🚀 ~ ShipmentsService ~ cityClasification ~ citiesNotClasified:", this.citiesNotClasified)
    return subsidiary ?? null;
  }




  /************************  Obtener KPI's de envios ******************************************************************/
    async getShipmentKPIs(dateStr: string, subsidiaryId: string) {
      const start = dateStr ? new Date(dateStr + 'T00:00:00') : startOfToday();
      const end = dateStr ? new Date(dateStr + 'T23:59:59') : endOfToday();

      const baseWhere: any = {
        createdAt: Between(start.toISOString(), end.toISOString()),
      };

      if (subsidiaryId) {
        baseWhere.subsidiaryId = subsidiaryId;
      }

      const totalDelDia = await this.shipmentRepository.count({ where: baseWhere });

      const entregados = await this.shipmentRepository.count({
        where: { ...baseWhere, status: ShipmentStatusType.ENTREGADO },
      });

      const enRuta = await this.shipmentRepository.count({
        where: { ...baseWhere, status: ShipmentStatusType.EN_RUTA },
      });

      /*** Aqui es donde se hará la magia del nuevo estatus INVENTARIO */
      const inventario = await this.shipmentRepository.count({
        where: { ...baseWhere, status: ShipmentStatusType.PENDIENTE },
      });

      const totalEntregadosYEnRuta = entregados + enRuta;
      const noEntregados = totalDelDia - totalEntregadosYEnRuta;
      const porcentajeNoEntregados = totalDelDia > 0
        ? `${((noEntregados / totalDelDia) * 100).toFixed(1)}`
        : '0';

      const promedioEntregaRaw = await this.shipmentRepository
        .createQueryBuilder("shipment")
        .select("AVG(DATEDIFF(shipment.commitDateTime, shipment.createdAt))", "prom")
        .where("shipment.status = :status", { status: ShipmentStatusType.ENTREGADO })
        .andWhere("shipment.createdAt BETWEEN :start AND :end", { start, end })
        .andWhere(subsidiaryId ? "shipment.subsidiaryId = :subsidiaryId" : "1=1", { subsidiaryId })
        .getRawOne();

      const promedioEntrega = promedioEntregaRaw?.prom
        ? `${parseFloat(promedioEntregaRaw.prom).toFixed(1)} días`
        : "N/A";

      return {
        total: totalDelDia,
        entregados: entregados,
        enRuta: enRuta,
        inventario: inventario,
        noEntregadosPercent: porcentajeNoEntregados,
        promedioEntrega: promedioEntrega
      }
    }

    async getShipmentsKPIsForDashboard({ from, to, subsidiaryId }: GetShipmentKpisDto) {
      const qb = this.shipmentRepository
        .createQueryBuilder('shipment')
        .leftJoinAndSelect('shipment.payment', 'payment')
        .leftJoinAndSelect('shipment.statusHistory', 'statusHistory')
        .leftJoinAndSelect('shipment.subsidiary', 'subsidiary') // << necesario para los costos
        .where('shipment.createdAt BETWEEN :from AND :to', {
          from: new Date(from),
          to: new Date(to + 'T23:59:59'),
        })

      if (subsidiaryId) {
        qb.andWhere('shipment.subsidiaryId = :subsidiaryId', { subsidiaryId })
      }

      const shipments = await qb.getMany()

      const totalEnvios = shipments.length

      const totalIngreso = shipments.reduce((acc, s) => {
        const cost = s.shipmentType === ShipmentType.FEDEX
          ? (s.subsidiary?.fedexCostPackage || 0)
          : (s.subsidiary?.dhlCostPackage || 0)
        return acc + cost
      }, 0)

      const totalEntregados = shipments.filter(s =>
        s.statusHistory?.some(h => h.status === ShipmentStatusType.ENTREGADO)
      ).length

      const totalNoEntregados = shipments.filter(s =>
        s.statusHistory?.some(h => h.status === ShipmentStatusType.NO_ENTREGADO)
      ).length

      const totalFedex = shipments.filter(s => s.shipmentType === ShipmentType.FEDEX).length
      const totalDhl = shipments.filter(s => s.shipmentType === ShipmentType.DHL).length

      return {
        totalEnvios,
        totalIngreso,
        entregados: totalEntregados,
        noEntregados: totalNoEntregados,
        totalFedex,
        totalDhl,
      }
    }

  /*********************************************************************************************************************/
  




  /*********** Nuevos métodos para realizar el guardado de envios ****************************************************/
  
  async findAllShipmentsAndCharges(subsidiaryId: string): Promise<ShipmentAndChargeDto[]> {
    const shipments = await this.shipmentRepository.find({
      select: {
        id: true,
        trackingNumber: true,
        recipientName: true,
        recipientAddress: true,
        recipientCity: true,
        recipientZip: true,
        commitDateTime: true,
        shipmentType: true,
        priority: true,
        status: true,
        statusHistory: {
          id: true,
          status: true,
          exceptionCode: true,
          timestamp: true,
          createdAt: true,
        },
        payment: {
          id: true,
          amount: true,
          type: true,
          status: true,
        },
        subsidiary: {
          id: true,
          name: true,
        },
      },
      relations: ['statusHistory', 'payment', 'subsidiary'],
      where: {
        subsidiary: {
          id: subsidiaryId
        }
      },
      order: { commitDateTime: 'DESC' },
    });

    const charges = await this.chargeShipmentRepository.find({
      select: {
        id: true,
        trackingNumber: true,
        recipientName: true,
        recipientAddress: true,
        recipientCity: true,
        recipientZip: true,
        commitDateTime: true,
        shipmentType: true,
        priority: true,
        status: true,
        statusHistory: {
          id: true,
          status: true,
          exceptionCode: true,
          timestamp: true,
          createdAt: true,
        },
        payment: {
          id: true,
          amount: true,
          type: true,
          status: true,
        },
        subsidiary: {
          id: true,
          name: true,
        },
      },
      relations: ['statusHistory', 'payment', 'charge', 'subsidiary'],
      where: {
        subsidiary: {
          id: subsidiaryId
        }
      },
      order: { commitDateTime: 'DESC' },
    });

    const chargeDtos: ShipmentAndChargeDto[] = charges.map(charge => ({
      ...charge,
      subsidiaryId: charge.subsidiary.id,
      isChargePackage: true,
    }));

    const allShipments: ShipmentAndChargeDto[] = [...shipments, ...chargeDtos];

    // ✅ Ordenar todo el resultado combinado por commitDate
    allShipments.sort((a, b) => {
      const dateA = new Date(a.commitDateTime).getTime();
      const dateB = new Date(b.commitDateTime).getTime();
      return dateB - dateA;
    });

    return allShipments;
  }

  /*** Método para obtener las cargas con sus envios */
  async getAllChargesWithStatusResp(subsidiaryId: string): Promise<ChargeWithStatusDto[]> {
    const charges = await this.chargeRepository.find({
      where: { subsidiary: { id: subsidiaryId } },
      relations: ['subsidiary'],
      order: {
        createdAt: 'DESC'
      }
    });
    console.log("🚀 ~ ShipmentsService ~ getAllChargesWithStatus ~ charges:", charges)

    const chargeShipments = await this.chargeShipmentRepository.find({
      relations: ['charge', 'subsidiary', 'statusHistory'],
    });

    const chargeMap = new Map<string, ChargeShipment[]>();

    // Agrupa los chargeShipments por chargeId
    for (const shipment of chargeShipments) {
      if (!shipment.charge) continue;
      if (!chargeMap.has(shipment.charge.id)) {
        chargeMap.set(shipment.charge.id, []);
      }
      chargeMap.get(shipment.charge.id)!.push(shipment);
    }

    // Procesa y determina si está completo
    return charges.map((charge) => {
      const relatedShipments = chargeMap.get(charge.id) ?? [];
      const isComplete = relatedShipments.length > 0 &&
        relatedShipments.every(s => s.status === 'entregado');

      return {
        ...charge,
        isChargeComplete: isComplete,
        shipments: relatedShipments,
      };
    });
  }

  async getAllChargesWithStatus(subsidiaryId: string): Promise<ChargeWithStatusDto[]> {
    // 1. Obtener solo los cargos de la sucursal
    const charges = await this.chargeRepository.find({
      where: { subsidiary: { id: subsidiaryId } },
      relations: ['subsidiary'],
      order: { createdAt: 'DESC' }
    });

    if (charges.length === 0) return [];

    // 2. Extraer los IDs de los cargos para filtrar la segunda consulta
    const chargeIds = charges.map(c => c.id);

    // 3. Traer SOLO los envíos que pertenecen a esos cargos específicos
    // Esto evita traer miles de registros innecesarios
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { charge: { id: In(chargeIds) } }, // Importar 'In' de typeorm
      relations: ['charge', 'statusHistory'],
    });

    // 4. Agrupar de forma eficiente
    const chargeMap = new Map<string, any[]>();
    for (const shipment of chargeShipments) {
      const cId = shipment.charge.id;
      if (!chargeMap.has(cId)) chargeMap.set(cId, []);
      chargeMap.get(cId)!.push(shipment);
    }

    // 5. Mapear resultados
    return charges.map((charge) => {
      const relatedShipments = chargeMap.get(charge.id) ?? [];
      
      const isComplete = relatedShipments.length > 0 &&
        relatedShipments.every(s => s.status === 'entregado');

      return {
        ...charge,
        isChargeComplete: isComplete,
        shipments: relatedShipments,
      };
    });
  }

  async existShipmentByTrackSpecial(
    trackingNumber: string, 
    recipientName: string, 
    recipientAddress: string, 
    recipientZip: string
  ): Promise<{exist: boolean, shipment: Shipment | null}> {
    const [_, count] = await this.shipmentRepository.findAndCountBy({
      trackingNumber,
      recipientName,
      recipientAddress,
      recipientZip
    });

    return { exist: count > 0, shipment: _[0] };
  }

  async processFileF2(file: Express.Multer.File, subsidiaryId: string, consNumber: string, consDate?: Date) {
    this.logger.log("🚀 Iniciando migración masiva y carga directa (F2)");

    if (!file) throw new BadRequestException('No se subió ningún archivo');

    const { buffer } = file;
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const migrated: any[] = [];
    const createdFromScratch: any[] = [];
    const errors: any[] = [];

    try {
      // 1. Lectura de Excel
      const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellText: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const shipmentsToProcess = parseDynamicFileF2(sheet);

      if (shipmentsToProcess.length === 0) return { message: 'Archivo vacío.' };

      // 2. Obtener Subsidiaria y Crear Cabecera (Charge)
      const chargeSubsidiary = await queryRunner.manager.findOne(Subsidiary, { where: { id: subsidiaryId } });
      if (!chargeSubsidiary) throw new BadRequestException('Subsidiaria no encontrada');

      const newCharge = this.chargeRepository.create({
        subsidiary: chargeSubsidiary,
        chargeDate: consDate || new Date(),
        numberOfPackages: shipmentsToProcess.length,
        consNumber
      });
      const savedCharge = await queryRunner.manager.save(newCharge);

      // 3. Procesamiento Atómico Paquete por Paquete
      for (const data of shipmentsToProcess) {
        try {
          // Buscamos si existe en la tabla original de Shipments
          const original = await queryRunner.manager.findOne(Shipment, {
            where: { trackingNumber: data.trackingNumber },
            relations: ['statusHistory', 'payment']
          });

          let savedCS: ChargeShipment;

          if (original) {
            // --- ESCENARIO A: EXISTE -> MIGRAR ---
            await queryRunner.manager.delete(Income, { trackingNumber: original.trackingNumber });

            const chargeShipment = this.chargeShipmentRepository.create({
              ...original,
              id: undefined, // Nuevo UUID para la tabla charge_shipment
              charge: savedCharge,
              subsidiary: chargeSubsidiary,
              status: original.status || ShipmentStatusType.PENDIENTE,
            });

            savedCS = await queryRunner.manager.save(chargeShipment);

            // Mover Historial si existe
            if (original.statusHistory?.length > 0) {
              const newHistory = original.statusHistory.map(old => 
                this.shipmentStatusRepository.create({
                  ...old,
                  id: undefined,
                  chargeShipment: { id: savedCS.id },
                  shipment: null
                })
              );
              await queryRunner.manager.save(newHistory);
            }

            // Eliminar el original solo después de salvar el nuevo y su historia
            await queryRunner.manager.delete(Shipment, original.id);
            migrated.push(savedCS.trackingNumber);

          } else {
            // --- ESCENARIO B: NO EXISTE -> INSERTAR DIRECTO ---
            const newCS = this.chargeShipmentRepository.create({
              trackingNumber: data.trackingNumber,
              recipientName: data.recipientName || 'N/A',
              recipientAddress: data.recipientAddress || 'N/A',
              recipientZip: data.recipientZip || 'N/A',
              recipientCity: data.recipientCity || 'N/A',
              recipientPhone: data.recipientPhone || 'N/A',
              shipmentType: ShipmentType.FEDEX,
              status: ShipmentStatusType.PENDIENTE,
              charge: savedCharge,
              subsidiary: chargeSubsidiary,
            });

            savedCS = await queryRunner.manager.save(newCS);

            // Crear un historial inicial para este paquete nuevo
            const initialStatus = this.shipmentStatusRepository.create({
              status: ShipmentStatusType.PENDIENTE,
              notes: 'Cargado directamente desde archivo F2 (No existía en sistema)',
              timestamp: new Date(),
              chargeShipment: { id: savedCS.id }
            });
            await queryRunner.manager.save(initialStatus);
            
            createdFromScratch.push(savedCS.trackingNumber);
          }

        } catch (err) {
          this.logger.error(`❌ Error procesando tracking ${data.trackingNumber}: ${err.message}`);
          errors.push({ tracking: data.trackingNumber, error: err.message });
        }
      }

      // 4. Generar Ingreso Global (Income)
      if (migrated.length > 0 || createdFromScratch.length > 0) {
        const newIncome = this.incomeRepository.create({
          subsidiary: chargeSubsidiary,
          shipmentType: ShipmentType.FEDEX,
          incomeType: IncomeStatus.ENTREGADO,
          cost: chargeSubsidiary.chargeCost || 0,
          isGrouped: true,
          sourceType: IncomeSourceType.CHARGE,
          charge: savedCharge,
          date: consDate || new Date(),
        });
        await queryRunner.manager.save(newIncome);
      }

      // Si todo salió bien, confirmamos cambios
      await queryRunner.commitTransaction();

      return {
        success: true,
        summary: {
          totalProcessed: shipmentsToProcess.length,
          migrated: migrated.length,
          insertedNew: createdFromScratch.length,
          failed: errors.length
        },
        details: { errors }
      };

    } catch (error) {
      // Si algo falló en la estructura (ej. BD caída), deshacemos TODO
      await queryRunner.rollbackTransaction();
      this.logger.error(`💥 Error crítico en proceso F2: ${error.message}`);
      throw new InternalServerErrorException('Fallo la migración masiva. No se realizaron cambios.');
    } finally {
      await queryRunner.release();
    }
  }

  async processFileF2Resp23012026(file: Express.Multer.File, subsidiaryId: string, consNumber: string, consDate?: Date) {
    this.logger.log("🚀 Iniciando migración masiva (F2)");

    if (!file) throw new BadRequestException('No se subió ningún archivo');

    const { buffer, originalname } = file;
    const notFoundTrackings: any[] = [];
    const errors: any[] = [];
    const migrated: ChargeShipment[] = [];

    try {
      // 1. Validación de archivo y lectura de Excel
      if (!originalname.match(/\.(csv|xlsx?)$/i)) throw new BadRequestException('Tipo de archivo no soportado');

      const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellText: false });
      if (!workbook.SheetNames?.length) throw new BadRequestException('El archivo Excel está vacío');

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const shipmentsToUpdate = parseDynamicFileF2(sheet);
      this.logger.log(`📦 Envíos encontrados en archivo: ${shipmentsToUpdate.length}`);

      if (shipmentsToUpdate.length === 0) return { message: 'No hay envíos para procesar.' };

      // 2. Obtener Subsidiaria y Crear Charge (Cabecera)
      const chargeSubsidiary = await this.subsidiaryRepository.findOne({ where: { id: subsidiaryId } });
      if (!chargeSubsidiary) throw new BadRequestException('Subsidiaria no encontrada');

      const newCharge = this.chargeRepository.create({
        subsidiary: chargeSubsidiary,
        chargeDate: consDate || new Date(),
        numberOfPackages: shipmentsToUpdate.length,
        consNumber
      });
      const savedCharge = await this.chargeRepository.save(newCharge);

      // 3. Procesamiento por Lotes
      const BATCH_SIZE = 50;
      for (let i = 0; i < shipmentsToUpdate.length; i += BATCH_SIZE) {
        const batch = shipmentsToUpdate.slice(i, i + BATCH_SIZE);
        
        const batchPromises = batch.map(async (shipmentData) => {
          try {
            const validation = await this.existShipmentByTrackSpecial(
              shipmentData.trackingNumber,
              shipmentData.recipientName,
              shipmentData.recipientAddress,
              shipmentData.recipientZip
            );

            if (!validation.exist) {
              notFoundTrackings.push(shipmentData);
              return;
            }

            // CARGA CRUCIAL: Traemos todas las relaciones del original
            const original = await this.shipmentRepository.findOne({
              where: { id: validation.shipment.id },
              relations: ['statusHistory', 'payment', 'subsidiary'],
            });

            if (!original) {
              notFoundTrackings.push(shipmentData);
              return;
            }

            // --- MIGRACIÓN DE DATOS ---

            // A. Eliminar income previo para evitar duplicidad de costos
            await this.incomeRepository.delete({ trackingNumber: original.trackingNumber });

            // B. Crear ChargeShipment incluyendo las NUEVAS COLUMNAS
            const chargeShipment = this.chargeShipmentRepository.create({
              ...original, // Esto copia trackingNumber, recipientName, etc.
              id: undefined, 
              charge: savedCharge,
              subsidiary: chargeSubsidiary,
              // Mapeo explícito de las columnas de FedEx capturadas en addConsMaster
              fedexUniqueId: original.fedexUniqueId,
              carrierCode: original.carrierCode,
              status: original.status || ShipmentStatusType.PENDIENTE,
            });

            // Mantener el payment si existía
            if (original.payment) {
              chargeShipment.payment = original.payment;
            }

            const savedChargeShipment = await this.chargeShipmentRepository.save(chargeShipment);

            // C. MIGRACIÓN DEL HISTORIAL (ShipmentStatus)
            if (original.statusHistory?.length > 0) {
              const newHistory = original.statusHistory.map(oldStatus => {
                return this.shipmentStatusRepository.create({
                  status: oldStatus.status,
                  exceptionCode: oldStatus.exceptionCode,
                  timestamp: oldStatus.timestamp,
                  notes: oldStatus.notes,
                  createdAt: oldStatus.createdAt,
                  // Vinculamos al nuevo ChargeShipment y limpiamos la del Shipment viejo
                  chargeShipment: { id: savedChargeShipment.id },
                  shipment: null 
                });
              });

              // Guardado físico en tabla shipment_status
              await this.shipmentStatusRepository.save(newHistory);
              savedChargeShipment.statusHistory = newHistory; 
            }

            // D. ELIMINACIÓN DEL ORIGINAL (Solo después de que todo lo anterior tuvo éxito)
            await this.shipmentRepository.delete(original.id);

            migrated.push(savedChargeShipment);
            this.logger.log(`✅ Migrado con historial: ${original.trackingNumber}`);

          } catch (err) {
            this.logger.error(`❌ Error en tracking ${shipmentData.trackingNumber}: ${err.message}`);
            errors.push({ tracking: shipmentData.trackingNumber, reason: err.message });
          }
        });

        await Promise.allSettled(batchPromises);
      }

      // 4. Crear el Income global (Agrupado por el Charge)
      if (migrated.length > 0) {
        const newIncome = this.incomeRepository.create({
          subsidiary: chargeSubsidiary,
          shipmentType: ShipmentType.FEDEX,
          incomeType: IncomeStatus.ENTREGADO,
          cost: chargeSubsidiary.chargeCost || 0,
          isGrouped: true,
          sourceType: IncomeSourceType.CHARGE,
          charge: savedCharge,
          date: consDate || new Date(),
        });
        await this.incomeRepository.save(newIncome);
      }

      return {
        migrated: migrated.length,
        notFound: notFoundTrackings.length,
        errors: errors.length,
        details: {
          migratedTrackings: migrated.map(m => ({
            trackingNumber: m.trackingNumber,
            historyCount: m.statusHistory?.length || 0
          })),
          errorDetails: errors
        }
      };

    } catch (error) {
      this.logger.error(`💥 Error crítico en F2: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  /*** NUEVO SI SE USA */
  async addChargeShipments(file: Express.Multer.File, subsidiaryId: string, consNumber: string, consDate?: Date) {
    console.log("🟢 START addChargeShipments method");
    
    if (!file) throw new BadRequestException('No file uploaded');
    console.log("📂 File received:", file.originalname, "Size:", file.size);

    let savedIncome: Income;
    const { buffer, originalname } = file;
    const errors: any[] = [];

    if (!originalname.match(/\.(csv|xlsx?)$/i)) {
      console.log("🔴 Invalid file type:", originalname);
      throw new BadRequestException('Unsupported file type');
    }

    try {
      console.log("🟢 Step 1: Reading Excel file");
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      
      console.log("🟢 Step 2: Parsing file data");
      const chargeShipmentsToSave = parseDynamicFileF2(sheet);
      console.log("📦 Found", chargeShipmentsToSave.length, "shipments to save");

      if (chargeShipmentsToSave.length === 0) {
        console.log("⚠️ No shipments found in file");
        return { message: 'No shipments found in the file.' };
      }

      // Debug: mostrar primeros 3 shipments
      console.log("Sample shipments:", chargeShipmentsToSave.slice(0, 3));

      console.log("🟢 Step 3: Creating charge");
      const newCharge = this.chargeRepository.create({
        subsidiary: { id: subsidiaryId },
        chargeDate: consDate ? format(consDate, 'yyyy-MM-dd HH:mm:ss') : format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        numberOfPackages: chargeShipmentsToSave.length,
        consNumber
      });

      console.log("💾 Saving charge...");
      const savedCharge = await this.chargeRepository.save(newCharge);
      console.log("✅ Charge saved with ID:", savedCharge.id);

      console.log("🟢 Step 4: Finding subsidiary");
      const chargeSubsidiary = await this.subsidiaryRepository.findOne({ 
        where: { id: subsidiaryId } 
      });

      if (!chargeSubsidiary) {
        console.log("🔴 Subsidiary not found for ID:", subsidiaryId);
        throw new BadRequestException('Subsidiary not found');
      }

      console.log("✅ Subsidiary found:", chargeSubsidiary.name);
      console.log("💳 Subsidiary charge cost:", chargeSubsidiary.chargeCost);

      console.log("🟢 Step 5: Processing", chargeShipmentsToSave.length, "shipments");
      
      let commitDate: string | undefined;
      let commitTime: string | undefined;
      let commitDateTime: Date | undefined;
      let dateSource: string;

      const processPromises = chargeShipmentsToSave.map(async (shipment) => { 
        try {
          console.log("🔄 Creating charge shipment for:", shipment.trackingNumber);
          
          if (shipment.commitDate && shipment.commitTime) {
            try {
              const parsedDate = parse(shipment.commitDate, 'yyyy-MM-dd', new Date());
              const parsedTime = parse(shipment.commitTime, 'HH:mm:ss', new Date());
              if (!isNaN(parsedDate.getTime()) && !isNaN(parsedTime.getTime())) {
                commitDate = format(parsedDate, 'yyyy-MM-dd');
                commitTime = format(parsedTime, 'HH:mm:ss');
                commitDateTime = new Date(`${commitDate}T${commitTime}`);
                dateSource = 'Excel';
                this.logger.log(`📅 commitDateTime asignado desde Excel para ${shipment.trackingNumber}: ${commitDateTime.toISOString()} (commitDate=${commitDate}, commitTime=${commitTime})`);
              } else {
                this.logger.log(`⚠️ Formato inválido en Excel para ${shipment.trackingNumber}: commitDate=${shipment.commitDate}, commitTime=${shipment.commitTime}`);
              }
            } catch (err) {
              this.logger.log(`⚠️ Error al parsear datos de Excel para ${shipment.trackingNumber}: ${err.message}`);
            }
          }

          if (!commitDateTime) {
            const today = new Date();
            today.setHours(18, 0, 0, 0); // ← 18:00:00
            commitDateTime = today;
            console.log("⚠️ commitDateTime missing, set to 18:00:00 today");
          }

          // ✅ VERIFICAR que shipment tenga todos los campos requeridos
          console.log("Shipment data:", {
            trackingNumber: shipment.trackingNumber,
            recipientName: shipment.recipientName,
            recipientAddress: shipment.recipientAddress,
            recipientCity: shipment.recipientCity,
            recipientZip: shipment.recipientZip,
            commitDateTime: commitDateTime, // ← Este es crítico
            recipientPhone: shipment.recipientPhone,
          });

          const chargeShipment = this.chargeShipmentRepository.create({
            ...shipment,
            id: undefined,
            charge: savedCharge, // ✅ Asegurar que savedCharge tenga id
          });

          console.log("💾 Attempting to save...");
          const savedChargeShipment = await this.chargeShipmentRepository.save(chargeShipment);
          console.log("✅ Saved with ID:", savedChargeShipment.id);
          
          return savedChargeShipment;
        } catch (error) {
          console.log("🔴 DETAILED ERROR:", error);
          console.log("🔴 Error stack:", error.stack);
          errors.push({ 
            shipment: shipment.trackingNumber, 
            error: error.message,
            detailed: error 
          });
          return null;
        }
      });

      console.log("⏳ Waiting for all shipments to save...");
      const results = await Promise.allSettled(processPromises);
      console.log("✅ All shipments processed");
      
      const savedChargeShipments = results
        .filter(result => result.status === 'fulfilled' && result.value !== null)
        .map(result => (result as PromiseFulfilledResult<any>).value);

      console.log("📊 Successful shipments:", savedChargeShipments.length);
      console.log("❌ Errors:", errors.length);

      console.log("🟢 Step 6: Creating income");

      if (savedChargeShipments.length > 0 && chargeSubsidiary) {
        try {
          console.log("💵 Creating income with cost:", chargeSubsidiary.chargeCost);
          
          const newIncome = this.incomeRepository.create({
            subsidiary: chargeSubsidiary,
            shipmentType: ShipmentType.FEDEX,
            incomeType: IncomeStatus.ENTREGADO,
            cost: chargeSubsidiary.chargeCost || 0,
            isGrouped: true,
            sourceType: IncomeSourceType.CHARGE,
            charge: { id: savedCharge.id },
            date: consDate ? consDate : new Date(),
          });

          console.log("💾 Saving income...");
          savedIncome = await this.incomeRepository.save(newIncome);
          console.log("✅ Income saved with ID:", savedIncome.id);
        } catch (incomeError) {
          console.log("🔴 Error saving income:", incomeError.message);
          errors.push({ incomeError: incomeError.message });
        }
      } else {
        console.log("⚠️ Skipping income creation - no shipments saved or subsidiary not found");
      }

      console.log("🎉 addChargeShipments completed successfully");
      
      return {
        savedCharge,
        savedChargeShipments: savedChargeShipments,
        savedIncome: savedIncome || null,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      console.log("💥 CRITICAL ERROR in addChargeShipments:", error.message);
      console.log(error.stack);
      throw new BadRequestException(`Error processing file: ${error.message}`);
    }
  }

  /*** Procesar archivos que incluyen los cobros o pagos */
  async processFileCharges(file: Express.Multer.File){
    if (!file) throw new BadRequestException('No file uploaded');

    const { buffer, originalname } = file;

    if (!originalname.match(/\.(csv|xlsx?)$/i)) {
      throw new BadRequestException('Unsupported file type');
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const shipmentsWithCharge = parseDynamicSheetCharge(sheet);

    if(shipmentsWithCharge.length === 0) return 'No se encontraron envios con cobro.'

    for(const { trackingNumber, recipientAddress, payment }of shipmentsWithCharge) {
      let shipmentToUpdate = await this.shipmentRepository.findOne({
        where: {
          trackingNumber,
          recipientAddress
        },
        order: {
          createdAt: 'DESC'
        }
      })

      /*let shipmentToUpdate = await this.shipmentRepository.findOneBy({
        trackingNumber,
        recipientAddress
      })*/

      if(shipmentToUpdate) {
        shipmentToUpdate.payment = payment;
        await this.shipmentRepository.save(shipmentToUpdate);
      }

    }

    return shipmentsWithCharge;
  }

  async processHihValueShipments(file: Express.Multer.File){
    if (!file) throw new BadRequestException('No file uploaded');

    const { buffer, originalname } = file;

    if (!originalname.match(/\.(csv|xlsx?)$/i)) {
      throw new BadRequestException('Unsupported file type');
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const highValueShipments = parseDynamicHighValue(sheet);

    if(highValueShipments.length === 0) return 'No se encontraron envios con cobro.'

     for(const { trackingNumber, recipientAddress }of highValueShipments) {
      let shipmentToUpdate = await this.shipmentRepository.findOneBy({
        trackingNumber,
        recipientAddress
      })

      if(shipmentToUpdate) {
        shipmentToUpdate.isHighValue = true;
        await this.shipmentRepository.save(shipmentToUpdate);
      }

    }

    return highValueShipments;

  }

  private async applyIncomeValidationRules(
    shipment: Shipment,
    mappedStatus: ShipmentStatusType,
    exceptionCodes: string[],
    histories: ShipmentStatus[],
    trackingNumber: string,
    eventDate: Date
  ): Promise<{ isValid: boolean; timestamp: Date; reason?: string; isOD?: boolean }> {
    this.logger.debug(`📋 Aplicando reglas de validación de income para ${trackingNumber}`);

    // 1. Prioritize ENTREGADO
    if (mappedStatus === ShipmentStatusType.ENTREGADO) {
      const entregadoEvents = histories.filter((h) => h.status === ShipmentStatusType.ENTREGADO);
      const firstEntregado = entregadoEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
      
      if (exceptionCodes.includes('16')) {
        if (firstEntregado) {
          return { isValid: true, timestamp: firstEntregado.timestamp };
        } else {
          const reason = `❌ Excluido de income: ENTREGADO con excepción 16 sin eventos válidos (${trackingNumber})`;
          return { isValid: false, timestamp: eventDate, reason };
        }
      }

      const timestamp = firstEntregado ? firstEntregado.timestamp : eventDate;
      return { isValid: true, timestamp };
    }

    // 2 y 3. NO_ENTREGADO con excepciones específicas
    if (mappedStatus === ShipmentStatusType.NO_ENTREGADO) {
      if (exceptionCodes.includes('07')) return { isValid: true, timestamp: eventDate };
      if (exceptionCodes.includes('03') || exceptionCodes.includes('17')) {
        const reason = `❌ Excluido de income: NO_ENTREGADO con excepción restrictiva (${trackingNumber})`;
        return { isValid: false, timestamp: eventDate, reason };
      }
    }

    // 4. Exception OD
    if (exceptionCodes.includes('OD')) {
      return { isValid: false, timestamp: eventDate, reason: 'OD detectado', isOD: true };
    }

    // 5. Reglas de Sucursal para excepción 08 (CORREGIDO)
    if (exceptionCodes.includes('08')) {
      // Intentamos obtener el ID de varias fuentes para evitar el 'undefined'
      const subsidiaryId = shipment.subsidiary?.id || (shipment as any).subsidiaryId || 'DEFAULT';
      
      const subsidiaryRules: Record<string, { minEvents08: number }> = {
        'mexico-city': { minEvents08: 3 },
        'guadalajara': { minEvents08: 2 },
        'DEFAULT': { minEvents08: 3 },
      };

      const rule = subsidiaryRules[subsidiaryId] || subsidiaryRules['DEFAULT'];
      const eventos08 = histories.filter((h) => h.exceptionCode === '08');

      if (eventos08.length < rule.minEvents08) {
        const reason = `❌ Excluido de income: excepción 08 con menos de ${rule.minEvents08} eventos (${trackingNumber})`;
        return { isValid: false, timestamp: eventDate, reason };
      }
    }

    return { isValid: true, timestamp: eventDate };
  }

  async checkStatusOnFedexBySubsidiaryRules(): Promise<void> {
    const shipmentsWithError: { trackingNumber: string; reason: string }[] = [];
    const unusualCodes: { trackingNumber: string; derivedCode: string; exceptionCode?: string; eventDate: string; statusByLocale?: string }[] = [];
    const shipmentsWithOD: { trackingNumber: string; eventDate: string }[] = [];
    try {
      this.logger.log(`🚀 Iniciando checkStatusOnFedex`);
      const pendingShipments = await this.getShipmentsToValidate();
      if (!pendingShipments || !Array.isArray(pendingShipments)) {
        const reason = `pendingShipments no es un arreglo válido: ${JSON.stringify(pendingShipments)}`;
        this.logger.error(`❌ ${reason}`);
        this.logBuffer.push(reason);
        throw new BadRequestException(reason);
      }
      this.logger.log(`📦🕐 Procesando ${pendingShipments.length} envíos para validar en FedEx`);

      // Fetch subsidiary rules
      const subsidiaryRules = await this.getSubsidiaryRules();
      this.logger.log(`📜 Reglas por sucursal cargadas: ${JSON.stringify(Object.keys(subsidiaryRules))}`);

      const batches = Array.from(
        { length: Math.ceil(pendingShipments.length / this.BATCH_SIZE) },
        (_, i) => pendingShipments.slice(i * this.BATCH_SIZE, (i + 1) * this.BATCH_SIZE)
      );

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        this.logger.log(`📦 Procesando lote ${i + 1}/${batches.length} con ${batch.length} envíos`);

        await Promise.all(
          batch.map(async (shipment, index) => {
            const trackingNumber = shipment.trackingNumber;
            const subsidiaryId = shipment.subsidiary.id || 'default';
            const rules = subsidiaryRules[subsidiaryId] || {
              allowedExceptionCodes: ['07', '08', '17', '67', '14', '16', 'OD'],
              allowedStatuses: Object.values(ShipmentStatusType),
              maxEventAgeDays: 30,
              allowDuplicateStatuses: false,
              allowedEventTypes: ['DL', 'DE', 'DU', 'RF', 'TA', 'TD', 'HL', 'OC', 'IT', 'AR', 'AF', 'CP', 'CC', 'PU'],
              noIncomeExceptionCodes: [],
              notFoundExceptionCodes: [],
              minEvents08: 3,
              allowException03: false,
              allowException16: false,
              allowExceptionOD: false,
            };
            this.logger.log(`🚚 Procesando envío ${index + 1}/${batch.length} del lote ${i + 1}: ${trackingNumber} (sucursal: ${subsidiaryId})`);

            try {
              const shipmentInfo: FedExTrackingResponseDto = await this.trackPackageWithRetry(trackingNumber);
              if (!shipmentInfo?.output?.completeTrackResults?.length || !shipmentInfo.output.completeTrackResults[0]?.trackResults?.length) {
                const reason = `No se encontró información válida del envío ${trackingNumber}: completeTrackResults vacíos o inválidos`;
                this.logger.error(`❌ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.push({ trackingNumber, reason });
                return;
              }

              const trackResults = shipmentInfo.output.completeTrackResults[0].trackResults;
              const latestTrackResult = trackResults.find((r) => r.latestStatusDetail?.derivedCode === 'DL') || trackResults.sort((a, b) => {
                const dateA = a.scanEvents[0]?.date ? new Date(a.scanEvents[0].date).getTime() : 0;
                const dateB = b.scanEvents[0]?.date ? new Date(b.scanEvents[0].date).getTime() : 0;
                return dateB - dateA;
              })[0];
              const latestStatusDetail = latestTrackResult.latestStatusDetail;
              this.logger.log(`📣 Último estatus de FedEx para ${trackingNumber}: ${latestStatusDetail?.derivedCode} - ${latestStatusDetail?.statusByLocale}`);

              const mappedStatus = mapFedexStatusToLocalStatus(latestStatusDetail?.derivedCode, latestStatusDetail?.ancillaryDetails?.[0]?.reason);
              const exceptionCode = latestStatusDetail?.ancillaryDetails?.[0]?.reason || latestTrackResult.scanEvents[0]?.exceptionCode;

              // Validar exceptionCode
              if (exceptionCode && !rules.allowedExceptionCodes.includes(exceptionCode)) {
                unusualCodes.push({
                  trackingNumber,
                  derivedCode: latestStatusDetail?.derivedCode || 'N/A',
                  exceptionCode,
                  eventDate: latestTrackResult.scanEvents[0]?.date || 'N/A',
                  statusByLocale: latestStatusDetail?.statusByLocale || 'N/A',
                });
                this.logger.warn(`⚠️ exceptionCode=${exceptionCode} no permitido para sucursal ${subsidiaryId} en ${trackingNumber}`);
                return;
              }

              // Validar estatus permitido
              if (!rules.allowedStatuses.includes(mappedStatus)) {
                unusualCodes.push({
                  trackingNumber,
                  derivedCode: latestStatusDetail?.derivedCode || 'N/A',
                  exceptionCode,
                  eventDate: latestTrackResult.scanEvents[0]?.date || 'N/A',
                  statusByLocale: latestStatusDetail?.statusByLocale || 'N/A',
                });
                this.logger.warn(`⚠️ Estatus ${mappedStatus} no permitido para sucursal ${subsidiaryId} en ${trackingNumber}`);
                return;
              }

              // Aggregate scanEvents
              const allScanEvents = trackResults.flatMap((result) => result.scanEvents || []).filter(
                (e) => !rules.allowedEventTypes || rules.allowedEventTypes.includes(e.eventType)
              );
              const event = allScanEvents.find(
                (e) =>
                  e.eventType === 'DL' ||
                  e.derivedStatusCode === 'DL' ||
                  e.derivedStatusCode === latestStatusDetail?.derivedCode ||
                  e.eventType === latestStatusDetail?.derivedCode ||
                  (mappedStatus === ShipmentStatusType.NO_ENTREGADO && ['DE', 'DU', 'RF', 'TD'].includes(e.eventType) && rules.allowedEventTypes.includes(e.eventType)) ||
                  (mappedStatus === ShipmentStatusType.PENDIENTE && ['TA', 'HL'].includes(e.eventType) && rules.allowedEventTypes.includes(e.eventType)) ||
                  (mappedStatus === ShipmentStatusType.EN_RUTA && ['OC', 'IT', 'AR', 'AF', 'CP', 'CC'].includes(e.eventType) && rules.allowedEventTypes.includes(e.eventType)) ||
                  (mappedStatus === ShipmentStatusType.RECOLECCION && ['PU'].includes(e.eventType) && rules.allowedEventTypes.includes(e.eventType))
              ) || allScanEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
              if (!event) {
                const reason = `No se encontró evento válido para el estatus ${latestStatusDetail?.derivedCode} en ${trackingNumber} (sucursal: ${subsidiaryId})`;
                this.logger.warn(`⚠️ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.push({ trackingNumber, reason });
                return;
              }

              // Validar y parsear event.date
              let eventDate: Date;
              try {
                eventDate = parseISO(event.date);
                if (isNaN(eventDate.getTime())) {
                  throw new Error(`Fecha inválida: ${event.date}`);
                }
                const maxAgeDays = rules.maxEventAgeDays || 30;
                const maxAgeDate = new Date();
                maxAgeDate.setDate(maxAgeDate.getDate() - maxAgeDays);
                if (eventDate < maxAgeDate) {
                  const reason = `Evento para ${trackingNumber} demasiado antiguo: ${eventDate.toISOString()} (límite: ${maxAgeDate.toISOString()})`;
                  this.logger.warn(`⚠️ ${reason}`);
                  this.logBuffer.push(reason);
                  shipmentsWithError.push({ trackingNumber, reason });
                  return;
                }
                this.logger.log(`📅 Fecha del evento para ${trackingNumber}: ${event.date} -> ${eventDate.toISOString()}`);
              } catch (err) {
                const reason = `Error al parsear event.date para ${trackingNumber}: ${err.message}`;
                this.logger.error(`❌ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.push({ trackingNumber, reason });
                return;
              }

              // Validar si el evento es reciente
              if (shipment.commitDateTime && eventDate < shipment.commitDateTime && mappedStatus !== ShipmentStatusType.ENTREGADO) {
                this.logger.warn(`⚠️ Evento (${mappedStatus}, ${eventDate.toISOString()}) es anterior a commitDateTime (${shipment.commitDateTime.toISOString()}) para ${trackingNumber}`);
              }

              // Initialize statusHistory
              shipment.statusHistory = shipment.statusHistory || [];

              // Apply income validation rules
              const exceptionCodes = shipment.statusHistory.map((h) => h.exceptionCode).filter(Boolean).concat(exceptionCode ? [exceptionCode] : []);
              if ([ShipmentStatusType.ENTREGADO, ShipmentStatusType.NO_ENTREGADO].includes(mappedStatus)) {
                const validationResult = await this.applyIncomeValidationRulesBySubsidiary(
                  shipment,
                  mappedStatus,
                  exceptionCodes,
                  shipment.statusHistory,
                  trackingNumber,
                  eventDate,
                  rules
                );
                if (!validationResult.isValid) {
                  if (validationResult.isOD) {
                    shipmentsWithOD.push({ trackingNumber, eventDate: eventDate.toISOString() });
                  } else {
                    shipmentsWithError.push({ trackingNumber, reason: validationResult.reason || 'Validación de income fallida' });
                  }
                  return;
                }
                eventDate = validationResult.timestamp;
              }

              // Verificar duplicados
              const isException08 = mappedStatus === ShipmentStatusType.NO_ENTREGADO && exceptionCode === '08';
              const isDuplicateStatus = !rules.allowDuplicateStatuses && shipment.statusHistory.some((s) =>
                isException08
                  ? s.status === mappedStatus && s.exceptionCode === exceptionCode && isSameDay(s.timestamp, eventDate)
                  : s.status === mappedStatus && isSameDay(s.timestamp, eventDate)
              );

              // Permitir actualización si el evento es más reciente
              const latestStatusHistory = shipment.statusHistory.length
                ? shipment.statusHistory.reduce((latest, current) =>
                    new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest
                  )
                : null;
              const isNewerEvent = !latestStatusHistory || new Date(eventDate) > new Date(latestStatusHistory.timestamp);

              if (isDuplicateStatus && !isNewerEvent) {
                this.logger.log(`📌 Estado ${mappedStatus}${isException08 ? ` (exceptionCode=${exceptionCode})` : ''} ya existe para ${trackingNumber}`);
                return;
              }

              // Crear nuevo ShipmentStatus
              const newShipmentStatus = new ShipmentStatus();
              newShipmentStatus.status = mappedStatus;
              newShipmentStatus.timestamp = eventDate;
              newShipmentStatus.notes = latestStatusDetail?.ancillaryDetails?.[0]
                ? `${latestStatusDetail.ancillaryDetails[0].reason} - ${latestStatusDetail.ancillaryDetails[0].actionDescription}`
                : `${event.eventType} - ${event.eventDescription}`;
              newShipmentStatus.exceptionCode = exceptionCode;
              newShipmentStatus.shipment = shipment;

              // Actualizar Shipment
              shipment.status = mappedStatus;
              shipment.statusHistory.push(newShipmentStatus);
              shipment.receivedByName = latestTrackResult.deliveryDetails?.receivedByName || shipment.receivedByName;

              // Actualizar payment
              if (shipment.payment) {
                shipment.payment.status = mappedStatus === ShipmentStatusType.ENTREGADO ? PaymentStatus.PAID : PaymentStatus.PENDING;
                this.logger.log(`💰 Actualizado payment.status=${shipment.payment.status} para ${trackingNumber}`);
              }

              // Guardar con transacción
              try {
                await this.shipmentRepository.manager.transaction(async (transactionalEntityManager) => {
                  await transactionalEntityManager.save(ShipmentStatus, newShipmentStatus);
                  this.logger.log(`💾 ShipmentStatus guardado para ${trackingNumber} con status=${mappedStatus}`);

                  await transactionalEntityManager
                    .createQueryBuilder()
                    .update(Shipment)
                    .set({
                      status: shipment.status,
                      receivedByName: shipment.receivedByName,
                      payment: shipment.payment,
                    })
                    .where('id = :id', { id: shipment.id })
                    .execute();
                  this.logger.log(`💾 Shipment actualizado para ${trackingNumber} con status=${mappedStatus}`);

                  // Generar Income
                  if ([ShipmentStatusType.ENTREGADO, ShipmentStatusType.NO_ENTREGADO].includes(mappedStatus) && isNewerEvent) {
                    const validationResult = await this.applyIncomeValidationRulesBySubsidiary(
                      shipment,
                      mappedStatus,
                      exceptionCodes,
                      shipment.statusHistory,
                      trackingNumber,
                      eventDate,
                      rules
                    );
                    if (validationResult.isValid) {
                      try {
                        await this.generateIncomes(shipment, validationResult.timestamp, newShipmentStatus.exceptionCode, transactionalEntityManager);
                        this.logger.log(`✅ Income generado para ${trackingNumber} con status=${mappedStatus}`);
                      } catch (err) {
                        const reason = `Error al generar income para ${trackingNumber}: ${err.message}`;
                        this.logger.error(`❌ ${reason}`);
                        this.logBuffer.push(reason);
                        shipmentsWithError.push({ trackingNumber, reason });
                      }
                    }
                  }
                });
              } catch (err) {
                const reason = `Error al guardar shipment ${trackingNumber}: ${err.message}`;
                this.logger.error(`❌ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.push({ trackingNumber, reason });
                return;
              }
            } catch (err) {
              const reason = `Error procesando envío ${trackingNumber}: ${err.message}`;
              this.logger.error(`❌ ${reason}`);
              this.logBuffer.push(reason);
              shipmentsWithError.push({ trackingNumber, reason });
            }
          })
        );
      }

      await this.flushLogBuffer();
      if (shipmentsWithError.length) {
        await this.logErrors({ fedexError: shipmentsWithError });
        this.logger.warn(`⚠️ ${shipmentsWithError.length} envíos con errores durante la validación`);
      }
      if (unusualCodes.length) {
        await this.logUnusualCodes(unusualCodes);
        this.logger.warn(`⚠️ ${unusualCodes.length} códigos inusuales registrados`);
      }
      if (shipmentsWithOD.length) {
        await this.logUnusualCodes(shipmentsWithOD.map(({ trackingNumber, eventDate }) => ({
          trackingNumber,
          derivedCode: 'N/A',
          exceptionCode: 'OD',
          eventDate,
          statusByLocale: 'N/A',
        })));
        this.logger.warn(`⚠️ ${shipmentsWithOD.length} envíos con excepción OD registrados`);
      }
    } catch (err) {
      const reason = `Error general en checkStatusOnFedex: ${err.message}`;
      this.logger.error(`❌ ${reason}`);
      this.logBuffer.push(reason);
      await this.flushLogBuffer();
      throw new BadRequestException(reason);
    }
  }

  // Placeholder for fetching subsidiary rules
  async getSubsidiaryRules(): Promise<Record<string, SubsidiaryRules>> {
    // TODO: Fetch from database or configuration
    return {
      'default': {
        allowedExceptionCodes: ['07', '03', '08', '17', '67', '14', '16', 'OD'],
        allowedStatuses: [
          ShipmentStatusType.ENTREGADO, 
          ShipmentStatusType.NO_ENTREGADO, 
          ShipmentStatusType.PENDIENTE, 
          ShipmentStatusType.EN_RUTA, 
          ShipmentStatusType.RECOLECCION
        ],
        maxEventAgeDays: 30,
        allowDuplicateStatuses: false,
        allowedEventTypes: ['DL', 'DE', 'DU', 'RF', 'TA', 'TD', 'HL', 'OC', 'IT', 'AR', 'AF', 'CP', 'CC', 'PU'],
        noIncomeExceptionCodes: ['03'],
        notFoundExceptionCodes: [],
        minEvents08: 3,
        allowException03: false,
        allowException16: false,
        allowExceptionOD: false,
        allowIncomeFor07: true,
        alwaysProcess67: true,
      },
      '356ec2b4-980e-45e2-abb5-7a62e7858fbb': {
        allowedExceptionCodes: ['07', '03', '08', '17', '67', '14', '16', 'OD'],
        allowedStatuses: [
          ShipmentStatusType.ENTREGADO,
          ShipmentStatusType.NO_ENTREGADO,
          ShipmentStatusType.PENDIENTE,
          ShipmentStatusType.EN_RUTA,
          ShipmentStatusType.RECOLECCION,
        ],
        maxEventAgeDays: 30,
        allowDuplicateStatuses: false,
        allowedEventTypes: ['DL', 'DE', 'DU', 'RF', 'TA', 'TD', 'HL', 'OC', 'IT', 'AR', 'AF', 'CP', 'CC', 'PU'],
        noIncomeExceptionCodes: ['08', '03'],
        notFoundExceptionCodes: ['08'],
        minEvents08: 0,
        allowException03: true,
        allowException16: false,
        allowExceptionOD: false,
        allowIncomeFor07: true,
        alwaysProcess67: true,
      }
    };
  }

  private async applyIncomeValidationRulesBySubsidiary(
    shipment: Shipment,
    mappedStatus: ShipmentStatusType,
    exceptionCodes: string[],
    histories: ShipmentStatus[],
    trackingNumber: string,
    eventDate: Date,
    rules: SubsidiaryRules
  ): Promise<{ isValid: boolean; timestamp: Date; reason?: string; isOD?: boolean }> {
    this.logger.debug(`📋 Aplicando reglas de validación de income para ${trackingNumber} (sucursal: ${shipment.subsidiary?.id || 'default'})`);

    // Check notFoundExceptionCodes
    if (exceptionCodes.some((code) => rules.notFoundExceptionCodes?.includes(code))) {
      const code = exceptionCodes.find((c) => rules.notFoundExceptionCodes?.includes(c));
      const reason = `❌ Excluido de income: código ${code} marcado como no encontrado para sucursal ${shipment.subsidiary?.id || 'default'} (${trackingNumber})`;
      this.logger.warn(reason);
      this.logBuffer.push(reason);
      return { isValid: false, timestamp: eventDate, reason };
    }

    // Check noIncomeExceptionCodes
    if (exceptionCodes.some((code) => rules.noIncomeExceptionCodes?.includes(code))) {
      const code = exceptionCodes.find((c) => rules.noIncomeExceptionCodes?.includes(c));
      const reason = `❌ Excluido de income: código ${code} no permite income para sucursal ${shipment.subsidiary?.id || 'default'} (${trackingNumber})`;
      this.logger.warn(reason);
      this.logBuffer.push(reason);
      return { isValid: false, timestamp: eventDate, reason };
    }

    // Rule for exceptionCode 03
    if (mappedStatus === ShipmentStatusType.NO_ENTREGADO && exceptionCodes.includes('03') && !rules.allowException03) {
      const reason = `❌ Excluido de income: NO_ENTREGADO con excepción 03 no permitido para sucursal ${shipment.subsidiary?.id || 'default'} (${trackingNumber})`;
      this.logger.warn(reason);
      this.logBuffer.push(reason);
      return { isValid: false, timestamp: eventDate, reason };
    }

    // Rule for exceptionCode 16
    if (mappedStatus === ShipmentStatusType.ENTREGADO && exceptionCodes.includes('16') && !rules.allowException16) {
      const entregadoEvents = histories.filter((h) => h.status === ShipmentStatusType.ENTREGADO);
      const firstEntregado = entregadoEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
      if (firstEntregado) {
        this.logger.log(`✅ Incluido income para ENTREGADO con excepción 16 usando el primer evento: ${trackingNumber}`);
        return { isValid: true, timestamp: firstEntregado.timestamp };
      } else {
        const reason = `❌ Excluido de income: ENTREGADO con excepción 16 sin eventos ENTREGADO válidos para sucursal ${shipment.subsidiary?.id || 'default'} (${trackingNumber})`;
        this.logger.warn(reason);
        this.logBuffer.push(reason);
        return { isValid: false, timestamp: eventDate, reason };
      }
    }

    // Rule for exceptionCode OD
    if (exceptionCodes.includes('OD') && !rules.allowExceptionOD) {
      const reason = `📦 Shipment con excepción "OD" excluido del income y marcado para procesamiento especial: ${trackingNumber}`;
      this.logger.warn(reason);
      this.logBuffer.push(reason);
      return { isValid: false, timestamp: eventDate, reason, isOD: true };
    }

    // Rule for exceptionCode 08
    if (exceptionCodes.includes('08') && rules.minEvents08) {
      const eventos08 = histories.filter((h) => h.exceptionCode === '08');
      if (eventos08.length < rules.minEvents08) {
        const reason = `❌ Excluido de income: excepción 08 con menos de ${rules.minEvents08} eventos para sucursal ${shipment.subsidiary?.id || 'default'} (${trackingNumber})`;
        this.logger.warn(reason);
        this.logBuffer.push(reason);
        return { isValid: false, timestamp: eventDate, reason };
      }
    }

    // If no exclusion rules apply, allow income generation
    this.logger.log(`✅ Income permitido para ${trackingNumber} con status=${mappedStatus}`);
    return { isValid: true, timestamp: eventDate };
  }


  async checkStatusOnFedex(): Promise<void> {
    const shipmentsWithError: { trackingNumber: string; reason: string }[] = [];
    const unusualCodes: { trackingNumber: string; derivedCode: string; exceptionCode?: string; eventDate: string; statusByLocale?: string }[] = [];
    const shipmentsWithOD: { trackingNumber: string; eventDate: string }[] = [];
    try {
      this.logger.log(`🚀 Iniciando checkStatusOnFedex`);
      const pendingShipments = await this.getShipmentsToValidate();
      if (!pendingShipments || !Array.isArray(pendingShipments)) {
        const reason = `pendingShipments no es un arreglo válido: ${JSON.stringify(pendingShipments)}`;
        this.logger.error(`❌ ${reason}`);
        this.logBuffer.push(reason);
        throw new BadRequestException(reason);
      }
      this.logger.log(`📦🕐 Procesando ${pendingShipments.length} envíos para validar en FedEx`);

      const batches = Array.from(
        { length: Math.ceil(pendingShipments.length / this.BATCH_SIZE) },
        (_, i) => pendingShipments.slice(i * this.BATCH_SIZE, (i + 1) * this.BATCH_SIZE)
      );

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        this.logger.log(`📦 Procesando lote ${i + 1}/${batches.length} con ${batch.length} envíos`);

        await Promise.all(
          batch.map(async (shipment, index) => {
            const trackingNumber = shipment.trackingNumber;
            this.logger.log(`🚚 Procesando envío ${index + 1}/${batch.length} del lote ${i + 1}: ${trackingNumber}`);

            try {
              const shipmentInfo: FedExTrackingResponseDto = await this.trackPackageWithRetry(trackingNumber);
              if (!shipmentInfo?.output?.completeTrackResults?.length || !shipmentInfo.output.completeTrackResults[0]?.trackResults?.length) {
                const reason = `No se encontró información válida del envío ${trackingNumber}: completeTrackResults vacíos o inválidos`;
                this.logger.error(`❌ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.push({ trackingNumber, reason });
                return;
              }

              const trackResults = shipmentInfo.output.completeTrackResults[0].trackResults;
              const latestTrackResult = trackResults.find((r) => r.latestStatusDetail?.derivedCode === 'DL') || trackResults.sort((a, b) => {
                const dateA = a.scanEvents[0]?.date ? new Date(a.scanEvents[0].date).getTime() : 0;
                const dateB = b.scanEvents[0]?.date ? new Date(b.scanEvents[0].date).getTime() : 0;
                return dateB - dateA;
              })[0];
              const latestStatusDetail = latestTrackResult.latestStatusDetail;
              this.logger.log(`📣 Último estatus de FedEx para ${trackingNumber}: ${latestStatusDetail?.derivedCode} - ${latestStatusDetail?.statusByLocale}`);

              const mappedStatus = mapFedexStatusToLocalStatus(latestStatusDetail?.derivedCode, latestStatusDetail?.ancillaryDetails?.[0]?.reason);
              const exceptionCode = latestStatusDetail?.ancillaryDetails?.[0]?.reason || latestTrackResult.scanEvents[0]?.exceptionCode;

              // Registrar códigos inusuales
              const knownExceptionCodes = ['07', '03', '08', '17', '67', '14', '16', 'OD'];
              if (exceptionCode && (['005'].includes(exceptionCode) || !knownExceptionCodes.includes(exceptionCode))) {
                unusualCodes.push({
                  trackingNumber,
                  derivedCode: latestStatusDetail?.derivedCode || 'N/A',
                  exceptionCode,
                  eventDate: latestTrackResult.scanEvents[0]?.date || 'N/A',
                  statusByLocale: latestStatusDetail?.statusByLocale || 'N/A',
                });
                this.logger.warn(`⚠️ Código inusual detectado para ${trackingNumber}: exceptionCode=${exceptionCode}, derivedCode=${latestStatusDetail?.derivedCode}`);
                return;
              }

              // Registrar derivedCode desconocidos
              if (mappedStatus === ShipmentStatusType.DESCONOCIDO) {
                unusualCodes.push({
                  trackingNumber,
                  derivedCode: latestStatusDetail?.derivedCode || 'N/A',
                  exceptionCode,
                  eventDate: latestTrackResult.scanEvents[0]?.date || 'N/A',
                  statusByLocale: latestStatusDetail?.statusByLocale || 'N/A',
                });
                this.logger.warn(`⚠️ derivedCode desconocido para ${trackingNumber}: derivedCode=${latestStatusDetail?.derivedCode}, statusByLocale=${latestStatusDetail?.statusByLocale}`);
                return;
              }

              // Aggregate scanEvents from all trackResults
              const allScanEvents = trackResults.flatMap((result) => result.scanEvents || []);
              const event = allScanEvents.find(
                (e) =>
                  e.eventType === 'DL' ||
                  e.derivedStatusCode === 'DL' ||
                  e.derivedStatusCode === latestStatusDetail?.derivedCode ||
                  e.eventType === latestStatusDetail?.derivedCode ||
                  (mappedStatus === ShipmentStatusType.NO_ENTREGADO && ['DE', 'DU', 'RF'].includes(e.eventType)) ||
                  (mappedStatus === ShipmentStatusType.PENDIENTE && ['TA', 'TD', 'HL'].includes(e.eventType)) ||
                  (mappedStatus === ShipmentStatusType.EN_RUTA && ['OC', 'IT', 'AR', 'AF', 'CP', 'CC'].includes(e.eventType)) ||
                  (mappedStatus === ShipmentStatusType.RECOLECCION && ['PU'].includes(e.eventType))
              ) || allScanEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
              if (!event) {
                const reason = `No se encontró evento para el estatus ${latestStatusDetail?.derivedCode} en ${trackingNumber}`;
                this.logger.warn(`⚠️ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.push({ trackingNumber, reason });
                return;
              }

              // Validar y parsear event.date
              let eventDate: Date;
              try {
                eventDate = parseISO(event.date);
                if (isNaN(eventDate.getTime())) {
                  throw new Error(`Fecha inválida: ${event.date}`);
                }
                this.logger.log(`📅 Fecha del evento para ${trackingNumber}: ${event.date} -> ${eventDate.toISOString()}`);
              } catch (err) {
                const reason = `Error al parsear event.date para ${trackingNumber}: ${err.message}`;
                this.logger.error(`❌ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.push({ trackingNumber, reason });
                return;
              }

              // Validar si el evento es reciente comparado con commitDateTime
              if (shipment.commitDateTime && eventDate < shipment.commitDateTime && mappedStatus !== ShipmentStatusType.ENTREGADO) {
                this.logger.warn(`⚠️ Evento (${mappedStatus}, ${eventDate.toISOString()}) es anterior a commitDateTime (${shipment.commitDateTime.toISOString()}) para ${trackingNumber}. Posible evento ENTREGADO faltante.`);
              }

              // Initialize statusHistory if undefined
              shipment.statusHistory = shipment.statusHistory || [];

              // Apply validation rules for income generation
              const exceptionCodes = shipment.statusHistory.map((h) => h.exceptionCode).filter(Boolean).concat(exceptionCode ? [exceptionCode] : []);
              if ([ShipmentStatusType.ENTREGADO, ShipmentStatusType.NO_ENTREGADO].includes(mappedStatus)) {
                const validationResult = await this.applyIncomeValidationRules(
                  shipment,
                  mappedStatus,
                  exceptionCodes,
                  shipment.statusHistory,
                  trackingNumber,
                  eventDate
                );
                if (!validationResult.isValid) {
                  shipmentsWithOD.push({ trackingNumber, eventDate: eventDate.toISOString() });
                  return;
                }
                eventDate = validationResult.timestamp;
              }

              // Verificar si el estado ya existe en ShipmentStatus
              const isException08 = mappedStatus === ShipmentStatusType.NO_ENTREGADO && exceptionCode === '08';
              const isDuplicateStatus = shipment.statusHistory.some((s) =>
                isException08
                  ? s.status === mappedStatus && s.exceptionCode === exceptionCode && isSameDay(s.timestamp, eventDate)
                  : s.status === mappedStatus && isSameDay(s.timestamp, eventDate)
              );

              // Permitir actualización si el evento es más reciente
              const latestStatusHistory = shipment.statusHistory.length
                ? shipment.statusHistory.reduce((latest, current) =>
                    new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest
                  )
                : null;
              const isNewerEvent = !latestStatusHistory || new Date(eventDate) > new Date(latestStatusHistory.timestamp);

              if (isDuplicateStatus && !isNewerEvent) {
                this.logger.log(`📌 Estado ${mappedStatus}${isException08 ? ` (exceptionCode=${exceptionCode})` : ''} ya existe para ${trackingNumber} en la misma fecha`);
                return;
              }

              // Crear nuevo ShipmentStatus
              const newShipmentStatus = new ShipmentStatus();
              newShipmentStatus.status = mappedStatus;
              newShipmentStatus.timestamp = eventDate;
              newShipmentStatus.notes = latestStatusDetail?.ancillaryDetails?.[0]
                ? `${latestStatusDetail.ancillaryDetails[0].reason} - ${latestStatusDetail.ancillaryDetails[0].actionDescription}`
                : `${event.eventType} - ${event.eventDescription}`;
              newShipmentStatus.exceptionCode = exceptionCode;
              newShipmentStatus.shipment = shipment;

              // Actualizar Shipment
              shipment.status = mappedStatus;
              shipment.statusHistory.push(newShipmentStatus);
              shipment.receivedByName = latestTrackResult.deliveryDetails?.receivedByName || shipment.receivedByName;

              // Asegurar commitDateTime
              if (!shipment.commitDateTime) {
                shipment.commitDateTime = new Date();
                this.logger.log(`📅 commitDateTime asignado por defecto para ${trackingNumber}: ${shipment.commitDateTime.toISOString()}`);
              }

              // Actualizar payment si existe
              if (shipment.payment) {
                shipment.payment.status = mappedStatus === ShipmentStatusType.ENTREGADO ? PaymentStatus.PAID : PaymentStatus.PENDING;
                this.logger.log(`💰 Actualizado payment.status=${shipment.payment.status} para ${trackingNumber}`);
              }

              // Guardar Shipment y ShipmentStatus con transacción
              try {
                await this.shipmentRepository.manager.transaction(async (transactionalEntityManager) => {
                  await transactionalEntityManager.save(ShipmentStatus, newShipmentStatus);
                  this.logger.log(`💾 ShipmentStatus guardado para ${trackingNumber} con status=${mappedStatus}`);

                  await transactionalEntityManager
                    .createQueryBuilder()
                    .update(Shipment)
                    .set({
                      status: shipment.status,
                      receivedByName: shipment.receivedByName,
                      payment: shipment.payment,
                      commitDateTime: shipment.commitDateTime,
                    })
                    .where('id = :id', { id: shipment.id })
                    .execute();
                  this.logger.log(`💾 Shipment actualizado para ${trackingNumber} con status=${mappedStatus}`);

                  // Generar Income solo para ENTREGADO o NO_ENTREGADO si pasa validación
                  if ([ShipmentStatusType.ENTREGADO, ShipmentStatusType.NO_ENTREGADO].includes(mappedStatus) && isNewerEvent) {
                    const validationResult = await this.applyIncomeValidationRules(
                      shipment,
                      mappedStatus,
                      exceptionCodes,
                      shipment.statusHistory,
                      trackingNumber,
                      eventDate
                    );
                    if (validationResult.isValid) {
                      try {
                        await this.generateIncomes(shipment, validationResult.timestamp, newShipmentStatus.exceptionCode, transactionalEntityManager);
                        this.logger.log(`✅ Income generado para ${trackingNumber} con status=${mappedStatus}`);
                      } catch (err) {
                        const reason = `Error al generar income para ${trackingNumber}: ${err.message}`;
                        this.logger.error(`❌ ${reason}`);
                        this.logBuffer.push(reason);
                        shipmentsWithError.push({ trackingNumber, reason });
                      }
                    }
                  }
                });
              } catch (err) {
                const reason = `Error al guardar shipment ${trackingNumber}: ${err.message}`;
                this.logger.error(`❌ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.push({ trackingNumber, reason });
                return;
              }
            } catch (err) {
              const reason = `Error procesando envío ${trackingNumber}: ${err.message}`;
              this.logger.error(`❌ ${reason}`);
              this.logBuffer.push(reason);
              shipmentsWithError.push({ trackingNumber, reason });
            }
          })
        );
      }

      await this.flushLogBuffer();
      if (shipmentsWithError.length) {
        await this.logErrors({ fedexError: shipmentsWithError });
        this.logger.warn(`⚠️ ${shipmentsWithError.length} envíos con errores durante la validación`);
      }
      if (unusualCodes.length) {
        await this.logUnusualCodes(unusualCodes);
        this.logger.warn(`⚠️ ${unusualCodes.length} códigos inusuales registrados`);
      }
      if (shipmentsWithOD.length) {
        await this.logUnusualCodes(shipmentsWithOD.map(({ trackingNumber, eventDate }) => ({
          trackingNumber,
          derivedCode: 'N/A',
          exceptionCode: 'OD',
          eventDate,
          statusByLocale: 'N/A',
        })));
        this.logger.warn(`⚠️ ${shipmentsWithOD.length} envíos con excepción OD registrados`);
      }
    } catch (err) {
      const reason = `Error general en checkStatusOnFedex: ${err.message}`;
      this.logger.error(`❌ ${reason}`);
      this.logBuffer.push(reason);
      await this.flushLogBuffer();
      throw new BadRequestException(reason);
    }
  }

  /** por si algo falta con la solución circular a shipment en Hillo / Hillo Ext */
  private async processFedexScanEventsToStatusesResp(
    scanEvents: FedExScanEventDto[],
    shipment: Shipment
  ): Promise<ShipmentStatus[]> {
    this.logger.log(`🔍 Procesando ${scanEvents.length} eventos para ${shipment.trackingNumber}`);
    
    // 1. Ordenar eventos cronológicamente
    const sortedEvents = [...scanEvents].sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateA - dateB;
    });

    const statuses: ShipmentStatus[] = [];
    let hasException = false;
    let hasDelivered = false;

    for (const event of sortedEvents) {
      const mappedStatus = mapFedexStatusToLocalStatus(event.derivedStatusCode, event.exceptionCode);
      if (mappedStatus === ShipmentStatusType.DESCONOCIDO) continue;

      const timestamp = new Date(event.date);
      if (isNaN(timestamp.getTime())) continue;

      // Creamos la entrada de historial vinculando solo el ID si es posible, 
      // o el objeto completo si estamos en creación.
      const statusEntry = new ShipmentStatus();
      statusEntry.shipment = shipment; 
      statusEntry.status = mappedStatus;
      statusEntry.exceptionCode = event.exceptionCode || undefined;
      statusEntry.timestamp = timestamp;
      statusEntry.notes = event.exceptionCode
        ? `${event.exceptionCode} - ${event.exceptionDescription}`
        : `${event.eventType} - ${event.eventDescription}`;

      statuses.push(statusEntry);
      
      if (mappedStatus === ShipmentStatusType.NO_ENTREGADO) hasException = true;
      if (mappedStatus === ShipmentStatusType.ENTREGADO) hasDelivered = true;
    }

    // Lógica de limpieza de eventos post-excepción (igual a la tuya pero simplificada)
    if (!hasDelivered && hasException) {
      const lastNoEntIndex = statuses.map(s => s.status).lastIndexOf(ShipmentStatusType.NO_ENTREGADO);

      if (lastNoEntIndex >= 0 && lastNoEntIndex < statuses.length - 1) {
        const afterEvents = statuses.slice(lastNoEntIndex + 1);
        const filteredAfter = afterEvents.filter(s => 
          s.status !== ShipmentStatusType.EN_RUTA || s.exceptionCode === '67'
        );
        
        statuses.length = lastNoEntIndex + 1; // Cortar el array
        statuses.push(...filteredAfter);      // Re-añadir filtrados
      }
    }

    return statuses;
  }

  private async processFedexScanEventsToStatuses(
    scanEvents: FedExScanEventDto[],
    shipment: Shipment
  ): Promise<ShipmentStatus[]> {
    
    // 1. Orden cronológico (Fundamental)
    const sortedEvents = [...scanEvents].sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateA - dateB;
    });

    const statuses: ShipmentStatus[] = [];

    for (const event of sortedEvents) {
      // --- A. EXTRACCIÓN DE DATOS CRUDOS ---
      const eCode = (event.exceptionCode || '').trim();
      const dCode = (event.derivedStatusCode || '').trim();
      const type  = (event.eventType || '').trim();
      
      // Definimos qué código guardaremos en la columna 'exceptionCode'
      // Prioridad: Exception > Derived > EventType
      let codeToSave = eCode; 
      if (!codeToSave) codeToSave = dCode;
      if (!codeToSave) codeToSave = type;

      // --- B. INTENTO DE MAPEO ---
      let mappedStatus = mapFedexStatusToLocalStatus(dCode, eCode);

      // 🛡️ REGLA: CÓDIGO 67 = PENDIENTE (BODEGA)
      // Forzamos manualmente para que no caiga en Desconocido si tu función map no lo tiene.
      if (eCode === '67' || codeToSave === '67') {
          mappedStatus = ShipmentStatusType.PENDIENTE; 
      }

      // --- C. VALIDACIÓN DE FECHA ---
      const timestamp = new Date(event.date);
      if (isNaN(timestamp.getTime())) {
          this.logger.warn(`⚠️ Fecha inválida en evento FedEx: ${event.date} para guía ${shipment.trackingNumber}`);
          continue; // Solo saltamos si la fecha es corrupta (imposible de guardar)
      }

      // --- D. CREACIÓN DEL REGISTRO (SIN FILTROS DE ESTATUS) ---
      const statusEntry = new ShipmentStatus();
      statusEntry.shipment = shipment; 
      statusEntry.status = mappedStatus; // Puede ser DESCONOCIDO
      statusEntry.exceptionCode = codeToSave; 
      statusEntry.timestamp = timestamp;
      
      // --- E. NOTAS DETALLADAS (PARA DEBUGGING) ---
      // Si es DESCONOCIDO, guardamos TODA la evidencia en las notas.
      if (mappedStatus === ShipmentStatusType.DESCONOCIDO) {
          statusEntry.notes = `⚠️ UNMAPPED: Code=[${codeToSave}] Derived=[${dCode}] Type=[${type}] Desc=[${event.eventDescription || 'N/A'}]`;
          
          // Opcional: Log en consola para alertarte en tiempo real
          this.logger.warn(`[${shipment.trackingNumber}] Estatus Desconocido guardado: ${statusEntry.notes}`);
      } else {
          // Si es conocido, guardamos formato estándar
          statusEntry.notes = event.exceptionDescription 
            ? `[${codeToSave}] ${event.exceptionDescription}`
            : `[${codeToSave}] ${event.eventDescription || 'Evento FedEx'}`;
      }

      statuses.push(statusEntry);
    }

    // Retornamos la historia íntegra.
    return statuses;
  }

  async addConsMasterBySubsidiary(
    file: Express.Multer.File,
    subsidiaryId: string,
    consNumber: string,
    consDate?: Date,
    isAereo?: boolean
  ): Promise<any> {
      const startTime = Date.now();
      this.logger.log(`📂 Procesando archivo: ${file?.originalname} | Tipo: ${isAereo ? 'AÉREO' : 'ORDINARIO'}`);

      if (!file) throw new BadRequestException('No se ha recibido el archivo de Excel.');
      
      const predefinedSubsidiary = await this.subsidiaryService.findById(subsidiaryId);
      if (!predefinedSubsidiary) throw new BadRequestException(`La subsidiaria seleccionada no es válida.`);

      const existingCons = await this.consolidatedService.findByConsNumber(consNumber);
      if (existingCons) throw new BadRequestException(`El número de consolidado '${consNumber}' ya existe.`);

      let shipmentsToSave: any[] = [];
      try {
          const workbook = XLSX.read(file.buffer, { type: 'buffer' });
          shipmentsToSave = parseDynamicSheet(workbook, { fileName: file.originalname });
          if (!shipmentsToSave || shipmentsToSave.length === 0) throw new Error('El archivo no contiene filas de datos.');
      } catch (excelError) {
          throw new BadRequestException(`Error en formato de Excel: ${excelError.message}`);
      }

      const result = { saved: 0, failed: 0, duplicated: 0, duplicatedTrackings: [], failedTrackings: [] };
      const processedTrackingNumbers = new Set<string>();
      const shipmentsToGenerateIncomes: any[] = [];
      
      const batches = Array.from({ length: Math.ceil(shipmentsToSave.length / this.BATCH_SIZE) }, (_, i) => 
          shipmentsToSave.slice(i * this.BATCH_SIZE, (i + 1) * this.BATCH_SIZE)
      );

      return await this.shipmentRepository.manager.transaction(async (transactionalEntityManager) => {
          const consolidated = transactionalEntityManager.create(Consolidated, {
              date: consDate || new Date(),
              type: isAereo ? ConsolidatedType.AEREO : ConsolidatedType.ORDINARIA,
              numberOfPackages: shipmentsToSave.length,
              subsidiary: predefinedSubsidiary,
              consNumber,
              isCompleted: false,
              efficiency: 0,
              commitDateTime: new Date(),
          });

          const savedCons = await transactionalEntityManager.save(Consolidated, consolidated);

          for (let i = 0; i < batches.length; i++) {
              this.shipmentBatch = []; 

              await Promise.all(
                  batches[i].map((shipment, index) =>
                      this.processShipment(
                          shipment,
                          predefinedSubsidiary,
                          savedCons,
                          result,
                          null,
                          i + 1,
                          index + 1,
                          processedTrackingNumbers,
                          shipmentsToGenerateIncomes,
                          savedCons.id
                      )
                  )
              );

              if (this.shipmentBatch.length > 0) {
                  try {
                      const statusHistoryMap = new Map();
                      const paymentMap = new Map();
                      const now = new Date();

                      this.shipmentBatch.forEach(s => {
                          if (s.statusHistory?.length) statusHistoryMap.set(s.trackingNumber, [...s.statusHistory]);
                          if (s.payment) paymentMap.set(s.trackingNumber, s.payment);
                          s.statusHistory = [];
                          s.payment = undefined;
                      });

                      // A. Insertar Guías (CHUNK de 50 para estabilidad)
                      const savedShipments = await transactionalEntityManager.save(Shipment, this.shipmentBatch, { chunk: 50 });

                      const paymentsToSave = [];
                      const historiesToSave = [];

                      savedShipments.forEach(s => {
                          const pay = paymentMap.get(s.trackingNumber);
                          if (pay) { pay.shipment = { id: s.id }; paymentsToSave.push(pay); }

                          const fedexHist = statusHistoryMap.get(s.trackingNumber);
                          if (fedexHist) {
                              fedexHist.forEach(h => { h.shipment = { id: s.id }; historiesToSave.push(h); });
                          }

                          // INYECTAR HISTORIA INICIAL (Garantiza que el inicio sea PENDIENTE en el log)
                          historiesToSave.push(transactionalEntityManager.create(ShipmentStatus, {
                              status: ShipmentStatusType.PENDIENTE,
                              notes: `Registro inicial. Cons: ${savedCons.consNumber}`,
                              timestamp: now,
                              shipment: { id: s.id },
                              exceptionCode: 'INIT'
                          }));
                      });

                      if (paymentsToSave.length) await transactionalEntityManager.save(Payment, paymentsToSave);
                      if (historiesToSave.length) await transactionalEntityManager.save(ShipmentStatus, historiesToSave, { chunk: 100 });

                      for (const item of shipmentsToGenerateIncomes) {
                          await this.generateIncomes(item.shipment, item.timestamp, item.exceptionCode, transactionalEntityManager);
                      }
                      shipmentsToGenerateIncomes.length = 0;

                  } catch (err) {
                      this.logger.error(`❌ Error en lote ${i + 1}: ${err.message}`);
                      throw new InternalServerErrorException(`Error al guardar datos: ${err.message}`);
                  }
              }
          }

          savedCons.isCompleted = true;
          savedCons.efficiency = (result.saved / shipmentsToSave.length) * 100;
          await transactionalEntityManager.save(Consolidated, savedCons);

          return { ...result, duration: `${((Date.now() - startTime) / 60000).toFixed(2)} min`, consNumber: savedCons.consNumber };
      });
  }

 /*** */ 


  private async processShipmentResp1902(
    shipment: ParsedShipmentDto,
    predefinedSubsidiary: Subsidiary,
    consolidated: Consolidated,
    result: any,
    shipmentsWithError: any,
    batchNumber: number,
    shipmentIndex: number,
    processedTrackingNumbers: Set<string>,
    shipmentsToGenerateIncomes: { shipment: Shipment; timestamp: Date; exceptionCode: string | undefined }[],
    consolidatedId: string
  ): Promise<void> {
    const trackingNumber = shipment.trackingNumber?.toString().trim();
    
    if (!trackingNumber) {
      throw new BadRequestException(`Fila ${shipmentIndex} (Lote ${batchNumber}): Guía vacía.`);
    }

    // 1. Duplicados
    if (processedTrackingNumbers.has(trackingNumber) || await this.existShipment(trackingNumber, consolidatedId)) {
      result.duplicated++;
      result.duplicatedTrackings.push(shipment);
      processedTrackingNumbers.add(trackingNumber);
      return;
    }
    processedTrackingNumbers.add(trackingNumber);

    // 2. Consulta FedEx con Selector de Generación (Anti-Gemelo Malvado)
    let fedexShipmentData: FedExTrackingResponseDto;
    try {
      fedexShipmentData = await this.trackPackageWithRetry(trackingNumber);
    } catch (err) {
      throw new InternalServerErrorException(`Error FedEx guía ${trackingNumber}: ${err.message}`);
    }

    let allTrackResults = fedexShipmentData.output.completeTrackResults[0].trackResults || [];
    
    // =================================================================================
    // 🛡️ CORRECCIÓN 1: SELECTOR DE GENERACIÓN (Jerarquía de UniqueID)
    // =================================================================================
    if (allTrackResults.length > 1) {
        allTrackResults.sort((a, b) => {
            // Extraemos la secuencia numérica del inicio del UniqueID (ej: 2461089000)
            const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
            const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');

            // La secuencia más alta es SIEMPRE la más reciente (la nueva vida de la guía)
            if (seqA !== seqB) return seqB - seqA;

            // Respaldo por fecha solo si los IDs son idénticos (muy raro)
            const timeA = new Date(a.scanEvents?.[0]?.date || 0).getTime();
            const timeB = new Date(b.scanEvents?.[0]?.date || 0).getTime();
            return timeB - timeA;
        });

        const winner = allTrackResults[0];
        this.logger.log(`[${trackingNumber}] 🚀 Selector de Generación: Elegido ID ${winner.trackingNumberInfo.trackingNumberUniqueId} (Secuencia Mayor).`);
            }

    const trackResult = allTrackResults[0]; 
    const scanEvents = trackResult?.scanEvents || [];
    const lsdHeader = trackResult?.latestStatusDetail;

    // 3. Fechas (TimeZone Hermosillo)
    let finalCommitDate: Date;
    if (shipment.commitDate && shipment.commitTime) {
      try {
        const timeZone = 'America/Hermosillo';
        finalCommitDate = toDate(`${shipment.commitDate}T${shipment.commitTime}`, { timeZone });
      } catch (e) { /* ignore */ }
    }
    if (!finalCommitDate || isNaN(finalCommitDate.getTime())) {
      const rawFedexDate = trackResult?.standardTransitTimeWindow?.window?.ends;
      if (rawFedexDate) finalCommitDate = parse(rawFedexDate, "yyyy-MM-dd'T'HH:mm:ssXXX", new Date());
    }
    if (!finalCommitDate || isNaN(finalCommitDate.getTime())) finalCommitDate = new Date();

    try {
      const newShipment = new Shipment();
      newShipment.trackingNumber = trackingNumber;
      newShipment.shipmentType = ShipmentType.FEDEX;
      newShipment.recipientName = shipment.recipientName || 'N/A';
      newShipment.recipientAddress = shipment.recipientAddress || 'N/A';
      newShipment.recipientCity = shipment.recipientCity || predefinedSubsidiary.name;
      newShipment.recipientZip = shipment.recipientZip || 'N/A';
      newShipment.recipientPhone = shipment.recipientPhone || 'N/A';
      newShipment.priority = getPriority(finalCommitDate);
      newShipment.commitDateTime = finalCommitDate;
      newShipment.consNumber = consolidated.consNumber || '';
      newShipment.receivedByName = trackResult?.deliveryDetails?.receivedByName || '';
      newShipment.fedexUniqueId = trackResult?.trackingNumberInfo?.trackingNumberUniqueId || null;
      newShipment.carrierCode = trackResult?.trackingNumberInfo?.carrierCode || null;
      newShipment.createdAt = new Date();
      newShipment.subsidiary = predefinedSubsidiary;
      newShipment.consolidatedId = consolidated.id; 

      // 4. Procesar Historial (Mapea todos los eventos sin ignorar nada)
      const histories = await this.processFedexScanEventsToStatuses(scanEvents, newShipment);

      // =================================================================================
      // 🛡️ SECCIÓN 5: LÓGICA DE CONSENSO (HEADER + HISTORIA)
      // =================================================================================
      
      // Peso de estatus para decisión
      const getWeight = (status: any) => {
          if (status === ShipmentStatusType.ENTREGADO || status === ShipmentStatusType.ENTREGADO_POR_FEDEX) return 10;
          if ([ShipmentStatusType.RECHAZADO, ShipmentStatusType.DIRECCION_INCORRECTA, ShipmentStatusType.CLIENTE_NO_DISPONIBLE, ShipmentStatusType.RETORNO_ABANDONO_FEDEX, ShipmentStatusType.LLEGADO_DESPUES].includes(status)) return 5;
          if (status !== ShipmentStatusType.DESCONOCIDO && status !== ShipmentStatusType.PENDIENTE && status !== ShipmentStatusType.EN_TRANSITO) return 1;
          return 0;
      };

      // A. Estatus del Header
      const headerStatus = mapFedexStatusToLocalStatus(lsdHeader?.derivedCode || lsdHeader?.code || '', lsdHeader?.ancillaryDetails?.[0]?.reason);
      
      // B. Estatus de la Historia (El más pesado manda)
      let historyStatus = ShipmentStatusType.PENDIENTE;
      let historyWeight = -1;
      
      if (histories && histories.length > 0) {
          histories.forEach(h => {
              const w = getWeight(h.status);
              if (w >= historyWeight) {
                  historyStatus = h.status as any;
                  historyWeight = w;
              }
          });
      }

      // C. Decisión: Si la historia tiene algo más específico (Peso >), corrige al Header
      let finalStatus = (historyWeight > getWeight(headerStatus)) ? historyStatus : headerStatus;

      // D. Supremacía de Entrega (DL en cualquier lado es final)
      if (lsdHeader?.code === 'DL' || lsdHeader?.derivedCode === 'DL' || scanEvents.some(e => e.derivedStatusCode === 'DL')) {
          finalStatus = ShipmentStatusType.ENTREGADO;
      }

      // E. Reseteo de Re-ingreso: Si es un paquete nuevo pero FedEx da DL viejo, forzamos PENDIENTE
      // (Se detecta porque el UniqueID es mayor al que tendríamos pero el estatus es viejo)
      if (finalStatus === ShipmentStatusType.ENTREGADO && scanEvents.length <= 1) {
          finalStatus = ShipmentStatusType.PENDIENTE;
      }

      newShipment.status = finalStatus as any;

      if (histories && histories.length > 0) {
        histories.forEach(h => { h.shipment = undefined; });
        newShipment.statusHistory = histories;
      }

      // 8. Lógica de Pagos (Original)
      if (shipment.payment) {
        const amountMatch = shipment.payment.match(/([0-9]+(?:\.[0-9]+)?)/);
        if (amountMatch) {
          const amount = parseFloat(amountMatch[1]);
          const typeMatch = shipment.payment.match(/^(COD|FTC|ROD)/);
          if (!isNaN(amount) && amount > 0) {
            newShipment.payment = {
              amount,
              type: typeMatch ? typeMatch[1] : null,
              status: finalStatus === ShipmentStatusType.ENTREGADO ? PaymentStatus.PAID : PaymentStatus.PENDING
            } as any;
          }
        }
      }

      // 9. Validación de Incomes (Original)
      if ([ShipmentStatusType.ENTREGADO, ShipmentStatusType.NO_ENTREGADO, ShipmentStatusType.RECHAZADO].includes(finalStatus as any)) {
        const matchedHistory = histories?.find(h => h.status === finalStatus);
        const validation = await this.applyIncomeValidationRules(
          newShipment,
          finalStatus as any,
          histories?.map(h => h.exceptionCode).filter(Boolean) || [],
          histories || [],
          trackingNumber,
          matchedHistory?.timestamp || new Date()
        );

        if (validation.isValid) {
          shipmentsToGenerateIncomes.push({
            shipment: newShipment,
            timestamp: validation.timestamp,
            exceptionCode: matchedHistory?.exceptionCode,
          });
        }
      }

      this.shipmentBatch.push(newShipment);
      result.saved++;

    } catch (err) {
      this.logger.error(`❌ Error guía ${trackingNumber}: ${err.message}`);
      throw err;
    }
}

  private async processShipment(
    shipment: ParsedShipmentDto,
    predefinedSubsidiary: Subsidiary,
    consolidated: Consolidated,
    result: any,
    shipmentsWithError: any,
    batchNumber: number,
    shipmentIndex: number,
    processedTrackingNumbers: Set<string>,
    shipmentsToGenerateIncomes: { shipment: Shipment; timestamp: Date; exceptionCode: string | undefined }[],
    consolidatedId: string
  ): Promise<void> {
    const trackingNumber = shipment.trackingNumber?.toString().trim();
    
    // 1. Validación de Tracking
    if (!trackingNumber) {
      throw new BadRequestException(`Fila ${shipmentIndex} (Lote ${batchNumber}): Guía vacía.`);
    }

    // 2. Validación de Duplicados (Archivo y DB)
    if (processedTrackingNumbers.has(trackingNumber) || await this.existShipment(trackingNumber, consolidatedId)) {
      result.duplicated++;
      result.duplicatedTrackings.push(shipment);
      processedTrackingNumbers.add(trackingNumber);
      return;
    }
    processedTrackingNumbers.add(trackingNumber);

    // 3. Consulta FedEx 
    let fedexShipmentData: FedExTrackingResponseDto;
    try {
      fedexShipmentData = await this.trackPackageWithRetry(trackingNumber);
    } catch (err) {
      throw new InternalServerErrorException(`Error FedEx guía ${trackingNumber}: ${err.message}`);
    }

    let allTrackResults = fedexShipmentData.output?.completeTrackResults?.[0]?.trackResults || [];

    // =================================================================================
    // 🛡️ CORRECCIÓN 1: SELECTOR DE GENERACIÓN (Jerarquía de UniqueID)
    // =================================================================================
    if (allTrackResults.length > 1) {
        allTrackResults.sort((a, b) => {
            const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
            const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
            if (seqA !== seqB) return seqB - seqA;
            const timeA = new Date(a.scanEvents?.[0]?.date || 0).getTime();
            const timeB = new Date(b.scanEvents?.[0]?.date || 0).getTime();
            return timeB - timeA;
        });

        const winner = allTrackResults[0];
        this.logger.log(`[${trackingNumber}] 🚀 Selector de Generación: Elegido ID ${winner.trackingNumberInfo?.trackingNumberUniqueId} (Secuencia Mayor).`);
    }

    const trackResult = allTrackResults[0]; 
    const scanEvents = trackResult?.scanEvents || [];
    const lsdHeader = trackResult?.latestStatusDetail;

    // 4. Determinación de Fecha de Compromiso (TimeZone Hermosillo)
    let finalCommitDate: Date;
    if (shipment.commitDate && shipment.commitTime) {
      try {
        const timeZone = 'America/Hermosillo';
        finalCommitDate = toDate(`${shipment.commitDate}T${shipment.commitTime}`, { timeZone });
      } catch (e) { /* fallback if custom date fails */ }
    }
    if (!finalCommitDate || isNaN(finalCommitDate.getTime())) {
      const rawFedexDate = trackResult?.standardTransitTimeWindow?.window?.ends;
      if (rawFedexDate) finalCommitDate = parse(rawFedexDate, "yyyy-MM-dd'T'HH:mm:ssXXX", new Date());
    }
    if (!finalCommitDate || isNaN(finalCommitDate.getTime())) finalCommitDate = new Date();

    try {
      // 5. Mapeo de Entidad Shipment
      const newShipment = new Shipment();
      newShipment.trackingNumber = trackingNumber;
      newShipment.shipmentType = ShipmentType.FEDEX;
      
      newShipment.recipientName = shipment.recipientName || 'N/A';
      newShipment.recipientAddress = shipment.recipientAddress || 'N/A';
      newShipment.recipientCity = shipment.recipientCity || predefinedSubsidiary.name;
      newShipment.recipientZip = shipment.recipientZip || 'N/A';
      newShipment.recipientPhone = shipment.recipientPhone || 'N/A';
      
      newShipment.priority = getPriority(finalCommitDate);
      newShipment.commitDateTime = finalCommitDate;
      newShipment.consNumber = consolidated.consNumber || '';
      newShipment.receivedByName = trackResult?.deliveryDetails?.receivedByName || '';
      newShipment.fedexUniqueId = trackResult?.trackingNumberInfo?.trackingNumberUniqueId || null;
      newShipment.carrierCode = trackResult?.trackingNumberInfo?.carrierCode || null;
      newShipment.createdAt = new Date();
      newShipment.subsidiary = predefinedSubsidiary;
      newShipment.consolidatedId = consolidated.id; 

      // 6. Procesar Historial (Mapea todos los eventos para la BD sin alterar el estatus principal)
      const histories = await this.processFedexScanEventsToStatusesResp(scanEvents, newShipment);

      // =================================================================================
      // 🛡️ SECCIÓN 7: LÓGICA DE INGRESO (BINARIA)
      // Todo paquete ingresado al sistema nace como PENDIENTE para ser trabajado,
      // a menos que FedEx confirme que ya fue ENTREGADO.
      // =================================================================================
      
      let finalStatus = ShipmentStatusType.PENDIENTE;

      // SUPREMACÍA DE ENTREGA (DL manda sobre TODO)
      const isDelivered = lsdHeader?.code === 'DL' || 
                          lsdHeader?.derivedCode === 'DL' || 
                          scanEvents.some(e => e.derivedStatusCode === 'DL' || e.eventType === 'DL');
      
      if (isDelivered) {
          finalStatus = ShipmentStatusType.ENTREGADO;
      }

      newShipment.status = finalStatus as any;

      if (histories && histories.length > 0) {
        histories.forEach(h => { h.shipment = undefined; }); 
        newShipment.statusHistory = histories;
      }

      // 8. LÓGICA DE PAGOS (Completa)
      if (shipment.payment) {
        const amountMatch = shipment.payment.match(/([0-9]+(?:\.[0-9]+)?)/);
        if (amountMatch) {
          const amount = parseFloat(amountMatch[1]);
          const typeMatch = shipment.payment.match(/^(COD|FTC|ROD)/);
          if (!isNaN(amount) && amount > 0) {
            newShipment.payment = {
              amount,
              type: typeMatch ? typeMatch[1] : null,
              status: finalStatus === ShipmentStatusType.ENTREGADO ? PaymentStatus.PAID : PaymentStatus.PENDING,
              createdAt: new Date()
            } as any;
          }
        }
      }

      // 9. VALIDACIÓN DE INCOMES (Reglas de Facturación)
      if ([ShipmentStatusType.ENTREGADO].includes(finalStatus as any)) {
        const matchedHistory = histories?.find(h => h.status === finalStatus);
        const validation = await this.applyIncomeValidationRules(
          newShipment,
          finalStatus as any,
          histories?.map(h => h.exceptionCode).filter(Boolean) || [],
          histories || [],
          trackingNumber,
          matchedHistory?.timestamp || new Date()
        );

        if (validation.isValid) {
          shipmentsToGenerateIncomes.push({
            shipment: newShipment,
            timestamp: validation.timestamp,
            exceptionCode: matchedHistory?.exceptionCode,
          });
        } else {
          this.logger.warn(`[${trackingNumber}] No genera income inicial: ${validation.reason}`);
        }
      }

      // 10. Agregar al Batch de guardado
      this.shipmentBatch.push(newShipment);
      result.saved++;

    } catch (err) {
      this.logger.error(`❌ Error guía ${trackingNumber}: ${err.message}`);
      if (err instanceof BadRequestException || err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException(`Error procesando guía ${trackingNumber}: ${err.message}`);
    }
  }

  private async generateIncomes(
    shipment: Shipment,
    timestamp: Date,
    exceptionCode: string | undefined,
    transactionalEntityManager: EntityManager
  ): Promise<void> {
    // 1. Obtener costo de la sucursal
    // Usamos una navegación segura para el ID de la sucursal
    const subsidiaryId = shipment.subsidiary?.id;
    let packageCost = shipment.subsidiary?.fedexCostPackage || 0;

    if (packageCost <= 0 && subsidiaryId) {
      const subsidiary = await transactionalEntityManager.getRepository(Subsidiary).findOne({
        where: { id: subsidiaryId },
        select: ['fedexCostPackage', 'name']
      });
      packageCost = subsidiary?.fedexCostPackage || 0;
    }

    if (packageCost <= 0) {
      // Cambiamos throw por log para que un error de configuración de sucursal no detenga todo el proceso del Cron
      this.logger.error(`❌ FINANCE_ERROR: La sucursal con ID ${subsidiaryId} tiene costo $0. Guía: ${shipment.trackingNumber}`);
      return;
    }

    // 2. Determinar el tipo de ingreso
    let incomeType: IncomeStatus;
    const incomeSubType = exceptionCode ?? '';
    
    // Normalizamos a string para comparar con seguridad
    const currentStatus = String(shipment.status);

    if (currentStatus === ShipmentStatusType.ENTREGADO || currentStatus === 'entregado') {
      incomeType = IncomeStatus.ENTREGADO;
    } else if ([
        ShipmentStatusType.RECHAZADO, 
        ShipmentStatusType.CLIENTE_NO_DISPONIBLE, 
        ShipmentStatusType.DEVUELTO_A_FEDEX, 
        'no_entregado'
      ].includes(currentStatus as any)) {
      incomeType = IncomeStatus.NO_ENTREGADO;
    } else {
      this.logger.warn(`⚠️ Estatus ${currentStatus} no genera ingreso para guía ${shipment.trackingNumber}`);
      return; 
    }

    // 3. VALIDACIÓN SEMANAL
    const mDate = dayjs(timestamp || new Date());
    // Aseguramos que la ventana sea consistente (Lunes a Domingo)
    const startOfWeek = mDate.startOf('week').add(1, 'day').toDate();
    const endOfWeek = mDate.endOf('week').add(1, 'day').endOf('day').toDate();

    const exists = await transactionalEntityManager.getRepository(Income).findOne({
      where: { 
        trackingNumber: shipment.trackingNumber, 
        incomeType: incomeType,
        date: Between(startOfWeek, endOfWeek)
      },
      select: ['id'] // Solo necesitamos saber si existe
    });

    if (exists) {
      return;
    }

    // 4. Creación del registro (BLINDAJE AQUÍ)
    // En lugar de pasar objetos de entidad, pasamos solo los IDs planos.
    // Esto evita que TypeORM intente hacer "updates" accidentales en Shipment o Subsidiary.
    const newIncome = transactionalEntityManager.create(Income, {
      trackingNumber: shipment.trackingNumber,
      shipment: { id: shipment.id },         // Solo ID plano
      subsidiary: { id: subsidiaryId },     // Solo ID plano
      shipmentType: shipment.shipmentType || ShipmentType.FEDEX,
      cost: packageCost,
      incomeType,
      nonDeliveryStatus: incomeSubType,
      isGrouped: false,
      sourceType: IncomeSourceType.SHIPMENT,
      date: timestamp || new Date(),
      createdAt: new Date(),
    });

    // Usamos save sobre el repositorio específico para máxima limpieza
    await transactionalEntityManager.getRepository(Income).save(newIncome);
    
    this.logger.log(`✅ Income [${incomeType}] registrado ($${packageCost}) para semana del ${mDate.format('DD/MM/YYYY')}`);
  }

  private async flushLogBuffer(): Promise<void> {
    if (this.logBuffer.length) {
      this.logger.log(`📜 Escribiendo ${this.logBuffer.length} logs a archivo`);
      try {
        await fs.appendFile(this.logFilePath, this.logBuffer.join('\n') + '\n', 'utf-8');
        this.logger.log(`✅ Logs escritos a ${this.logFilePath}`);
        this.logBuffer = [];
      } catch (err) {
        this.logger.error(`❌ Error escribiendo logs: ${err.message}`);
      }
    }
  }

  private async logErrors(shipmentsWithError: any): Promise<void> {
    if (
      shipmentsWithError.duplicated.length ||
      shipmentsWithError.fedexError.length ||
      shipmentsWithError.saveError.length
    ) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputPath = path.join(__dirname, `../../logs/shipment-errors-${timestamp}.json`);
      this.logger.log(`📜 Generando archivo de errores: ${outputPath}`);
      try {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(shipmentsWithError, null, 2), 'utf-8');
        this.logger.warn(`⚠️ Errores registrados en archivo: ${outputPath}`);
        this.logBuffer.push(`⚠️ Errores registrados en archivo: ${outputPath}`);
      } catch (err) {
        this.logger.error(`❌ Error escribiendo archivo de errores: ${err.message}`);
        this.logBuffer.push(`❌ Error escribiendo archivo de errores: ${err.message}`);
      }
    }
  }

  private async trackPackageWithRetry(trackingNumber: string): Promise<FedExTrackingResponseDto> {
    let attempts = 0;
    const maxAttempts = 3;
    const delayMs = 1000;

    while (attempts < maxAttempts) {
      this.logger.log(`📬 Intento ${attempts + 1}/${maxAttempts} para trackPackage: ${trackingNumber}`);
      try {
        const result = await this.fedexService.trackPackage(trackingNumber);
        this.logger.log(`✅ trackPackage exitoso para ${trackingNumber}`);
        return result;
      } catch (err) {
        attempts++;
        if (attempts === maxAttempts) {
          this.logger.error(`❌ Fallo trackPackage para ${trackingNumber} tras ${maxAttempts} intentos`);
          throw err;
        }
        this.logger.warn(`⚠️ Reintentando trackPackage para ${trackingNumber} tras error: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw new Error(`Failed to track package ${trackingNumber} after ${maxAttempts} attempts`);
  }

  private async existShipment(trackingNumber: string, consolidatedId: string): Promise<boolean> {
    this.logger.log(`🔍 Verificando existencia de envío: ${trackingNumber}`);
    try {
      const exists = await this.shipmentRepository.exists({
        where: { trackingNumber, consolidatedId },
      });
      this.logger.log(`✅ Verificación completada para ${trackingNumber}: ${exists}`);
      return exists;
    } catch (err) {
      this.logger.log(`❌ Error verificando existencia de envío ${trackingNumber}: ${err.message}`);
      throw err;
    }
  }

  async findByTrackingNumber(trackingNumber: string) {
    const shipment = await this.shipmentRepository.findOne({
      where : {trackingNumber},
      relations: ['statusHistory'],
    });

    if (!shipment) {
      throw new Error('Shipment not found');
    }

    return {
      trackingNumber: shipment.trackingNumber,
      recipientName: shipment.recipientName,
      recipientAddress: shipment.recipientAddress,
      recipientPhone: shipment.recipientPhone,
      status: shipment.status,
      commitDate: shipment.commitDateTime,
      shipmentType: shipment.shipmentType,
      statusHistory: shipment.statusHistory,
    };
  }

  async findStatusHistoryByTrackingNumber(trackingNumber: string) {
    const shipment = await this.shipmentRepository.findOne({
      where: { trackingNumber },
      relations: ['statusHistory']
    });

    if (!shipment) {
      throw new Error('Shipment not found');
    }

    return shipment.statusHistory;
  }


  /********************  DHL ********************/
    async processDhlTxtFile(fileContent: string): Promise<{ success: number; errors: number }> {
      const shipmentsDto = this.dhlService.parseDhlText(fileContent);
      let results = { success: 0, errors: 0 };

      for (const dto of shipmentsDto) {
          try {
              if (!dto.awb) {
                  this.logger.warn('Envío sin AWB, omitiendo');
                  continue;
              }

              const exists = await this.shipmentRepository.existsBy({ trackingNumber: dto.awb });
              if (exists) {
                  this.logger.log(`Envío ${dto.awb} ya existe, omitiendo`);
                  continue;
              }

              await this.createShipmentFromDhlDto(dto);
              results.success++;
              this.logger.log(`Envío ${dto.awb} guardado correctamente`);
          } catch (error) {
              results.errors++;
              this.logger.error(`Error guardando ${dto.awb}: ${error.message}`);
          }
      }

      return results;
    }

    async processDhlExcelFiel(file: Express.Multer.File) {
      if (!file) throw new BadRequestException('No file uploaded');

      const { buffer, originalname } = file;

      if (!originalname.match(/\.(csv|xlsx?)$/i)) {
        throw new BadRequestException('Unsupported file type');
      }

      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      const shipments = parseDynamicSheetDHL(sheet);

      for(const {trackingNumber, recipientAddress, recipientAddress2, commitDate} of shipments) {
        let shipmentToUpdate = await this.shipmentRepository.findOneBy({
          trackingNumber,
          recipientAddress
        })

        const [fecha, hora] = commitDate.split(' ');

        if(shipmentToUpdate) {
          shipmentToUpdate.commitDateTime = fecha; //Faltaría agregarle la hora
          shipmentToUpdate.recipientAddress = recipientAddress + " " + recipientAddress2;
          await this.shipmentRepository.save(shipmentToUpdate);
        }

      }

      console.log("🚀 ~ ShipmentsService ~ processDhlExcelFiel ~ shipments:", shipments)

      return shipments;
    }

    private async createShipmentFromDhlDto(dto: DhlShipmentDto): Promise<Shipment> {
      const shipment = new Shipment();
      
      // 1. Poblar los datos básicos del shipment
      this.dhlService.populateShipmentFromDhlDto(shipment, dto);
      
      // 2. Crear los status history (se guardarán automáticamente por el cascade)
      if (dto.events?.length > 0) {
          shipment.statusHistory = this.dhlService.createStatusHistoryFromDhlEvents(dto.events);
          
          // Establecer el último status como el estado actual del shipment
          const lastStatus = shipment.statusHistory[shipment.statusHistory.length - 1];
          shipment.status = lastStatus.status;
      }
      
      // 3. Guardar el shipment (los status se guardarán automáticamente)
      return await this.shipmentRepository.save(shipment);
    }
  /******************************************* */

  /****** Métodos para el cron que actualiza las prioridades y enviar correo con las prioridades Altas ******************/
    async updatePriorities() {
      const shipments = await this.shipmentRepository.find({
        where: {
          status: In([
            ShipmentStatusType.EN_RUTA,
            ShipmentStatusType.PENDIENTE,
            ShipmentStatusType.RECOLECCION
          ]),
        },
      });

      for (const shipment of shipments) {
        shipment.priority = getPriority(shipment.commitDateTime);
      }

      // Guardar todos en una sola operación
      const updatedShipments = await this.shipmentRepository.save(shipments);

      return updatedShipments;
    }

    async sendEmailWithHighPriorities() {
      const today = new Date();

      // QueryBuilder con join manual a consolidated
      const shipmentsRaw = await this.shipmentRepository
        .createQueryBuilder('shipment')
        .leftJoinAndSelect('shipment.subsidiary', 'subsidiary')
        .leftJoin(
          'consolidated',
          'consolidated',
          'consolidated.id = shipment.consolidatedId'
        )
        .addSelect(['consolidated.date'])
        .where('shipment.status IN (:...statuses)', {
          statuses: [
            ShipmentStatusType.EN_RUTA,
            ShipmentStatusType.PENDIENTE,
            ShipmentStatusType.RECOLECCION,
          ],
        })
        .andWhere('shipment.priority = :priority', { priority: Priority.ALTA })
        .getRawMany();

      if (shipmentsRaw.length === 0) return;

      // La estructura raw tiene campos con alias como shipment_id, consolidated_date, subsidiary_name, etc.
      // Ajustamos para mapear y calcular días en almacén
      const shipments = shipmentsRaw
        .map((row) => {
          const consolidatedDate = row['consolidated_date'];
          let daysInWarehouse: number | string = 'N/A';
          if (consolidatedDate) {
            const diffMs = today.getTime() - new Date(consolidatedDate).getTime();
            daysInWarehouse = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          }
          return {
            trackingNumber: row['shipment_trackingNumber'],
            subsidiaryName: row['subsidiary_name'] || 'N/A',
            consolidatedDate,
            status: row['shipment_status'],
            daysInWarehouse,
          };
        })
        .sort((a, b) => {
          const aDays = typeof a.daysInWarehouse === 'number' ? a.daysInWarehouse : -1;
          const bDays = typeof b.daysInWarehouse === 'number' ? b.daysInWarehouse : -1;
          return bDays - aDays;
        });


      const htmlRows = shipments
        .map(
          (s) => `
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 8px; text-align: center;">${s.trackingNumber}</td>
            <td style="padding: 8px;">${s.subsidiaryName}</td>
            <td style="padding: 8px; text-align: center;">${s.consolidatedDate ? new Date(s.consolidatedDate).toLocaleDateString() : 'Sin fecha'}</td>
            <td style="padding: 8px; text-align: center;">${s.status}</td>
            <td style="padding: 8px; text-align: center;">${s.daysInWarehouse !== 'N/A' ? s.daysInWarehouse + ' días' : 'N/A'}</td>
          </tr>
        `
        )
        .join('');

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; color: #2c3e50; max-width: 800px; margin: auto;">
          <h2 style="border-bottom: 3px solid #e74c3c; padding-bottom: 8px;">
            Reporte de Envíos con Prioridad Alta
          </h2>
          <p>
            Se han detectado los siguientes envíos con prioridad <strong>ALTA</strong> en estado En Ruta, Pendiente o Recolección:
          </p>
          <p><em>Por favor considere la fecha de recepción de este correo (<strong>${today.toLocaleDateString()}</strong>) para el seguimiento y gestión de estos envíos.</em></p>

          <table 
            border="0" 
            cellpadding="0" 
            cellspacing="0" 
            style="border-collapse: collapse; width: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.05);"
          >
            <thead style="background-color: #f7f7f7; text-align: center;">
              <tr>
                <th style="padding: 10px;">Tracking Number</th>
                <th style="padding: 10px;">Destino</th>
                <th style="padding: 10px;">Fecha Ingreso a Almacén</th>
                <th style="padding: 10px;">Estatus</th>
                <th style="padding: 10px;">Días en Almacén</th>
              </tr>
            </thead>
            <tbody>
              ${htmlRows}
            </tbody>
          </table>

          <p style="margin-top: 20px; font-weight: bold; color: #c0392b;">
            Este correo ha sido enviado con <strong>alta prioridad</strong> debido a la criticidad de los envíos.
          </p>

          <p style="margin-top: 20px;">
            Para hacer un monitoreo detallado de los envíos, por favor visite: 
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


      const result = await this.mailService.sendHighPriorityShipmentsEmail(
        {
          to: 'javier.rappaz@gmail.com',
          cc: ['josejuanurena@paqueteriaymensajeriadelyaqui.com', 'gerardorobles@paqueteriaymensajeriadelyaqui.com'],
          htmlContent
        }
      );

      console.log('Correo enviado correctamente:', result);
    }      
  /****************************************************************************************** */


  /****** Métodos para el cron que valida los envios y actualiza los status ******************/
    async getShipmentsToValidateResp2901(): Promise<Shipment[]> {
      this.logger.log(`🔍 Iniciando getShipmentsToValidate con estatus de excepción`);
      try {
        const query = this.shipmentRepository
          .createQueryBuilder('shipment')
          .leftJoinAndSelect('shipment.payment', 'payment')
          .leftJoinAndSelect('shipment.subsidiary', 'subsidiary')
          .where('LOWER(shipment.shipmentType) = LOWER(:type)', { type: ShipmentType.FEDEX })
          .andWhere(new Brackets(qb => {
            qb.where('LOWER(shipment.status) IN (:...statuses)', {
              statuses: [
                String(ShipmentStatusType.PENDIENTE).toLowerCase(),
                String(ShipmentStatusType.EN_RUTA).toLowerCase(),
                String(ShipmentStatusType.DESCONOCIDO).toLowerCase(),
                String(ShipmentStatusType.EN_BODEGA).toLowerCase(), // <--- Código 67
                String(ShipmentStatusType.DIRECCION_INCORRECTA).toLowerCase(), // <--- Código 03, A12, A13
                String(ShipmentStatusType.CLIENTE_NO_DISPONIBLE).toLowerCase(), // <--- Código 08, 71, 72
                String(ShipmentStatusType.ESTACION_FEDEX).toLowerCase(), // <--- Paquetes en Ocurre/Sucursal
              ]
            })
            .orWhere('LOWER(shipment.status) = :ne', { 
              ne: String(ShipmentStatusType.NO_ENTREGADO).toLowerCase() 
            });
          }));

        const shipments = await query.getMany();
        this.logger.log(`📦 Se encontraron ${shipments.length} envíos.`);
        return shipments;
      } catch (err) {
        this.logger.error(`❌ Error en getShipmentsToValidate: ${err.message}`);
        return [];
      }
    }

    async getShipmentsToValidate(): Promise<Shipment[]> {
      this.logger.log(`🔍 Iniciando getShipmentsToValidate...`);
      
      // 1. FECHA DE CORTE: Seguridad contra guías recicladas.
      // Solo nos interesan envíos creados en los últimos 6 meses.
      // Si un envío tiene más de 6 meses y sigue "PENDIENTE", es un error de dato, no un envío real.
      const cutOffDate = new Date();
      cutOffDate.setMonth(cutOffDate.getMonth() - 6);

      try {
        const statusList = [
          ShipmentStatusType.PENDIENTE,
          ShipmentStatusType.EN_RUTA,
          ShipmentStatusType.DESCONOCIDO,
          ShipmentStatusType.EN_BODEGA,
          ShipmentStatusType.DIRECCION_INCORRECTA,
          ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
          ShipmentStatusType.ESTACION_FEDEX,
          ShipmentStatusType.RECHAZADO,
          ShipmentStatusType.LLEGADO_DESPUES,
          ShipmentStatusType.NO_ENTREGADO // Lo agregué al array para simplificar el OR
        ].map(s => String(s).toLowerCase());

        const query = this.shipmentRepository
          .createQueryBuilder('shipment')
          .leftJoinAndSelect('shipment.payment', 'payment')
          .leftJoinAndSelect('shipment.subsidiary', 'subsidiary') // Necesario para la config en el paso 2
          
          // Filtro 1: Tipo FedEx
          .where('LOWER(shipment.shipmentType) = :type', { type: ShipmentType.FEDEX.toLowerCase() })
          
          // Filtro 2: Ventana de tiempo (VITAL para evitar duplicados viejos)
          .andWhere('shipment.createdAt > :cutOffDate', { cutOffDate })

          // Filtro 3: Estatus permitidos
          .andWhere('LOWER(shipment.status) IN (:...statuses)', { statuses: statusList })    

        const shipments = await query.getMany();
        
        this.logger.log(`📦 Se encontraron ${shipments.length} envíos vigentes para validar.`);
        return shipments;

      } catch (err) {
        this.logger.error(`❌ Error en getShipmentsToValidate: ${err.message}`);
        return [];
      }
    }

    async getSimpleChargeShipments(): Promise<ChargeShipment[]> {
            this.logger.log(`🔍 Iniciando Charge Shipments to validate...`);
      
      // 1. FECHA DE CORTE: Seguridad contra guías recicladas.
      // Solo nos interesan envíos creados en los últimos 6 meses.
      // Si un envío tiene más de 6 meses y sigue "PENDIENTE", es un error de dato, no un envío real.
      const cutOffDate = new Date();
      cutOffDate.setMonth(cutOffDate.getMonth() - 6);

      try {
        const statusList = [
          ShipmentStatusType.PENDIENTE,
          ShipmentStatusType.EN_RUTA,
          ShipmentStatusType.DESCONOCIDO,
          ShipmentStatusType.EN_BODEGA,
          ShipmentStatusType.DIRECCION_INCORRECTA,
          ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
          ShipmentStatusType.LLEGADO_DESPUES,
          ShipmentStatusType.ESTACION_FEDEX,
          ShipmentStatusType.NO_ENTREGADO // Lo agregué al array para simplificar el OR
        ].map(s => String(s).toLowerCase());

        const query = this.chargeShipmentRepository
          .createQueryBuilder('chargeShipment')
          .leftJoinAndSelect('chargeShipment.payment', 'payment')
          .leftJoinAndSelect('chargeShipment.subsidiary', 'subsidiary') // Necesario para la config en el paso 2
          
          // Filtro 1: Tipo FedEx
          .where('LOWER(chargeShipment.shipmentType) = :type', { type: ShipmentType.FEDEX.toLowerCase() })
          
          // Filtro 2: Ventana de tiempo (VITAL para evitar duplicados viejos)
          .andWhere('chargeShipment.createdAt > :cutOffDate', { cutOffDate })

          // Filtro 3: Estatus permitidos
          .andWhere('LOWER(chargeShipment.status) IN (:...statuses)', { statuses: statusList })    

        const chargeShipments = await query.getMany();
        
        this.logger.log(`📦 Se encontraron ${chargeShipments.length} envíos vigentes para validar.`);
        return chargeShipments;

      } catch (err) {
        this.logger.error(`❌ Error en getSimpleChargeShipments: ${err.message}`);
        return [];
      }
    }

    private async logUnusualCodes(unusualCodes: { trackingNumber: string; derivedCode: string; exceptionCode?: string; eventDate: string; statusByLocale?: string }[]): Promise<void> {
      if (unusualCodes.length) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputPath = path.join(__dirname, `../../logs/unusual-codes-${timestamp}.json`);
        this.logger.log(`📜 Generando archivo de códigos inusuales: ${outputPath}`);
        try {
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, JSON.stringify(unusualCodes, null, 2), 'utf-8');
          this.logger.log(`✅ Códigos inusuales registrados en: ${outputPath}`);
          this.logBuffer.push(`✅ Códigos inusuales registrados en: ${outputPath}`);
        } catch (err) {
          this.logger.error(`❌ Error escribiendo archivo de códigos inusuales: ${err.message}`);
          this.logBuffer.push(`❌ Error escribiendo archivo de códigos inusuales: ${err.message}`);
        }
      }
    }


  /****************************************************************************************** */



  /**** Métodos solo testing y puede convertirse en los nuevos */
    private chunkArray<T>(array: T[], size: number): T[][] {
      const result: T[][] = [];
      for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
      }
      return result;
    }

    /*** Es un respaldo... eliminar cuando este validado (Realizado: 28-12-25) */
    async checkStatusOnFedexBySubsidiaryRulesTestingResp(
      trackingNumbers: string[],
      shouldPersist = false
    ): Promise<FedexTrackingResponseDto> {
      const shipmentsWithError: { trackingNumber: string; reason: string; shipmentId?: string }[] = [];
      const unusualCodes: {
        trackingNumber: string;
        derivedCode: string;
        exceptionCode?: string;
        eventDate: string;
        statusByLocale?: string;
        shipmentId?: string;
      }[] = [];
      const shipmentsWithOD: { trackingNumber: string; eventDate: string; shipmentId?: string }[] = [];
      const shipmentsWithInvalidIncome: { trackingNumber: string; eventDate: string; shipmentId?: string }[] = [];
      const updatedShipments: {
        trackingNumber: string;
        fromStatus: string;
        toStatus: string;
        eventDate: string;
        shipmentId: string;
        consolidatedId?: string;
        subsidiaryId?: string;
      }[] = [];
      const forPickUpShipments: {
        trackingNumber: string;
        eventDate: string;
        shipmentId: string;
        subsidiaryId?: string;
        consolidatedId?: string;
      }[] = [];
      const processedIncomes = new Set<string>();

      try {
        this.logger.log(`Iniciando checkStatusOnFedexBySubsidiaryRules con ${trackingNumbers.length} trackingNumbers`);

        // Buscar shipments
        const shipments = await this.shipmentRepository
          .createQueryBuilder('shipment')
          .leftJoinAndSelect('shipment.subsidiary', 'subsidiary')
          .leftJoinAndSelect('shipment.payment', 'payment')
          .leftJoinAndSelect('shipment.statusHistory', 'statusHistory')
          .addSelect('shipment.consolidatedId', 'consolidatedId')
          .where('shipment.trackingNumber IN (:...trackingNumbers)', { trackingNumbers })
          .getMany();

        // Validar trackingNumbers en DB
        const foundTrackingNumbers = [...new Set(shipments.map(s => s.trackingNumber))];
        const notFoundTracking = trackingNumbers.filter(tn => !foundTrackingNumbers.includes(tn));
        for (const tn of notFoundTracking) {
          const reason = `No se encontro shipment en BD para trackingNumber: ${tn}`;
          this.logger.warn(reason);
          shipmentsWithError.push({ trackingNumber: tn, reason });
        }

        // Agrupar shipments por trackingNumber
        const shipmentsByTrackingNumber = shipments.reduce((acc, shipment) => {
          if (!acc[shipment.trackingNumber]) {
            acc[shipment.trackingNumber] = [];
          }
          (shipment as any).consolidatedId = (shipment as any).consolidatedId || null;
          acc[shipment.trackingNumber].push(shipment);
          return acc;
        }, {} as Record<string, Shipment[]>);

        // Procesar en batches
        const trackingNumberBatches = this.chunkArray(Object.keys(shipmentsByTrackingNumber), this.BATCH_SIZE || 100);

        for (let i = 0; i < trackingNumberBatches.length; i++) {
          const batch = trackingNumberBatches[i];
          this.logger.log(`Procesando lote ${i + 1}/${trackingNumberBatches.length} con ${batch.length} trackingNumbers`);

          await Promise.all(
            batch.map(async (trackingNumber) => {
              const shipmentList = shipmentsByTrackingNumber[trackingNumber];

              // Validar numero de shipments
              if (shipmentList.length === 0) {
                const reason = `No se encontraron shipments para ${trackingNumber}`;
                this.logger.error(reason);
                shipmentsWithError.push({ trackingNumber, reason });
                return;
              }

              this.logger.log(`Procesando ${trackingNumber} con ${shipmentList.length} shipment(s)`);

              // Seleccionar shipment representativo (solo para ingresos)
              const representativeShipment = shipmentList.sort((a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              )[0];

              // Consultar FedEx con reintentos
              let shipmentInfo: FedExTrackingResponseDto | null = null;
              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  shipmentInfo = await this.trackPackageWithRetry(trackingNumber);
                  break;
                } catch (err) {
                  this.logger.warn(`Intento ${attempt}/3 fallido para ${trackingNumber}: ${err.message}`);
                  if (attempt === 3) {
                    const reason = `Error al obtener informacion de FedEx para ${trackingNumber} tras 3 intentos: ${err.message}`;
                    this.logger.error(reason);
                    shipmentList.forEach((shipment) => {
                      shipmentsWithError.push({ trackingNumber, reason, shipmentId: shipment.id });
                    });
                    return;
                  }
                  await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
              }

              if (!shipmentInfo?.output?.completeTrackResults?.length || !shipmentInfo.output.completeTrackResults[0]?.trackResults?.length) {
                const reason = `No se encontro informacion valida del envio ${trackingNumber}`;
                this.logger.error(reason);
                shipmentList.forEach((shipment) => {
                  shipmentsWithError.push({ trackingNumber, reason, shipmentId: shipment.id });
                });
                return;
              }

              const trackResults = shipmentInfo.output.completeTrackResults[0].trackResults;
              // Seleccionar el scanEvent mas reciente
              const allScanEvents = trackResults.flatMap((result) => result.scanEvents || []);
              const latestEvent = allScanEvents.sort((a, b) => {
                const dateA = a.date ? new Date(a.date).getTime() : 0;
                const dateB = b.date ? new Date(b.date).getTime() : 0;
                return dateB - dateA;
              })[0];

              console.log("🚀 ~ ShipmentsService ~ checkStatusOnFedexBySubsidiaryRulesTesting ~ latestEvent:", latestEvent)

              if (!latestEvent) {
                const reason = `No se encontraron eventos validos para ${trackingNumber}`;
                this.logger.error(reason);
                shipmentList.forEach((shipment) => {
                  shipmentsWithError.push({ trackingNumber, reason, shipmentId: shipment.id });
                });
                return;
              }

              // Validar y parsear event.date
              let eventDate: Date;
              try {
                eventDate = parseISO(latestEvent.date);
                if (isNaN(eventDate.getTime())) throw new Error(`Fecha invalida: ${latestEvent.date}`);
                this.logger.log(`Fecha del evento para ${trackingNumber}: ${latestEvent.date} -> ${eventDate.toISOString()}`);
              } catch (err) {
                const reason = `Error al parsear event.date para ${trackingNumber}: ${err.message}`;
                this.logger.error(reason);
                shipmentList.forEach((shipment) => {
                  shipmentsWithError.push({ trackingNumber, reason, shipmentId: shipment.id });
                });
                return;
              }

              // Obtener latestStatusDetail del trackResult correspondiente
              const latestTrackResult = trackResults.find((result) =>
                result.scanEvents.some((e) => e.date === latestEvent.date && e.eventType === latestEvent.eventType)
              ) || trackResults[0];
              const latestStatusDetail = latestTrackResult.latestStatusDetail;
              console.log("🚀 ~ ShipmentsService ~ checkStatusOnFedexBySubsidiaryRulesTesting ~ latestStatusDetail:", latestStatusDetail)
              const exceptionCode = latestEvent.exceptionCode || latestStatusDetail?.ancillaryDetails?.[0]?.reason;
              console.log("Exception: ", exceptionCode);

              // Priorizar ENTREGADO para eventos de entrega
              let mappedStatus: ShipmentStatusType;
              if (latestEvent.eventType === 'DL' || latestEvent.derivedStatusCode === 'DL') {
                this.logger.debug(`Priorizando ENTREGADO para ${trackingNumber}: eventType=${latestEvent.eventType}, derivedStatusCode=${latestEvent.derivedStatusCode}`);
                mappedStatus = ShipmentStatusType.ENTREGADO;
              } else {
                mappedStatus = mapFedexStatusToLocalStatus(latestStatusDetail?.code || latestEvent.derivedStatusCode, exceptionCode);
              }

              // Log para 07
              if (exceptionCode === '07') {
                this.logger.debug(`🔍 Detected exceptionCode 07 for ${trackingNumber}: eventType=${latestEvent.eventType}, derivedCode=${latestStatusDetail?.derivedCode || latestEvent.derivedStatusCode}, statusByLocale=${latestStatusDetail?.statusByLocale}, mappedStatus=${mappedStatus}`);
              }

              this.logger.debug(`Mapping result for ${trackingNumber}: derivedCode=${latestStatusDetail?.derivedCode || latestEvent.derivedStatusCode}, exceptionCode=${exceptionCode}, mappedStatus=${mappedStatus}`);

              // Verificar si es HP con "Ready for recipient pickup"
              if (latestEvent.eventType === 'HP' && latestEvent.eventDescription?.toLowerCase().includes('ready for recipient pickup')) {
                this.logger.debug(`HP event with exceptionCode=${exceptionCode} for ${trackingNumber}, diverting to ES_OCURRE`);
                const formattedEventDate = format(eventDate, 'yyyy-MM-dd HH:mm:ss');

                if (shouldPersist) {
                  try {
                    await this.shipmentRepository.manager.transaction(async (em) => {
                      // Crear ForPickUp
                      const forPickUp = new ForPickUp();
                      forPickUp.trackingNumber = trackingNumber;
                      forPickUp.date = eventDate;
                      forPickUp.subsidiary = representativeShipment.subsidiary;
                      forPickUp.createdAt = new Date();

                      await em.save(ForPickUp, forPickUp);
                      this.logger.log(`ForPickUp guardado para ${trackingNumber} con date=${formattedEventDate}, subsidiaryId=${representativeShipment.subsidiary?.id}`);

                      // Actualizar cada shipment a ES_OCURRE
                      for (const shipment of shipmentList) {
                        // Skip si ya es ENTREGADO
                        if (shipment.statusHistory?.some(h => h.status === ShipmentStatusType.ENTREGADO)) {
                          this.logger.log(`Omitiendo actualizacion para ${trackingNumber} (shipmentId=${shipment.id}): ya tiene estado ENTREGADO`);
                          continue;
                        }

                        const fromStatus = shipment.status;
                        const newShipmentStatus = new ShipmentStatus();
                        newShipmentStatus.status = ShipmentStatusType.ES_OCURRE;
                        newShipmentStatus.timestamp = eventDate;
                        newShipmentStatus.notes = `${latestEvent.eventType} - ${latestEvent.eventDescription}`;
                        newShipmentStatus.shipment = shipment;

                        shipment.status = ShipmentStatusType.ES_OCURRE;
                        shipment.statusHistory = shipment.statusHistory || [];
                        shipment.statusHistory.push(newShipmentStatus);

                        await em.save(ShipmentStatus, newShipmentStatus);
                        await em
                          .createQueryBuilder()
                          .update(Shipment)
                          .set({ status: ShipmentStatusType.ES_OCURRE })
                          .where('id = :id', { id: shipment.id })
                          .execute();

                        this.logger.log(`Shipment actualizado a ES_OCURRE para ${trackingNumber} (shipmentId=${shipment.id}, subsidiaryId=${representativeShipment.subsidiary?.id}) desde fromStatus=${fromStatus}`);

                        updatedShipments.push({
                          trackingNumber,
                          fromStatus,
                          toStatus: ShipmentStatusType.ES_OCURRE,
                          eventDate: eventDate.toISOString(),
                          shipmentId: shipment.id,
                          consolidatedId: shipment.consolidatedId,
                          subsidiaryId: representativeShipment.subsidiary?.id,
                        });
                      }
                    });
                  } catch (err) {
                    const reason = `Error al guardar ForPickUp o actualizar shipment a ES_OCURRE para ${trackingNumber}: ${err.message}`;
                    this.logger.error(reason);
                    shipmentList.forEach((shipment) => {
                      shipmentsWithError.push({ trackingNumber, reason, shipmentId: shipment.id });
                    });
                  }
                }

                shipmentList.forEach((shipment) => {
                  forPickUpShipments.push({
                    trackingNumber,
                    eventDate: formattedEventDate,
                    shipmentId: shipment.id,
                    subsidiaryId: representativeShipment.subsidiary?.id,
                    consolidatedId: shipment.consolidatedId,
                  });
                });

                return;
              }

              // Obtener reglas por sucursal
              const subsidiaryRules = await this.getSubsidiaryRules();
              const defaultRules = {
                allowedExceptionCodes: ['07', '03', '08', '17', '67', '14', '16', 'OD'],
                allowedStatuses: Object.values(ShipmentStatusType),
                maxEventAgeDays: 30,
                allowDuplicateStatuses: false,
                allowedEventTypes: ['DL', 'DE', 'DU', 'RF', 'TA', 'TD', 'HL', 'OC', 'IT', 'AR', 'AF', 'CP', 'CC', 'PU'],
                noIncomeExceptionCodes: ['03'],
                notFoundExceptionCodes: [],
                minEvents08: 3,
                allowException03: true,
                allowException16: false,
                allowExceptionOD: false,
                allowIncomeFor07: true, // Allow income validation for 07
              };

              // Procesar cada shipment con sus propias reglas
              for (const shipment of shipmentList) {
                // Skip si ya es ENTREGADO
                if (shipment.statusHistory?.some(h => h.status === ShipmentStatusType.ENTREGADO)) {
                  this.logger.log(`Omitiendo actualizacion para ${trackingNumber} (shipmentId=${shipment.id}): ya tiene estado ENTREGADO`);
                  continue;
                }

                const subsidiaryId = shipment.subsidiary?.id || 'default';
                const rules = subsidiaryRules[subsidiaryId] || defaultRules;
                this.logger.log(`Reglas aplicadas para ${trackingNumber} (shipmentId=${shipment.id}, subsidiaryId=${subsidiaryId}): ${JSON.stringify(rules)}`);

                // Filtrar eventos, incluyendo 07
                const allowedEvents = allScanEvents.filter((e) => 
                  rules.allowedEventTypes.includes(e.eventType) || 
                  (e.exceptionCode === '03' && rules.allowException03) || 
                  e.exceptionCode === '07'
                );
                if (!allowedEvents.length) {
                  const reason = `No se encontraron eventos validos para ${trackingNumber} (shipmentId=${shipment.id}) segun reglas de sucursal ${subsidiaryId}`;
                  this.logger.error(reason);
                  shipmentsWithError.push({ trackingNumber, reason, shipmentId: shipment.id });
                  continue;
                }

                // Validar exceptionCode
                if (exceptionCode && !rules.allowedExceptionCodes.includes(exceptionCode) && mappedStatus !== ShipmentStatusType.ENTREGADO) {
                  console.log("Tiene que validar el 03")
                  if (exceptionCode === '03' && rules.allowException03) {
                    this.logger.log(`Permitiendo exceptionCode 03 para ${trackingNumber} debido a allowException03=true`);
                  } else {
                    unusualCodes.push({
                      trackingNumber,
                      derivedCode: latestStatusDetail?.derivedCode || latestEvent.derivedStatusCode || 'N/A',
                      exceptionCode,
                      eventDate: latestEvent.date || 'N/A',
                      statusByLocale: latestStatusDetail?.statusByLocale || 'N/A',
                      shipmentId: shipment.id,
                    });
                    this.logger.warn(`exceptionCode=${exceptionCode} no permitido para sucursal ${subsidiaryId} en ${trackingNumber} (shipmentId=${shipment.id})`);
                    shipmentsWithError.push({ trackingNumber, reason: `exceptionCode=${exceptionCode} no permitido`, shipmentId: shipment.id });
                    continue;
                  }
                }

                // Validar estatus permitido
                if (!rules.allowedStatuses.includes(mappedStatus) && mappedStatus !== ShipmentStatusType.ENTREGADO) {
                  unusualCodes.push({
                    trackingNumber,
                    derivedCode: latestStatusDetail?.derivedCode || latestEvent.derivedStatusCode || 'N/A',
                    exceptionCode,
                    eventDate: latestEvent.date || 'N/A',
                    statusByLocale: latestStatusDetail?.statusByLocale || 'N/A',
                    shipmentId: shipment.id,
                  });
                  this.logger.warn(`Estatus ${mappedStatus} no permitido para sucursal ${subsidiaryId} en ${trackingNumber} (shipmentId=${shipment.id})`);
                  shipmentsWithError.push({ trackingNumber, reason: `Estatus ${mappedStatus} no permitido`, shipmentId: shipment.id });
                  continue;
                }

                // Validar evento
                const event = allowedEvents.find(
                  (e) =>
                    (mappedStatus === ShipmentStatusType.ENTREGADO && (e.eventType === 'DL' || e.derivedStatusCode === 'DL')) ||
                    (mappedStatus === ShipmentStatusType.NO_ENTREGADO && ['DE', 'DU', 'RF', 'TD', 'TA'].includes(e.eventType)) ||
                    (mappedStatus === ShipmentStatusType.PENDIENTE && ['HL'].includes(e.eventType)) ||
                    (mappedStatus === ShipmentStatusType.EN_RUTA && ['OC', 'IT', 'AR', 'AF', 'CP', 'CC'].includes(e.eventType)) ||
                    (mappedStatus === ShipmentStatusType.RECOLECCION && ['PU'].includes(e.eventType)) ||
                    (e.exceptionCode === '03' && rules.allowException03) ||
                    e.exceptionCode === '07'
                );
                if (!event) {
                  const reason = `No se encontro evento valido para el estatus ${latestStatusDetail?.derivedCode || latestEvent.derivedStatusCode} en ${trackingNumber} (shipmentId=${shipment.id}, subsidiaryId=${subsidiaryId})`;
                  this.logger.warn(reason);
                  shipmentsWithError.push({ trackingNumber, reason, shipmentId: shipment.id });
                  continue;
                }

                const fromStatus = shipment.status;
                let toStatus = mappedStatus;

                // Explicit handling for 03
                if (exceptionCode === '03' && rules.allowException03) {
                  this.logger.log(`Procesando exceptionCode 03 para ${trackingNumber}, asignando estatus NO_ENTREGADO`);
                  toStatus = ShipmentStatusType.NO_ENTREGADO;
                }

                // Relajar validacion de frescura para ENTREGADO y 03
                const latestStatusHistory = shipment.statusHistory?.reduce((latest, current) =>
                  new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest, shipment.statusHistory[0]);
                if (latestStatusHistory && new Date(eventDate) <= new Date(latestStatusHistory.timestamp) && toStatus !== ShipmentStatusType.ENTREGADO && exceptionCode !== '03') {
                  this.logger.log(`Evento antiguo para ${trackingNumber} (shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId}) (${eventDate.toISOString()} <= ${latestStatusHistory.timestamp.toISOString()}), no se procesa`);
                  continue;
                }

                // Log para depuracion
                this.logger.log(`Depuracion: trackingNumber=${trackingNumber}, shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId}, fromStatus=${fromStatus}, toStatus=${toStatus}, eventDate=${eventDate.toISOString()}, exceptionCode=${exceptionCode}, receivedByName=${shipment.receivedByName}, statusHistory=${JSON.stringify(shipment.statusHistory?.map(s => ({ status: s.status, exceptionCode: s.exceptionCode, timestamp: s.timestamp })))}`);

                // Actualizar incluso si el estado no cambia
                if (fromStatus === toStatus && toStatus !== ShipmentStatusType.ENTREGADO) {
                  if (shouldPersist && latestTrackResult.deliveryDetails?.receivedByName && latestTrackResult.deliveryDetails.receivedByName !== shipment.receivedByName) {
                    try {
                      await this.shipmentRepository.manager.transaction(async (em) => {
                        await em.update(Shipment, { id: shipment.id }, { receivedByName: latestTrackResult.deliveryDetails.receivedByName });
                        this.logger.log(`Actualizado receivedByName para ${trackingNumber} (shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId}) sin cambio de estado`);
                      });
                    } catch (err) {
                      const reason = `Error al actualizar receivedByName para ${trackingNumber} (shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId}): ${err.message}`;
                      this.logger.error(reason);
                      shipmentsWithError.push({ trackingNumber, reason, shipmentId: shipment.id });
                      continue;
                    }
                  }
                  updatedShipments.push({
                    trackingNumber,
                    fromStatus,
                    toStatus,
                    eventDate: eventDate.toISOString(),
                    shipmentId: shipment.id,
                    consolidatedId: shipment.consolidatedId,
                    subsidiaryId,
                  });
                  this.logger.log(`Estado para ${trackingNumber} (shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId}) no cambio: sigue siendo ${fromStatus}`);
                  continue;
                }

                // Registrar actualizacion
                updatedShipments.push({
                  trackingNumber,
                  fromStatus,
                  toStatus,
                  eventDate: eventDate.toISOString(),
                  shipmentId: shipment.id,
                  consolidatedId: shipment.consolidatedId,
                  subsidiaryId,
                });

                if (shouldPersist) {
                  const newShipmentStatus = new ShipmentStatus();
                  newShipmentStatus.status = toStatus;
                  newShipmentStatus.timestamp = eventDate;
                  newShipmentStatus.notes = latestStatusDetail?.ancillaryDetails?.[0]
                    ? `${latestStatusDetail.ancillaryDetails[0].reason} - ${latestStatusDetail.ancillaryDetails[0].actionDescription}`
                    : `${event.eventType} - ${event.eventDescription}`;
                  newShipmentStatus.exceptionCode = exceptionCode;
                  newShipmentStatus.shipment = shipment;

                  shipment.status = toStatus;
                  shipment.statusHistory = shipment.statusHistory || [];
                  shipment.statusHistory.push(newShipmentStatus);
                  shipment.receivedByName = latestTrackResult.deliveryDetails?.receivedByName || shipment.receivedByName;

                  if (shipment.payment) {
                    shipment.payment.status = toStatus === ShipmentStatusType.ENTREGADO ? PaymentStatus.PAID : PaymentStatus.PENDING;
                    this.logger.log(`Actualizado payment.status=${shipment.payment.status} para ${trackingNumber} (shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId})`);
                  }

                  // Validar ingresos
                  let incomeValidationResult: IncomeValidationResult = { isValid: true, timestamp: eventDate };

                  if (([ShipmentStatusType.ENTREGADO, ShipmentStatusType.NO_ENTREGADO].includes(toStatus) || (exceptionCode === '07' && rules.allowIncomeFor07)) && 
                      shipment.id === representativeShipment.id && 
                      !rules.noIncomeExceptionCodes.includes(exceptionCode)) {
                    const exceptionCodes = shipment.statusHistory.map(h => h.exceptionCode).filter(Boolean).concat(exceptionCode ? [exceptionCode] : []);
                    this.logger.debug(`Exception codes for income validation of ${trackingNumber} (shipmentId=${shipment.id}): ${exceptionCodes.join(', ')}`);
                    try {
                      incomeValidationResult = await this.applyIncomeValidationRules(
                        shipment,
                        toStatus,
                        exceptionCodes,
                        shipment.statusHistory || [],
                        trackingNumber,
                        eventDate,
                      );
                      this.logger.log(`Validacion de ingreso para ${trackingNumber} (shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId}): isValid=${incomeValidationResult.isValid}, reason=${incomeValidationResult.reason ?? 'N/A'}`);
                    } catch (err) {
                      this.logger.error(`Error en applyIncomeValidationRules para ${trackingNumber} (shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId}): ${err.message}`);
                      incomeValidationResult = { isValid: false, timestamp: eventDate, reason: err.message };
                    }
                  } else if (exceptionCode === '03') {
                    this.logger.log(`Ingresos no generados para ${trackingNumber} (shipmentId=${shipment.id}) debido a exceptionCode 03`);
                    incomeValidationResult = { isValid: false, timestamp: eventDate, reason: 'Exception code 03 blocks income generation' };
                  }

                  // Actualizar shipment
                  try {
                    await this.shipmentRepository.manager.transaction(async (em) => {
                      await em.save(ShipmentStatus, newShipmentStatus);
                      this.logger.log(`ShipmentStatus guardado para ${trackingNumber} (shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId}) con status=${toStatus}`);

                      await em
                        .createQueryBuilder()
                        .update(Shipment)
                        .set({
                          status: shipment.status,
                          receivedByName: shipment.receivedByName,
                          payment: shipment.payment,
                        })
                        .where('id = :id', { id: shipment.id })
                        .execute();

                      this.logger.log(`Shipment actualizado para ${trackingNumber} (shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId}) con status=${toStatus}`);

                      // Generar ingreso para ENTREGADO o NO_ENTREGADO con 07
                      if ((toStatus === ShipmentStatusType.ENTREGADO || (toStatus === ShipmentStatusType.NO_ENTREGADO && exceptionCode === '07')) && 
                          incomeValidationResult.isValid && 
                          !processedIncomes.has(trackingNumber) && 
                          shipment.id === representativeShipment.id) {
                        await this.generateIncomes(shipment, incomeValidationResult.timestamp, newShipmentStatus.exceptionCode, em);
                        processedIncomes.add(trackingNumber);
                        this.logger.log(`Income generado para ${trackingNumber} (shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId}) con status=${toStatus}, exceptionCode=${exceptionCode}`);
                      } else if ((toStatus === ShipmentStatusType.ENTREGADO || toStatus === ShipmentStatusType.NO_ENTREGADO) && 
                                !incomeValidationResult.isValid && 
                                shipment.id === representativeShipment.id) {
                        shipmentsWithInvalidIncome.push({ trackingNumber, eventDate: eventDate.toISOString(), shipmentId: shipment.id });
                        this.logger.warn(`No se genero ingreso para ${trackingNumber} (shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId}) debido a validacion fallida: ${incomeValidationResult.reason ?? 'N/A'}`);
                      }
                    });
                  } catch (err) {
                    const reason = `Error al guardar shipment ${trackingNumber} (shipmentId=${shipment.id}, consolidatedId=${shipment.consolidatedId}, subsidiaryId=${subsidiaryId}): ${err.message}`;
                    this.logger.error(reason);
                    shipmentsWithError.push({ trackingNumber, reason, shipmentId: shipment.id });
                  }
                }
              }
            }),
          );
        }

        this.logger.log(`Proceso finalizado: ${updatedShipments.length} envios actualizados, ${shipmentsWithError.length} errores, ${unusualCodes.length} codigos inusuales, ${shipmentsWithOD.length} excepciones OD, ${shipmentsWithInvalidIncome.length} fallos de validacion de ingresos, ${forPickUpShipments.length} envios ForPickUp`);

        return {
          updatedShipments,
          shipmentsWithError,
          unusualCodes,
          shipmentsWithOD,
          shipmentsWithInvalidIncome,
          forPickUpShipments,
        };
      } catch (err) {
        const reason = `Error general en checkStatusOnFedex: ${err.message}`;
        this.logger.error(reason);
        throw new BadRequestException(reason);
      }
    }

    async checkStatusOnFedexChargeShipment(trackingNumbers: string[]) {
        const chargeShipmentsWithError = [];
        const updatedChargeShipments = [];

        this.logger.log(`📦 Iniciando verificación de estado para ${trackingNumbers.length} charge shipments`);

        for (const trackingNumber of trackingNumbers) {
          try {
            this.logger.log(`🔍 Procesando tracking number: ${trackingNumber}`);

            // 1. Obtener información de seguimiento de FedEx
            this.logger.log(`🔄 Consultando estado en FedEx para: ${trackingNumber}`);
            const shipmentInfo: FedExTrackingResponseDto = await this.trackPackageWithRetry(trackingNumber);

            if (!shipmentInfo?.output?.completeTrackResults?.length || !shipmentInfo.output.completeTrackResults[0]?.trackResults?.length) {
              const reason = `No se encontró información válida del envío ${trackingNumber}: completeTrackResults vacíos o inválidos`;
              this.logger.error(`❌ ${reason}`);
              this.logBuffer.push(reason);
              chargeShipmentsWithError.push({ trackingNumber, reason });
              continue; // Cambiado de 'return' a 'continue' para procesar todos los envíos
            }

            // 2. Procesar los resultados de seguimiento
            const trackResults = shipmentInfo.output.completeTrackResults[0].trackResults;
            this.logger.debug(`📊 Se encontraron ${trackResults.length} track results para ${trackingNumber}`);

            // Encontrar el último estado (priorizando 'DL' o el más reciente)
            const latestTrackResult = trackResults.find((r) => r.latestStatusDetail?.derivedCode === 'DL') || 
              trackResults.sort((a, b) => {
                const dateA = a.scanEvents[0]?.date ? new Date(a.scanEvents[0].date).getTime() : 0;
                const dateB = b.scanEvents[0]?.date ? new Date(b.scanEvents[0].date).getTime() : 0;
                return dateB - dateA;
              })[0];

            if (!latestTrackResult?.latestStatusDetail) {
              const reason = `No se pudo determinar el último estado para ${trackingNumber}`;
              this.logger.error(`❌ ${reason}`);
              this.logBuffer.push(reason);
              chargeShipmentsWithError.push({ trackingNumber, reason });
              continue;
            }

            const latestStatusDetail = latestTrackResult.latestStatusDetail;
            this.logger.log(`📣 Último estatus de FedEx para ${trackingNumber}: ${latestStatusDetail.derivedCode} - ${latestStatusDetail.statusByLocale} - ${latestStatusDetail.code}`);

            // 3. Mapear estados y códigos
            const mappedStatus = mapFedexStatusToLocalStatus(latestStatusDetail.code, latestStatusDetail.ancillaryDetails?.[0]?.reason);
            const exceptionCode = latestStatusDetail.ancillaryDetails?.[0]?.reason || latestTrackResult.scanEvents[0]?.exceptionCode || '';
            
            console.log("🚀 ~ ShipmentsService ~ checkStatusOnFedexBySubsidiaryRulesTesting ~ exceptionCode:", exceptionCode)
            this.logger.debug(`🔄 Estado mapeado: ${mappedStatus}, Código de excepción: ${exceptionCode || 'N/A'}`);

            // 4. Buscar y actualizar el charge shipment
            this.logger.log(`🔎 Buscando charge shipment para ${trackingNumber}`);
            const chargeShipment = await this.chargeShipmentRepository.findOneBy({ trackingNumber });

            if (!chargeShipment) {
              const reason = `No se encontró el charge shipment con tracking number ${trackingNumber}`;
              this.logger.error(`❌ ${reason}`);
              this.logBuffer.push(reason);
              chargeShipmentsWithError.push({ trackingNumber, reason });
              continue;
            }

            // 5. Actualizar y guardar
            chargeShipment.status = mappedStatus;
            chargeShipment.exceptionCode = exceptionCode;

            this.logger.log(`💾 Guardando cambios para ${trackingNumber}`);
            const updatedChargeShipment = await this.chargeShipmentRepository.save(chargeShipment);
            updatedChargeShipments.push(updatedChargeShipment);
            this.logger.log(`✅ Actualizado exitosamente: ${trackingNumber}`);

          } catch (error) {
            const reason = `Error procesando ${trackingNumber}: ${error.message}`;
            this.logger.error(`❌ ${reason}`);
            this.logBuffer.push(reason);
            chargeShipmentsWithError.push({ trackingNumber, reason });
          }
        }

        // Resultado final
        this.logger.log(`📊 Resultado final:
          - Actualizados: ${updatedChargeShipments.length}
          - Con errores: ${chargeShipmentsWithError.length}`);

        return {
          chargeShipmentsWithError,
          updatedChargeShipments,
        };
    }
        
    /**** Remover ocurre y guardarlos en base de datos */
    async getAndMoveForPickUp(itemsForPickUp: ForPickUpDto[]) {
      const savedForPickup = [];

      for (const forPickUp of itemsForPickUp) {
        this.logger.log(`🔎 Procesando tracking: ${forPickUp.trackingNumber}`);

        // Validar si ya existe en forPickUp
        const existingPickUp = await this.forPickUpRepository.findOneBy({
          trackingNumber: forPickUp.trackingNumber,
        });

        if (existingPickUp) {
          this.logger.warn(`⚠️  Ya existe en ForPickUp: ${forPickUp.trackingNumber}, se omite.`);
          continue; // Evita duplicados
        }

        // Buscar el shipment
        const shipmentToRemove = await this.shipmentRepository.findOneBy({
          trackingNumber: forPickUp.trackingNumber,
        });

        if (!shipmentToRemove) {
          this.logger.warn(`🚫 No existe shipment con el tracking: ${forPickUp.trackingNumber}`);
          continue;
        }

        this.logger.log(`📦 Eliminando shipment con ID: ${shipmentToRemove.id}`);

        // Eliminar shipment
        //await this.shipmentRepository.delete(shipmentToRemove.id);

        // Buscar income
        const shipmentIncome = await this.incomeRepository.findOneBy({
          shipment: { id: shipmentToRemove.id },
        });

        if (!shipmentIncome) {
          this.logger.warn(`❌ No existe income con shipment ID: ${shipmentToRemove.id}`);
        } else {
          this.logger.log(`💰 Eliminando income con ID: ${shipmentIncome.id}`);
          //await this.incomeRepository.delete(shipmentIncome.id);
        }

        // Crear nuevo ForPickUp
        const newForPickUp = this.forPickUpRepository.create({
          trackingNumber: shipmentToRemove.trackingNumber,
          date: shipmentToRemove.createdAt,
          subsidiary: shipmentToRemove.subsidiary,
        });

        const saved = await this.forPickUpRepository.save(newForPickUp);

        this.logger.log(`✅ Agregado a ForPickUp: ${saved.trackingNumber}`);

        savedForPickup.push(saved);
      }

      return savedForPickup;
    }

    /**** Obtener los paquetes que no tienen 67 */
    async checkStatus67OnShipments(subsidiaryId: string) {
      const today = new Date();

      const shipments = await this.shipmentRepository.find({
        where: {
          subsidiary: { id: subsidiaryId },
          status: ShipmentStatusType.EN_RUTA,
        },
        relations: ['statusHistory', 'payment'],
      });

      const results = [];

      for (const shipment of shipments) {
        try {
          // VALIDACIÓN CRÍTICA: Verificar que statusHistory existe y tiene elementos
          if (!shipment.statusHistory || shipment.statusHistory.length === 0) {
            results.push({
              trackingNumber: shipment.trackingNumber,
              lastStatus: null,
              daysWithoutEnRuta: null,
              comment: 'Sin historial de estados',
            });
            continue;
          }

          // Ordenar el historial por fecha
          const history = shipment.statusHistory.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );

          // VALIDACIÓN: Último estado seguro
          const lastStatus = history[history.length - 1];
          if (!lastStatus) {
            results.push({
              trackingNumber: shipment.trackingNumber,
              lastStatus: null,
              daysWithoutEnRuta: null,
              comment: 'No se pudo obtener último estado',
            });
            continue;
          }

          // Buscar primer estado EN_RUTA
          const firstOnTheWay = history.find(h => h.status === ShipmentStatusType.EN_RUTA);

          if (!firstOnTheWay) {
            results.push({
              trackingNumber: shipment.trackingNumber,
              lastStatus: lastStatus.status,
              daysWithoutEnRuta: null,
              comment: 'Nunca tuvo EN_RUTA',
            });
            continue;
          }

          // VALIDACIÓN: timestamp del primer EN_RUTA
          if (!firstOnTheWay.timestamp) {
            results.push({
              trackingNumber: shipment.trackingNumber,
              lastStatus: lastStatus.status,
              daysWithoutEnRuta: null,
              comment: 'Fecha de primer EN_RUTA inválida',
            });
            continue;
          }

          const fromDate = new Date(firstOnTheWay.timestamp);
          
          // VALIDACIÓN: Fecha válida
          if (isNaN(fromDate.getTime())) {
            results.push({
              trackingNumber: shipment.trackingNumber,
              lastStatus: lastStatus.status,
              daysWithoutEnRuta: null,
              comment: 'Fecha de primer EN_RUTA inválida',
            });
            continue;
          }

          const totalDays = differenceInDays(today, fromDate);

          // Si totalDays es negativo (fecha futura), manejarlo
          if (totalDays < 0) {
            results.push({
              trackingNumber: shipment.trackingNumber,
              lastStatus: lastStatus.status,
              daysWithoutEnRuta: 0,
              comment: 'Primer EN_RUTA en fecha futura',
              firstEnRutaDate: fromDate,
              totalStatusUpdates: history.length,
            });
            continue;
          }

          let daysWithoutEnRuta = 0;

          for (let i = 0; i <= totalDays; i++) {
            const currentDay = addDays(fromDate, i);

            const hasEnRutaThatDay = history.some(
              (h) =>
                h.status === ShipmentStatusType.EN_RUTA &&
                h.timestamp && // Validar que timestamp existe
                isSameDay(new Date(h.timestamp), currentDay)
            );

            if (!hasEnRutaThatDay) {
              daysWithoutEnRuta++;
            }
          }

          results.push({
            trackingNumber: shipment.trackingNumber,
            lastStatus: lastStatus.status,
            daysWithoutEnRuta,
            firstEnRutaDate: fromDate,
            totalStatusUpdates: history.length,
          });

        } catch (error) {
          // Manejo de errores para cada shipment individual
          console.error(`Error procesando shipment ${shipment.trackingNumber}:`, error);
          results.push({
            trackingNumber: shipment.trackingNumber,
            lastStatus: null,
            daysWithoutEnRuta: null,
            comment: `Error: ${error.message}`,
          });
        }
      }

      return results;
    }

    async getShipmentsWithStatus03(subdiaryId: string) {
      const todayUTC = new Date();
      todayUTC.setUTCHours(0, 0, 0, 0);

      const tomorrowUTC = new Date(todayUTC);
      tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);

      const subsidiary = await this.subsidiaryRepository.findOneBy({ id: subdiaryId });

      const queryBuilder = this.shipmentRepository
        .createQueryBuilder("shipment")
        .innerJoin("shipment.statusHistory", "statusHistory")
        .leftJoin("shipment.packageDispatch", "packageDispatch")
        .where("shipment.subsidiaryId = :subdiaryId", { subdiaryId })
        /**
         * AJUSTE CLAVE:
         * Buscamos específicamente el nuevo estatus definido en tu mapeador.
         * También incluimos un filtro de seguridad por si acaso quedó como NO_ENTREGADO.
         */
        .andWhere("shipment.status IN (:...targetStatus)", { 
          targetStatus: [
            ShipmentStatusType.DIRECCION_INCORRECTA, 
            ShipmentStatusType.NO_ENTREGADO 
          ] 
        })
        .andWhere("statusHistory.exceptionCode = :exceptionCode", { exceptionCode: "03" })
        .andWhere("statusHistory.timestamp >= :todayUTC", { todayUTC })
        .andWhere("statusHistory.timestamp < :tomorrowUTC", { tomorrowUTC });

      const rawResults = await queryBuilder
        .select([
          "shipment.trackingNumber AS trackingNumber",
          "shipment.recipientName AS recipientName",
          "shipment.recipientAddress AS recipientAddress",
          "shipment.recipientZip AS recipientZip",
          "shipment.recipientPhone AS recipientPhone",
          "statusHistory.timestamp AS timestamp",
        ])
        .addSelect(subQuery => {
          return subQuery
            .select("d.name")
            .from("driver", "d")
            .innerJoin("package_dispatch_drivers", "pdd", "pdd.driverId = d.id")
            .where("pdd.dispatchId = packageDispatch.id")
            .orderBy("d.id", "ASC")
            .limit(1);
        }, "doItByUser")
        .orderBy("statusHistory.timestamp", "DESC")
        .getRawMany<ShipmentStatusForReportDto>();

      // Deduplicación por tracking para el correo
      const uniqueShipments = Array.from(
        new Map(rawResults.map(item => [item.trackingNumber, item])).values()
      );

      if (uniqueShipments.length > 0) {
        await this.mailService.sendHighPriorityShipmentWithStatus03(
          subsidiary,
          uniqueShipments,
        );
        console.log(`✅ Reporte enviado: ${uniqueShipments.length} guías con Dirección Incorrecta.`);
      } else {
        console.log("ℹ️ No se detectaron guías con código 03 para los estatus seleccionados.");
      }

      return uniqueShipments;
    }

    async getCompleteDataForPackage(trackingNumber: string) {
      return await this.fedexService.completePackageInfo(trackingNumber);
    }

    async getShipmentDetailsByTrackingNumber(trackingNumber: string): Promise<SearchShipmentDto | null> {
      // Buscar todos los shipments con ese trackingNumber y ordenar por fecha más reciente
      const shipments = await this.shipmentRepository.find({
          where: { trackingNumber },
          relations: [
              'packageDispatch',
              'packageDispatch.drivers',
              'unloading',
              'unloading.subsidiary',
              'payment',
              'subsidiary'
          ],
          order: { commitDateTime: 'DESC' }
      });

      // Buscar también los chargeShipments
      const chargeShipments = await this.chargeShipmentRepository
          .createQueryBuilder('chargeShipment')
          .leftJoinAndSelect('chargeShipment.payment', 'payment')
          .leftJoinAndSelect('chargeShipment.packageDispatch', 'packageDispatch')
          .leftJoinAndSelect('packageDispatch.drivers', 'drivers')
          .leftJoinAndSelect('chargeShipment.unloading', 'unloading')
          .leftJoinAndSelect('unloading.subsidiary', 'unloadingSubsidiary')
          .leftJoinAndSelect('chargeShipment.charge', 'charge')
          .leftJoinAndSelect('chargeShipment.subsidiary', 'subsidiary')
          .where('chargeShipment.trackingNumber = :trackingNumber', { trackingNumber })
          .orderBy('chargeShipment.commitDateTime', 'DESC')
          .getMany();

      console.log(`💰 ChargeShipments encontrados: ${chargeShipments.length}`);
      chargeShipments.forEach((chargeShipment, index) => {
          console.log(`   ChargeShipment ${index + 1}:`, {
              id: chargeShipment.id,
              hasPayment: !!chargeShipment.payment,
              paymentId: chargeShipment.payment?.id,
              paymentAmount: chargeShipment.payment?.amount
          });
      });

      console.log("🚀 ~ ShipmentsService ~ getShipmentDetailsByTrackingNumber ~ chargeShipments:", chargeShipments)

      // Combinar y tomar el más reciente
      const allShipments = [...shipments, ...chargeShipments];
      if (allShipments.length === 0) {
          console.log(`❌ No se encontró el envío con trackingNumber: ${trackingNumber}`);
          return null;
      }

      // Selecciona el que tenga la fecha más reciente
      const targetShipment = allShipments.sort((a, b) => 
          new Date(b.commitDateTime).getTime() - new Date(a.commitDateTime).getTime()
      )[0];

      // Extraer ruta y conductor principal
      const packageDispatch = targetShipment.packageDispatch;
      const firstDriver = packageDispatch?.drivers?.[0] || null;
      const unloading = targetShipment.unloading;

      // Determinar si es un chargeShipment
      const isChargeShipment = 'charge' in targetShipment;
      
      // Crear objeto base de respuesta
      const response: SearchShipmentDto = {
          trackingNumber: targetShipment.trackingNumber,
          commitDateTime: targetShipment.commitDateTime?.toISOString?.() || '',
          recipient: {
              name: targetShipment.recipientName ?? 'Sin Destinatario',
              address: targetShipment.recipientAddress ?? 'Sin Dirección',
              phoneNumber: targetShipment.recipientPhone ?? 'Sin Teléfono',
              zipCode: targetShipment.recipientZip ?? 'Sin CP'
          },
          priority: targetShipment.priority,
          payment: {
              type: targetShipment.payment?.type,
              amount: targetShipment.payment?.amount ?? 0
          },
          status: packageDispatch ? 'En ruta' : 'En bodega',
          subsidiary: targetShipment.subsidiary?.name || 'Desconocida',
          unloading: {
              id: unloading?.id || '',
              trackingNumber: unloading?.trackingNumber || ''
          },
          isCharge: isChargeShipment,
          route: packageDispatch ? {
              id: packageDispatch.id,
              trackingNumber: packageDispatch.trackingNumber,
              driver: {
                  name: firstDriver?.name || 'Sin conductor'
              }
          } : undefined
      };

      // Agregar consolidated o charge según el tipo
      /*if (isChargeShipment) {
          // Es un chargeShipment - agregar charge
          response.charge = targetShipment.charge ? {
              id: targetShipment.charge.id,
              type: 'charge'
          } : undefined;
      } else {
          // Es un shipment normal - agregar consolidated
          response.consolidated = targetShipment.consolidated ? {
              id: targetShipment.consolidated.id,
              type: targetShipment.consolidated.type
          } : undefined;
      }*/

      // DEBUG
      console.log('===== DETALLE DE SHIPMENT =====');
      console.log({
          trackingNumber: response.trackingNumber,
          commitDateTime: response.commitDateTime,
          status: response.status,
          subsidiary: response.subsidiary,
          unloading: response.unloading?.id || 'N/A',
          route: response.route?.trackingNumber || 'Sin ruta',
          driver: response.route?.driver?.name || 'N/A',
          priority: response.priority,
          recipient: response.recipient,
          payment: response.payment,
          //consolidated: response.consolidated?.id || 'N/A',
          charge: response.charge?.id || 'N/A'
      });

      return response;
    }

    async getShipmentHistoryFromFedex(id: string, isChargeShipment: boolean = false) {
      let shipment: Shipment | ChargeShipment;

      if(isChargeShipment) {
        shipment = await this.chargeShipmentRepository.findOne({ where: { id } });
      } else {
        shipment = await this.shipmentRepository.findOne({ where: { id } });
      }

      if (!shipment || !shipment.trackingNumber) {
        throw new Error("No se encontró el envío o no tiene número de guía");
      }

      const fedexData = await this.fedexService.trackPackage(shipment.trackingNumber);

      // Validar que venga la estructura esperada
      if (
        !fedexData?.output.completeTrackResults ||
        !Array.isArray(fedexData.output.completeTrackResults)
      ) {
        throw new Error("Respuesta inválida de FedEx");
      }

      // Mapeamos todos los trackResults (pueden venir varios)
      const allResults = fedexData.output.completeTrackResults.flatMap((result: any) =>
        (result.trackResults || []).map((track: any) => {
          const lastStatus = track.latestStatusDetail
            ? {
                code: track.latestStatusDetail.code,
                exceptionCode: track.latestStatusDetail.ancillaryDetails,
                description: track.latestStatusDetail.description,
                city: track.latestStatusDetail.scanLocation?.city || null,
                state: track.latestStatusDetail.scanLocation?.stateOrProvinceCode || null,
                country: track.latestStatusDetail.scanLocation?.countryName || null,
                date: track.dateAndTimes?.find((d: any) => d.type === "ACTUAL_DELIVERY")?.dateTime || null,
              }
            : null;

          // Escanear historial completo
          const history =
            track.scanEvents?.map((event: any) => ({
              date: event.date,
              eventType: event.eventType,
              exceptionCode: event.exceptionCode,
              derivedStatusCode: event.derivedStatusCode,
              description: event.eventDescription,
              city: event.scanLocation?.city || null,
              state: event.scanLocation?.stateOrProvinceCode || null,
              country: event.scanLocation?.countryName || null,
              postalCode: event.scanLocation?.postalCode || null,
              derivedStatus: event.derivedStatus || null,
            })) || [];

          return { lastStatus, history };
        })
      );

      // Combinar todos los historiales en uno solo (si hay varios trackResults)
      const mergedHistory = allResults.flatMap(r => r.history);
      const lastStatus = allResults.find(r => r.lastStatus)?.lastStatus || null;

      return {
        trackingNumber: shipment.trackingNumber,
        lastStatus,
        history: mergedHistory,
      };
    }

    /*** Validate Status Code 67 by Subsidiary **************************/
    async validateCode67BySubsidiary(subsidiaryId: string) {
      // 1. Definimos estrictamente los estados operativos de interés
      const targetStatuses = [
        ShipmentStatusType.PENDIENTE, 
        ShipmentStatusType.EN_BODEGA
      ];

      // 2. Buscamos en ambos repositorios filtrando por subsidiaria y estados
      const [shipments, chargeShipments] = await Promise.all([
        this.shipmentRepository.find({
          where: { 
            subsidiary: { id: subsidiaryId },
            status: In(targetStatuses) 
          },
          relations: ['statusHistory'],
        }),
        this.chargeShipmentRepository.find({
          where: { 
            subsidiary: { id: subsidiaryId },
            status: In(targetStatuses) 
          },
          relations: ['statusHistory'],
        }),
      ]);

      const allShipments = [...shipments, ...chargeShipments];
      const shipmentsWithout67 = [];

      // 3. Procesamos la lista unificada
      for (const shipment of allShipments) {
        try {
          // Si no tiene historial, por lógica no tiene el código 67
          if (!shipment.statusHistory || shipment.statusHistory.length === 0) {
            shipmentsWithout67.push(this.mapMissing67Data(shipment, 'Sin historial de estados'));
            continue;
          }

          // Verificamos la existencia del código 67
          const hasExceptionCode67 = shipment.statusHistory.some(
            status => status.exceptionCode === '67'
          );

          if (!hasExceptionCode67) {
            const sortedHistory = shipment.statusHistory.sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );

            shipmentsWithout67.push(
              this.mapMissing67Data(shipment, 'No tiene exceptionCode 67', sortedHistory)
            );
          }
        } catch (error) {
          shipmentsWithout67.push(this.mapMissing67Data(shipment, `Error: ${error.message}`));
        }
      }

      return {
        summary: {
          totalInWarehouseOrPending: allShipments.length,
          withoutCode67: shipmentsWithout67.length,
          withCode67: allShipments.length - shipmentsWithout67.length,
        },
        details: shipmentsWithout67,
      };
    }

    // Función auxiliar para no repetir código de mapeo
    private mapMissing67Data(shipment: any, comment: string, sortedHistory: any[] = []) {
      const exceptionCodes = sortedHistory
        .map(h => h.exceptionCode)
        .filter(code => code != null);

      return {
        trackingNumber: shipment.trackingNumber,
        currentStatus: shipment.status,
        statusHistoryCount: sortedHistory.length,
        exceptionCodes: [...new Set(exceptionCodes)],
        firstStatusDate: sortedHistory[0]?.timestamp || null,
        lastStatusDate: sortedHistory[sortedHistory.length - 1]?.timestamp || null,
        comment: comment,
        // Detectamos si es un ChargeShipment o Shipment normal para el reporte
        type: shipment.constructor.name 
      };
    }

    async exportNo67Shipments(shipments: any[], res: any) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Shipments Sin Código 67");
      const currentDate = new Date();

      // === ENCABEZADO GENERAL ===
      const titleRow = sheet.addRow(["🚨 REPORTE: SHIPMENTS SIN CÓDIGO 67"]);
      sheet.mergeCells(`A${titleRow.number}:I${titleRow.number}`);
      titleRow.font = { size: 16, bold: true, color: { argb: "FFFFFF" } };
      titleRow.alignment = { vertical: "middle", horizontal: "center" };

      for (let col = 1; col <= 9; col++) {
        sheet.getCell(titleRow.number, col).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF6B6B" },
        };
      }

      sheet.addRow([]);
      sheet.addRow([`Fecha de generación: ${currentDate.toLocaleDateString('es-ES')}`]);
      sheet.addRow([`Hora de generación: ${currentDate.toLocaleTimeString('es-ES')}`]);
      sheet.addRow([`Total de shipments sin código 67: ${shipments.length}`]);
      sheet.addRow([]);

      // === ENCABEZADO DE COLUMNAS ===
      const headerRow = sheet.addRow([
        "No.",
        "Número de Tracking",
        "Estado Actual",
        "Cantidad de Estados",
        "Códigos de Excepción",
        "Fecha Primer Estado",
        "Fecha Último Estado",
        "Días Sin Código 67",
        "Observaciones"
      ]);

      headerRow.font = { bold: true, color: { argb: "FFFFFF" } };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };

      for (let col = 1; col <= 9; col++) {
        sheet.getCell(headerRow.number, col).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "8C5E4E" },
        };
        sheet.getCell(headerRow.number, col).border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      }

      // === DATOS ===
      shipments.forEach((shipment, index) => {
        const diasSin67 = this.calculateDaysWithout67(shipment);
        const esCritico = diasSin67 > 3;
        
        const row = sheet.addRow([
          index + 1,
          shipment.trackingNumber || "N/A",
          this.formatStatus(shipment.currentStatus) || "N/A",
          shipment.statusHistoryCount || 0,
          shipment.exceptionCodes?.join(", ") || "Ninguno",
          this.formatExcelDate(shipment.firstStatusDate),
          this.formatExcelDate(shipment.lastStatusDate),
          diasSin67 > 0 ? diasSin67.toString() : "N/A",
          shipment.comment || "Sin observaciones"
        ]);

        // Filas alternadas en gris (solo si no es crítico)
        if (index % 2 === 0 && !esCritico) {
          for (let col = 1; col <= 9; col++) {
            sheet.getCell(row.number, col).fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "F2F2F2" },
            };
          }
        }

        // Bordes y alineación
        row.eachCell((cell, colNumber) => {
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
          
          // Centrar columnas específicas
          if ([1, 3, 4, 7, 8].includes(colNumber)) {
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
          } else {
            cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
          }

          // OPCIÓN 3: Gradientes de color según severidad
          if (esCritico) {
            const esMuyCritico = diasSin67 > 7;
            const esCriticoModerado = diasSin67 > 3 && diasSin67 <= 7;
            
            if (esMuyCritico) {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFE6E6" } // Rojo más intenso para muy crítico
              };
              cell.font = { 
                color: { argb: "990000" },
                bold: true 
              };
            } else if (esCriticoModerado) {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFF0F0" } // Rojo más suave para crítico moderado
              };
              cell.font = { 
                color: { argb: "CC0000" },
                bold: true 
              };
            }
          } else {
            // Colores condicionales para estado actual
            if (colNumber === 3) {
              const status = cell.value?.toString().toLowerCase();
              if (status === "en ruta") {
                cell.fill = {
                  type: "pattern",
                  pattern: "solid",
                  fgColor: { argb: "FFF2CC" }
                };
                cell.font = { color: { argb: "7F6000" }, bold: true };
              } else if (status === "entregado") {
                cell.fill = {
                  type: "pattern",
                  pattern: "solid",
                  fgColor: { argb: "E2F0D9" }
                };
                cell.font = { color: { argb: "385723" }, bold: true };
              } else if (status === "en bodega") {
                cell.fill = {
                  type: "pattern",
                  pattern: "solid",
                  fgColor: { argb: "DEEBF7" }
                };
                cell.font = { color: { argb: "2F5597" }, bold: true };
              } else if (status === "devuelto" || status === "devuelto a fedex") {
                cell.fill = {
                  type: "pattern",
                  pattern: "solid",
                  fgColor: { argb: "F2F2F2" }
                };
                cell.font = { color: { argb: "666666" }, bold: true };
              }
            }

            // Color para días sin código 67
            if (colNumber === 8 && diasSin67 > 0) {
              if (diasSin67 > 5) {
                cell.fill = {
                  type: "pattern",
                  pattern: "solid",
                  fgColor: { argb: "FFE6E6" }
                };
                cell.font = { 
                  color: { argb: "CC0000" },
                  bold: true 
                };
              } else if (diasSin67 > 2) {
                cell.fill = {
                  type: "pattern",
                  pattern: "solid",
                  fgColor: { argb: "FFEB9C" }
                };
                cell.font = { 
                  color: { argb: "9C6500" },
                  bold: true 
                };
              }
            }
          }
        });
      });

      // === HOJA DE RESUMEN ===
      const summarySheet = workbook.addWorksheet("Resumen");

      // Título del resumen
      const summaryTitle = summarySheet.addRow(["📊 RESUMEN: SHIPMENTS SIN CÓDIGO 67"]);
      summarySheet.mergeCells(`A${summaryTitle.number}:B${summaryTitle.number}`);
      summaryTitle.font = { size: 14, bold: true, color: { argb: "FFFFFF" } };
      summaryTitle.alignment = { vertical: "middle", horizontal: "center" };

      for (let col = 1; col <= 2; col++) {
        summarySheet.getCell(summaryTitle.number, col).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF6B6B" },
        };
      }

      summarySheet.addRow([]);

      // ESTADÍSTICAS GENERALES
      const statsTitle = summarySheet.addRow(["ESTADÍSTICAS GENERALES"]);
      summarySheet.mergeCells(`A${statsTitle.number}:B${statsTitle.number}`);
      statsTitle.font = { bold: true, color: { argb: "FFFFFF" } };
      statsTitle.alignment = { vertical: "middle", horizontal: "left" };

      for (let col = 1; col <= 2; col++) {
        summarySheet.getCell(statsTitle.number, col).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "8C5E4E" },
        };
      }

      const enBodega = shipments.filter(s => 
        s.currentStatus?.toLowerCase().includes('bodega') || 
        s.currentStatus?.toLowerCase().includes('pending')
      ).length;
      
      const enRuta = shipments.filter(s => 
        s.currentStatus?.toLowerCase().includes('ruta') || 
        s.currentStatus?.toLowerCase().includes('en_ruta')
      ).length;
      
      const entregados = shipments.filter(s => 
        s.currentStatus?.toLowerCase().includes('entregado') || 
        s.currentStatus?.toLowerCase().includes('delivered')
      ).length;
      
      const devueltos = shipments.filter(s => 
        s.currentStatus?.toLowerCase().includes('devuelto')
      ).length;

      // Cálculo de días sin código 67
      const shipmentsCriticos = shipments.filter(s => this.calculateDaysWithout67(s) > 3).length;
      const shipmentsAlerta = shipments.filter(s => {
        const dias = this.calculateDaysWithout67(s);
        return dias > 1 && dias <= 3;
      }).length;
      const shipmentsNormales = shipments.filter(s => this.calculateDaysWithout67(s) <= 1).length;

      // Promedio de días sin código 67
      const totalDiasSin67 = shipments.reduce((sum, s) => sum + this.calculateDaysWithout67(s), 0);
      const promedioDiasSin67 = shipments.length > 0 
        ? (totalDiasSin67 / shipments.length).toFixed(1)
        : "0";

      summarySheet.addRow(["Total de shipments sin código 67:", shipments.length]);
      summarySheet.addRow(["En bodega:", enBodega]);
      summarySheet.addRow(["En ruta:", enRuta]);
      summarySheet.addRow(["Entregados:", entregados]);
      summarySheet.addRow(["Devueltos:", devueltos]);
      summarySheet.addRow(["Promedio de días sin código 67:", promedioDiasSin67]);
      summarySheet.addRow([]);

      // ALERTAS POR TIEMPO - Encabezado más suave
      const alertasTitle = summarySheet.addRow(["🚨 ALERTAS POR TIEMPO SIN CÓDIGO 67"]);
      summarySheet.mergeCells(`A${alertasTitle.number}:B${alertasTitle.number}`);
      alertasTitle.font = { bold: true, color: { argb: "B30000" } }; // Texto rojo oscuro
      alertasTitle.alignment = { vertical: "middle", horizontal: "left" };

      for (let col = 1; col <= 2; col++) {
        summarySheet.getCell(alertasTitle.number, col).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF0F0" }, // Fondo rojo muy suave
        };
      }

      summarySheet.addRow(["Críticos (>3 días):", shipmentsCriticos]);
      summarySheet.addRow(["En alerta (2-3 días):", shipmentsAlerta]);
      summarySheet.addRow(["Normales (0-1 día):", shipmentsNormales]);
      summarySheet.addRow([]);

      // DISTRIBUCIÓN POR CÓDIGOS DE EXCEPCIÓN
      const codigosTitle = summarySheet.addRow(["CÓDIGOS DE EXCEPCIÓN ENCONTRADOS"]);
      summarySheet.mergeCells(`A${codigosTitle.number}:B${codigosTitle.number}`);
      codigosTitle.font = { bold: true, color: { argb: "FFFFFF" } };
      codigosTitle.alignment = { vertical: "middle", horizontal: "left" };

      for (let col = 1; col <= 2; col++) {
        summarySheet.getCell(codigosTitle.number, col).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "8C5E4E" },
        };
      }

      // Contar frecuencia de códigos de excepción
      const codigosFrecuencia = new Map<string, number>();
      shipments.forEach(shipment => {
        if (shipment.exceptionCodes && shipment.exceptionCodes.length > 0) {
          shipment.exceptionCodes.forEach((codigo: string) => {
            codigosFrecuencia.set(codigo, (codigosFrecuencia.get(codigo) || 0) + 1);
          });
        }
      });

      // Ordenar por frecuencia descendente
      const codigosOrdenados = Array.from(codigosFrecuencia.entries())
        .sort((a, b) => b[1] - a[1]);

      if (codigosOrdenados.length > 0) {
        codigosOrdenados.forEach(([codigo, count]) => {
          summarySheet.addRow([codigo, count]);
        });
      } else {
        summarySheet.addRow(["No se encontraron códigos de excepción", "-"]);
      }

      summarySheet.addRow([]);

      // SHIPMENTS MÁS ANTIGUOS SIN CÓDIGO 67
      const antiguosTitle = summarySheet.addRow(["SHIPMENTS MÁS ANTIGUOS SIN CÓDIGO 67"]);
      summarySheet.mergeCells(`A${antiguosTitle.number}:B${antiguosTitle.number}`);
      antiguosTitle.font = { bold: true, color: { argb: "FFFFFF" } };
      antiguosTitle.alignment = { vertical: "middle", horizontal: "left" };

      for (let col = 1; col <= 2; col++) {
        summarySheet.getCell(antiguosTitle.number, col).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "8C5E4E" },
        };
      }

      // Top 5 más antiguos
      const shipmentsAntiguos = [...shipments]
        .sort((a, b) => this.calculateDaysWithout67(b) - this.calculateDaysWithout67(a))
        .slice(0, 5);

      shipmentsAntiguos.forEach((shipment, index) => {
        summarySheet.addRow([
          `${index + 1}. ${shipment.trackingNumber}`,
          `${this.calculateDaysWithout67(shipment)} días`
        ]);
      });

      // === AJUSTE DE COLUMNAS ===
      // Hoja principal
      sheet.getColumn(1).width = 5;   // No.
      sheet.getColumn(2).width = 22;  // Número de Tracking
      sheet.getColumn(3).width = 15;  // Estado Actual
      sheet.getColumn(4).width = 12;  // Cantidad de Estados
      sheet.getColumn(5).width = 25;  // Códigos de Excepción
      sheet.getColumn(6).width = 18;  // Fecha Primer Estado
      sheet.getColumn(7).width = 18;  // Fecha Último Estado
      sheet.getColumn(8).width = 15;  // Días Sin Código 67
      sheet.getColumn(9).width = 25;  // Observaciones

      // Hoja de resumen
      summarySheet.getColumn(1).width = 35;
      summarySheet.getColumn(2).width = 15;

      // Aplicar bordes a la hoja de resumen
      for (let i = 1; i <= summarySheet.rowCount; i++) {
        for (let j = 1; j <= 2; j++) {
          const cell = summarySheet.getCell(i, j);
          if (cell.value) {
            cell.border = {
              top: { style: "thin" },
              left: { style: "thin" },
              bottom: { style: "thin" },
              right: { style: "thin" },
            };
          }
        }
      }

      // Centrar valores en la hoja de resumen
      for (let i = 5; i <= summarySheet.rowCount; i++) {
        const cell = summarySheet.getCell(i, 2);
        if (cell.value) {
          cell.alignment = { vertical: "middle", horizontal: "center" };
        }
      }

      // === CONFIGURAR RESPONSE Y ENVIAR ===
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="shipments_sin_codigo_67_${this.formatDateForFilename(currentDate)}.xlsx"`);

      await workbook.xlsx.write(res);
      
      return res;
    }

    private calculateDaysWithout67(shipment: any): number {
      if (!shipment.firstStatusDate) {
        return 0;
      }

      try {
        const firstStatusDate = new Date(shipment.firstStatusDate);
        const today = new Date();
        
        const diffTime = today.getTime() - firstStatusDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        return Math.max(0, diffDays);
      } catch (error) {
        return 0;
      }
    }

    private formatExcelDate(dateString: string): string {
      if (!dateString) return 'N/A';
      
      try {
        const date = new Date(dateString);
        return date.toLocaleDateString('es-ES', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
      } catch {
        return 'Fecha inválida';
      }
    }

    private formatStatus(status: string): string {
      if (!status) return 'N/A';
      
      const statusMap: { [key: string]: string } = {
        'en_ruta': 'En Ruta',
        'en_bodega': 'En Bodega',
        'entregado': 'Entregado',
        'devuelto_a_fedex': 'Devuelto a FedEx',
        'devuelto': 'Devuelto',
        'pending': 'Pendiente',
        'delivered': 'Entregado',
        'no_entregado': 'No Entregado'
      };
      
      return statusMap[status.toLowerCase()] || status;
    }

    private formatDateForFilename(date: Date): string {
      return date.toISOString()
        .replace(/[:.]/g, '-')
        .split('T')[0];
    }

    /****************************************************************** */


    /***** Agrear shipments directamente */
    async addShipment(dto: ShipmentToSaveDto): Promise<any> {
      try {
        this.logger.log("📥 addShipment() recibido");
        this.logger.log(JSON.stringify(dto, null, 2));

        // Validar que venga un trackingNumber
        if (!dto.trackingNumber) {
          throw new Error("trackingNumber es requerido");
        }

        // Obtener sucursal (como tú manejas subsidiaries)
        const subsidiary = await this.subsidiaryRepository.findOne({
          where: { id: dto.subsidiary.id },
        });

        if (!subsidiary) {
          throw new Error(`Subsidiary ${dto.subsidiary.id} no encontrada`);
        }

        // -------------------------
        // LLAMAR processShipmentDirect()
        // -------------------------
        const savedShipment = await this.processShipmentDirect(dto, subsidiary);

        this.logger.log(`✅ Shipment guardado: ${savedShipment.trackingNumber}`);

        return {
          ok: true,
          message: "Shipment procesado y guardado correctamente",
          shipment: savedShipment,
        };

      } catch (err) {
        this.logger.error(`❌ Error en addShipment(): ${err.message}`);

        return {
          ok: false,
          message: err.message,
        };
      }
    }

    async processShipmentDirect(
      shipment: ShipmentToSaveDto,
      predefinedSubsidiary: Subsidiary
    ): Promise<Shipment> {

      const trackingNumber = shipment.trackingNumber;

      this.logger.log(`📦 Procesando envío: ${trackingNumber}`);
      this.logger.log(`📅 commitDate=${shipment.commitDate}, commitTime=${shipment.commitTime}`);

      // -----------------------
      // PARSEO commitDate/Time
      // -----------------------
      let commitDate: string | undefined;
      let commitTime: string | undefined;
      let commitDateTime: Date | undefined;
      let dateSource = "";

      if (shipment.commitDate && shipment.commitTime) {
        try {
          const timeZone = "America/Hermosillo";

          const parsedDate = parse(shipment.commitDate, "yyyy-MM-dd", new Date());
          const parsedTime = parse(shipment.commitTime, "HH:mm:ss", new Date());

          if (!isNaN(parsedDate.getTime()) && !isNaN(parsedTime.getTime())) {
            commitDate = format(parsedDate, "yyyy-MM-dd");
            commitTime = format(parsedTime, "HH:mm:ss");

            const localDateTime = `${commitDate}T${commitTime}`;
            commitDateTime = toDate(localDateTime, { timeZone });
            dateSource = "Save Direct";
          }
        } catch {}
      }

      // -----------------------
      // CREAR SHIPMENT BASE
      // -----------------------
      const newShipment = Object.assign(new Shipment(), {
        trackingNumber,
        shipmentType: ShipmentType.FEDEX,
        recipientName: shipment.recipientName || '',
        recipientAddress: shipment.recipientAddress || '',
        recipientCity: shipment.recipientCity || predefinedSubsidiary.name,
        recipientZip: shipment.recipientZip || '',
        commitDate,
        commitTime,
        commitDateTime,
        recipientPhone: shipment.recipientPhone || '',
        status: shipment.status,
        priority: shipment.priority,
        receivedByName: '',
        subsidiary: predefinedSubsidiary,
        subsidiaryId: predefinedSubsidiary.id,
      });

      // -----------------------
      // CONSULTAR FEDEX
      // -----------------------
      let fedexShipmentData: FedExTrackingResponseDto;

      try {
        this.logger.log(`📬 Consultando FedEx para ${trackingNumber}`);
        fedexShipmentData = await this.trackPackageWithRetry(trackingNumber);
      } catch (err) {
        throw new Error(`Error consultando FedEx: ${err.message}`);
      }

      // -----------------------
      // PROCESAR HISTORIES / SCAN EVENTS
      // -----------------------
      const trackResults = fedexShipmentData.output.completeTrackResults[0].trackResults;

      const shipmentReference = Object.assign(new Shipment(), { trackingNumber });

      const histories = await this.processFedexScanEventsToStatusesResp(
        trackResults.flatMap(r => r.scanEvents ?? []),
        shipmentReference
      );

      histories.forEach(h => {
        h.shipment = undefined; // no referencias circulares
        h.id = undefined;       // ID se genera al guardar
      });

      // -----------------------
      // ULTIMO STATUS (como antes)
      // -----------------------
      const lastStatus = histories[histories.length - 1]?.status;
      newShipment.status = lastStatus ?? ShipmentStatusType.EN_RUTA;

      // recibido por
      const latestResult =
        trackResults.find(r => r.latestStatusDetail?.derivedCode === "DL") ??
        trackResults.sort((a, b) => {
          const da = a.scanEvents[0]?.date ? new Date(a.scanEvents[0].date).getTime() : 0;
          const db = b.scanEvents[0]?.date ? new Date(b.scanEvents[0].date).getTime() : 0;
          return db - da;
        })[0];

      newShipment.receivedByName = latestResult?.deliveryDetails?.receivedByName || "";

      // -----------------------
      // commitDateTime desde FedEx si Excel falló
      // -----------------------
      if (!commitDateTime) {
        const rawDate = latestResult?.standardTransitTimeWindow?.window?.ends;

        if (rawDate) {
          try {
            const parsedFedexDate = parse(rawDate, "yyyy-MM-dd'T'HH:mm:ssXXX", new Date());
            if (!isNaN(parsedFedexDate.getTime())) {
              commitDate = format(parsedFedexDate, "yyyy-MM-dd");
              commitTime = format(parsedFedexDate, "HH:mm:ss");
              commitDateTime = parsedFedexDate;
              dateSource = "FedEx";
            }
          } catch {}
        }
      }

      // -----------------------
      // FECHA DEFAULT
      // -----------------------
      if (!commitDateTime) {
        const now = new Date();
        commitDateTime = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          18 + 7,
          0,
          0
        ));
        dateSource = "Default";
      }

      newShipment.commitDate = commitDate;
      newShipment.commitTime = commitTime;
      newShipment.commitDateTime = commitDateTime;
      newShipment.priority = getPriority(commitDateTime);

      // -----------------------
      // PAYMENT (igual que antes)
      // -----------------------
      if (shipment.payment) {
        const typeMatch = shipment.payment.match(/^(COD|FTC|ROD)/);
        const amountMatch = shipment.payment.match(/([0-9]+(?:\.[0-9]+)?)/);

        if (amountMatch) {
          const paymentType = typeMatch ? typeMatch[1] as PaymentTypeEnum : null;
          const paymentAmount = parseFloat(amountMatch[1]);

          if (!isNaN(paymentAmount) && paymentAmount > 0) {
            newShipment.payment = Object.assign(new Payment(), {
              amount: paymentAmount,
              type: paymentType,
              status: histories.some(h => h.status === ShipmentStatusType.ENTREGADO)
                ? PaymentStatus.PAID
                : PaymentStatus.PENDING,
            });
          }
        }
      }

      // aplicar histories ya procesado
      newShipment.statusHistory = histories;

      // -----------------------
      // GUARDAR DIRECTAMENTE
      // -----------------------
      const saved = await this.shipmentRepository.save(newShipment);

      return saved;
    }




    /*********************************** */


    async newCheckStatusOnFedex() {


    }




    /********************************* NUEVO METODO PARA VALIDAR A FEDEX */
      async checkStatusOnFedexBySubsidiaryRulesTesting(
        trackingNumbers: string[],
        shouldPersist = false
      ): Promise<FedexTrackingResponseDto> {
        // Inicializar resultados
        const results = this.initializeResults();
        
        try {
          this.logger.debug(`=== MÉTODO PRINCIPAL INICIADO ===`);
          this.logger.debug(`Tracking numbers: ${trackingNumbers.join(', ')}`);
          this.logger.debug(`shouldPersist: ${shouldPersist}`);
          this.logger.debug(`Número de trackings: ${trackingNumbers.length}`);

          // Validar input
          this.validateTrackingNumbers(trackingNumbers);

          // Buscar shipments
          const shipments = await this.fetchShipmentsFromDb(trackingNumbers);
          
          // Validar shipments encontrados
          this.validateShipmentsFound(shipments, trackingNumbers, results.shipmentsWithError);
          
          if (shipments.length === 0) {
            this.logger.warn('No se encontraron shipments para procesar');
            return results;
          }

          // Agrupar shipments por trackingNumber
          const shipmentsByTrackingNumber = this.groupShipmentsByTrackingNumber(shipments);
          
          // Procesar en batches
          const batches = this.createBatches(Object.keys(shipmentsByTrackingNumber), this.BATCH_SIZE || 100);
          
          for (let i = 0; i < batches.length; i++) {
            await this.processBatch(
              batches[i],
              shipmentsByTrackingNumber,
              shouldPersist,
              results,
              i + 1,
              batches.length
            );
          }

          this.logFinalStats(results);
       
          this.logger.debug(`=== MÉTODO PRINCIPAL FINALIZADO ===`);
          this.logger.debug(`Resultados:`, {
            updatedShipments: results.updatedShipments.length,
            errors: results.shipmentsWithError.length,
            unusualCodes: results.unusualCodes.length,
            forPickUp: results.forPickUpShipments.length
          });

          return results;
          
        } catch (err) {
          this.logger.error(`Error general en checkStatusOnFedex: ${err.message}`, err.stack);
          throw new BadRequestException(`Error general en checkStatusOnFedex: ${err.message}`);
        }
      }

      // ========== MÉTODOS AUXILIARES REFACTORIZADOS ==========

      private initializeResults() {
        return {
          updatedShipments: [] as {
            trackingNumber: string;
            fromStatus: string;
            toStatus: string;
            eventDate: string;
            shipmentId: string;
            consolidatedId?: string;
            subsidiaryId?: string;
          }[],
          shipmentsWithError: [] as { trackingNumber: string; reason: string; shipmentId?: string }[],
          unusualCodes: [] as {
            trackingNumber: string;
            derivedCode: string;
            exceptionCode?: string;
            eventDate: string;
            statusByLocale?: string;
            shipmentId?: string;
            note?: string;
          }[],
          shipmentsWithOD: [] as { trackingNumber: string; eventDate: string; shipmentId?: string }[],
          shipmentsWithInvalidIncome: [] as { trackingNumber: string; eventDate: string; shipmentId?: string }[],
          forPickUpShipments: [] as {
            trackingNumber: string;
            eventDate: string;
            shipmentId: string;
            subsidiaryId?: string;
            consolidatedId?: string;
          }[],
        };
      }

      private validateTrackingNumbers(trackingNumbers: string[]) {
        if (!trackingNumbers || trackingNumbers.length === 0) {
          throw new BadRequestException('No se proporcionaron tracking numbers');
        }
        
        if (trackingNumbers.length > 1000) {
          this.logger.warn(`Se recibieron ${trackingNumbers.length} tracking numbers, considerando reducir el tamaño`);
        }
      }

      private async fetchShipmentsFromDb(trackingNumbers: string[]): Promise<Shipment[]> {
        return await this.shipmentRepository
          .createQueryBuilder('shipment')
          .leftJoinAndSelect('shipment.subsidiary', 'subsidiary')
          .leftJoinAndSelect('shipment.payment', 'payment')
          .leftJoinAndSelect('shipment.statusHistory', 'statusHistory')
          .addSelect('shipment.consolidatedId', 'consolidatedId')
          .where('shipment.trackingNumber IN (:...trackingNumbers)', { trackingNumbers })
          .andWhere('shipment.status != :deliveredStatus', { 
            deliveredStatus: ShipmentStatusType.ENTREGADO 
          })
          .getMany();
      }

      private validateShipmentsFound(
        shipments: Shipment[],
        trackingNumbers: string[],
        shipmentsWithError: { trackingNumber: string; reason: string; shipmentId?: string }[]
      ) {
        const foundTrackingNumbers = [...new Set(shipments.map(s => s.trackingNumber))];
        const notFoundTracking = trackingNumbers.filter(tn => !foundTrackingNumbers.includes(tn));
        
        for (const tn of notFoundTracking) {
          const reason = `No se encontró shipment en BD para trackingNumber: ${tn}`;
          this.logger.warn(reason);
          shipmentsWithError.push({ trackingNumber: tn, reason });
        }
      }

      private groupShipmentsByTrackingNumber(shipments: Shipment[]): Record<string, Shipment[]> {
        const grouped: Record<string, Shipment[]> = {};
        
        for (const shipment of shipments) {
          // Asegurar que consolidatedId esté disponible
          const shipmentWithConsolidated = shipment;
          if (!(shipmentWithConsolidated as any).consolidatedId) {
            (shipmentWithConsolidated as any).consolidatedId = null;
          }
          
          if (!grouped[shipment.trackingNumber]) {
            grouped[shipment.trackingNumber] = [];
          }
          
          grouped[shipment.trackingNumber].push(shipmentWithConsolidated);
        }
        
        return grouped;
      }

      private createBatches<T>(items: T[], batchSize: number): T[][] {
        const batches: T[][] = [];
        for (let i = 0; i < items.length; i += batchSize) {
          batches.push(items.slice(i, i + batchSize));
        }
        return batches;
      }

      private async processBatch(
        batch: string[],
        shipmentsByTrackingNumber: Record<string, Shipment[]>,
        shouldPersist: boolean,
        results: any,
        batchNumber: number,
        totalBatches: number
      ): Promise<void> {
        this.logger.log(`Procesando lote ${batchNumber}/${totalBatches} con ${batch.length} trackingNumbers`);
        
        // Procesar secuencialmente para evitar race conditions
        for (const trackingNumber of batch) {
          await this.processTrackingNumber(
            trackingNumber,
            shipmentsByTrackingNumber[trackingNumber],
            shouldPersist,
            results
          );
        }
      }

      private async processTrackingNumber(
        trackingNumber: string,
        shipmentList: Array<Shipment & { consolidatedId: string | null }>,
        shouldPersist: boolean,
        results: any
      ): Promise<void> {
        try {
          // Validar lista de shipments
          if (!shipmentList || shipmentList.length === 0) {
            const reason = `No se encontraron shipments para ${trackingNumber}`;
            this.logger.error(reason);
            results.shipmentsWithError.push({ trackingNumber, reason });
            return;
          }

          this.logger.debug(`Procesando ${trackingNumber} con ${shipmentList.length} shipment(s)`);

          // Seleccionar shipment representativo (el más reciente)
          const representativeShipment = this.selectRepresentativeShipment(shipmentList);

          // Obtener información de FedEx
          const fedexData = await this.fetchFedexDataWithRetry(trackingNumber);
          if (!fedexData) {
            this.handleFedexDataError(trackingNumber, shipmentList, results.shipmentsWithError);
            return;
          }

          // Procesar eventos de FedEx
          const eventProcessingResult = this.processFedexEvents(fedexData, trackingNumber);
          if (!eventProcessingResult.success) {
            shipmentList.forEach((shipment) => {
              results.shipmentsWithError.push({
                trackingNumber,
                reason: eventProcessingResult.reason,
                shipmentId: shipment.id
              });
            });
            return;
          }

          const { latestEvent, latestStatusDetail, exceptionCode, eventDate } = eventProcessingResult;

          // Manejo especial para eventos HP (For Pickup)
          if (this.isForPickupEvent(latestEvent)) {
            await this.handleForPickupEvent(
              trackingNumber,
              shipmentList,
              representativeShipment,
              latestEvent,
              eventDate,
              shouldPersist,
              results
            );
            return;
          }

          // Mapear estado
          const mappedStatus = this.mapFedexStatus(
            latestStatusDetail,
            latestEvent,
            exceptionCode,
            trackingNumber
          );

          // Log específico para códigos 67
          if (exceptionCode === '67') {
            this.logger.debug(`🔍 CÓDIGO 67 DETECTADO para ${trackingNumber}: 
              eventType=${latestEvent.eventType}, 
              derivedCode=${latestStatusDetail?.derivedCode || latestEvent.derivedStatusCode},
              statusByLocale=${latestStatusDetail?.statusByLocale},
              mappedStatus=${mappedStatus},
              description=${latestEvent.eventDescription}`);
          }

          // Procesar cada shipment individualmente
          for (const shipment of shipmentList) {
            await this.processIndividualShipment(
              shipment,
              trackingNumber,
              latestEvent,
              latestStatusDetail,
              exceptionCode,
              eventDate,
              mappedStatus,
              representativeShipment,
              shouldPersist,
              results
            );
          }

        } catch (error) {
          this.logger.error(`Error procesando ${trackingNumber}: ${error.message}`, error.stack);
          results.shipmentsWithError.push({
            trackingNumber,
            reason: `Error interno procesando shipment: ${error.message}`,
            shipmentId: shipmentList?.[0]?.id
          });
        }
      }

      private selectRepresentativeShipment(shipmentList: Shipment[]): Shipment {
        return shipmentList.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )[0];
      }

      private async fetchFedexDataWithRetry(trackingNumber: string): Promise<FedExTrackingResponseDto | null> {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const shipmentInfo = await this.trackPackageWithRetry(trackingNumber);
            if (shipmentInfo?.output?.completeTrackResults?.[0]?.trackResults?.length) {
              return shipmentInfo;
            }
          } catch (err) {
            this.logger.warn(`Intento ${attempt}/3 fallido para ${trackingNumber}: ${err.message}`);
            if (attempt === 3) {
              return null;
            }
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
          }
        }
        return null;
      }

      private handleFedexDataError(
        trackingNumber: string,
        shipmentList: Shipment[],
        shipmentsWithError: any[]
      ) {
        const reason = `Error al obtener información de FedEx para ${trackingNumber} tras 3 intentos`;
        this.logger.error(reason);
        shipmentList.forEach((shipment) => {
          shipmentsWithError.push({ trackingNumber, reason, shipmentId: shipment.id });
        });
      }

      private processFedexEvents(
        fedexData: FedExTrackingResponseDto,
        trackingNumber: string
      ): {
        success: boolean;
        reason?: string;
        latestEvent?: any;
        latestStatusDetail?: any;
        exceptionCode?: string;
        eventDate?: Date;
      } {
        try {
          const trackResults = fedexData.output.completeTrackResults[0].trackResults;
          
          // Obtener todos los scan events
          const allScanEvents = trackResults.flatMap((result) => result.scanEvents || []);
          
          // Filtrar eventos con fecha válida
          const eventsWithValidDate = allScanEvents.filter(event => {
            try {
              return event.date && !isNaN(new Date(event.date).getTime());
            } catch {
              return false;
            }
          });

          if (eventsWithValidDate.length === 0) {
            return {
              success: false,
              reason: `No se encontraron eventos válidos con fecha para ${trackingNumber}`
            };
          }

          // Ordenar por fecha (más reciente primero)
          const latestEvent = eventsWithValidDate.sort((a, b) => {
            return new Date(b.date).getTime() - new Date(a.date).getTime();
          })[0];

          // Obtener latestStatusDetail del trackResult correspondiente
          const latestTrackResult = trackResults.find((result) =>
            result.scanEvents?.some((e) => 
              e.date === latestEvent.date && 
              e.eventType === latestEvent.eventType
            )
          ) || trackResults[0];

          const latestStatusDetail = latestTrackResult.latestStatusDetail;
          
          // Obtener exceptionCode (priorizando el del evento más reciente)
          const exceptionCode = latestEvent.exceptionCode || 
                              latestStatusDetail?.ancillaryDetails?.[0]?.reason || 
                              null;

          // Parsear fecha del evento
          const eventDate = new Date(latestEvent.date);
          if (isNaN(eventDate.getTime())) {
            return {
              success: false,
              reason: `Fecha inválida para ${trackingNumber}: ${latestEvent.date}`
            };
          }

          return {
            success: true,
            latestEvent,
            latestStatusDetail,
            exceptionCode,
            eventDate
          };

        } catch (error) {
          return {
            success: false,
            reason: `Error procesando eventos de FedEx para ${trackingNumber}: ${error.message}`
          };
        }
      }

      private isForPickupEvent(latestEvent: any): boolean {
        return latestEvent.eventType === 'HP' && 
              latestEvent.eventDescription?.toLowerCase().includes('ready for recipient pickup');
      }

      private async handleForPickupEvent(
        trackingNumber: string,
        shipmentList: Shipment[],
        representativeShipment: Shipment,
        latestEvent: any,
        eventDate: Date,
        shouldPersist: boolean,
        results: any
      ): Promise<void> {
        this.logger.debug(`HP event with exceptionCode=${latestEvent.exceptionCode} for ${trackingNumber}, diverting to ES_OCURRE`);
        
        const formattedEventDate = this.formatDate(eventDate);

        if (shouldPersist) {
          try {
            await this.persistForPickupEvent(
              trackingNumber,
              shipmentList,
              representativeShipment,
              latestEvent,
              eventDate,
              results
            );
          } catch (err) {
            const reason = `Error al guardar ForPickUp para ${trackingNumber}: ${err.message}`;
            this.logger.error(reason);
            shipmentList.forEach((shipment) => {
              results.shipmentsWithError.push({ trackingNumber, reason, shipmentId: shipment.id });
            });
            return;
          }
        }

        // Agregar a resultados
        shipmentList.forEach((shipment) => {
          results.forPickUpShipments.push({
            trackingNumber,
            eventDate: formattedEventDate,
            shipmentId: shipment.id,
            subsidiaryId: representativeShipment.subsidiary?.id,
            consolidatedId: shipment.consolidatedId,
          });
        });
      }

      private async persistForPickupEvent(
        trackingNumber: string,
        shipmentList: Shipment[],
        representativeShipment: Shipment,
        latestEvent: any,
        eventDate: Date,
        results: any
      ): Promise<void> {
        await this.shipmentRepository.manager.transaction(async (em) => {
          // Crear ForPickUp
          const forPickUp = new ForPickUp();
          forPickUp.trackingNumber = trackingNumber;
          forPickUp.date = eventDate;
          forPickUp.subsidiary = representativeShipment.subsidiary;
          forPickUp.createdAt = new Date();

          await em.save(ForPickUp, forPickUp);
          this.logger.log(`ForPickUp guardado para ${trackingNumber} con date=${this.formatDate(eventDate)}`);

          // Actualizar cada shipment a ES_OCURRE
          for (const shipment of shipmentList) {
            // Skip si ya es ENTREGADO
            if (shipment.statusHistory?.some(h => h.status === ShipmentStatusType.ENTREGADO)) {
              this.logger.debug(`Omitiendo actualización para ${trackingNumber} (shipmentId=${shipment.id}): ya tiene estado ENTREGADO`);
              continue;
            }

            const fromStatus = shipment.status;
            
            // Crear nuevo estado
            const newShipmentStatus = new ShipmentStatus();
            newShipmentStatus.status = ShipmentStatusType.ES_OCURRE;
            newShipmentStatus.timestamp = eventDate;
            newShipmentStatus.notes = `${latestEvent.eventType} - ${latestEvent.eventDescription}`;
            newShipmentStatus.shipment = shipment;

            // Actualizar shipment
            shipment.status = ShipmentStatusType.ES_OCURRE;
            shipment.statusHistory = shipment.statusHistory || [];
            shipment.statusHistory.push(newShipmentStatus);

            await em.save(ShipmentStatus, newShipmentStatus);
            await em
              .createQueryBuilder()
              .update(Shipment)
              .set({ status: ShipmentStatusType.ES_OCURRE })
              .where('id = :id', { id: shipment.id })
              .execute();

            this.logger.log(`Shipment actualizado a ES_OCURRE para ${trackingNumber} (shipmentId=${shipment.id})`);

            results.updatedShipments.push({
              trackingNumber,
              fromStatus,
              toStatus: ShipmentStatusType.ES_OCURRE,
              eventDate: eventDate.toISOString(),
              shipmentId: shipment.id,
              consolidatedId: shipment.consolidatedId,
              subsidiaryId: representativeShipment.subsidiary?.id,
            });
          }
        });
      }

      private mapFedexStatus(
        latestStatusDetail: any,
        latestEvent: any,
        exceptionCode: string,
        trackingNumber: string
      ): ShipmentStatusType {
        this.logger.debug(`=== MAPEANDO ESTADO PARA ${trackingNumber} ===`);
        this.logger.debug(`Event Type: ${latestEvent.eventType}`);
        this.logger.debug(`Derived Status Code: ${latestEvent.derivedStatusCode}`);
        this.logger.debug(`Exception Code: ${exceptionCode}`);
        this.logger.debug(`Latest Status Detail Code: ${latestStatusDetail?.code}`);
        
        // Priorizar ENTREGADO para eventos de entrega
        if (latestEvent.eventType === 'DL' || latestEvent.derivedStatusCode === 'DL') {
          this.logger.debug(`Priorizando ENTREGADO para ${trackingNumber}`);
          return ShipmentStatusType.ENTREGADO;
        }

        // Mapear usando la función existente
        let mappedStatus = mapFedexStatusToLocalStatus(
          latestStatusDetail?.code || latestEvent.derivedStatusCode,
          exceptionCode
        );
        
        this.logger.debug(`Estado mapeado inicialmente: ${mappedStatus}`);
        
        // Forzar EN_RUTA para código 67 si no se mapeó correctamente
        if (exceptionCode === '67') {
          this.logger.debug(`CÓDIGO 67 DETECTADO - Estado actual: ${mappedStatus}`);
          if (mappedStatus !== ShipmentStatusType.EN_RUTA) {
            this.logger.warn(`Código 67 no mapeado como EN_RUTA para ${trackingNumber}, forzando mapeo`);
            mappedStatus = ShipmentStatusType.EN_RUTA;
          }
        }

        this.logger.debug(`Estado final mapeado: ${mappedStatus}`);
        return mappedStatus;
      }

      private async processIndividualShipment(
        shipment: Shipment,
        trackingNumber: string,
        latestEvent: any,
        latestStatusDetail: any,
        exceptionCode: string,
        eventDate: Date,
        mappedStatus: ShipmentStatusType,
        representativeShipment: Shipment,
        shouldPersist: boolean,
        results: any
      ): Promise<void> {
        try {
          console.log('\n══════════════════════════════════════════════════');
          console.log(`🔄 PROCESANDO SHIPMENT INDIVIDUAL - CÓDIGO 67 ESPECIAL`);
          console.log('══════════════════════════════════════════════════');
          console.log(`📦 Tracking: ${trackingNumber}`);
          console.log(`🆔 Shipment ID: ${shipment.id}`);
          console.log(`🏷️ Estado actual en BD: ${shipment.status}`);
          console.log(`🎯 Estado mapeado de FedEx: ${mappedStatus}`);
          console.log(`🔢 Exception Code: ${exceptionCode}`);
          console.log(`📅 Event Date: ${eventDate.toISOString()}`);
          console.log(`🎫 Event Type: ${latestEvent.eventType}`);
          console.log(`📝 Event Description: ${latestEvent.eventDescription}`);
          
          // 1. Skip solo si ya es ENTREGADO (los 67 no deben pasar después de entregado)
          const isDelivered = shipment.statusHistory?.some(h => h.status === ShipmentStatusType.ENTREGADO);
          console.log(`✅ ¿Ya es ENTREGADO?: ${isDelivered ? 'SÍ - SKIP' : 'NO - CONTINUAR'}`);
          
          if (isDelivered) {
            console.log(`⏩ SKIP - Ya tiene estado ENTREGADO, no procesar código 67`);
            return;
          }
          
          const subsidiaryId = shipment.subsidiary?.id || 'default';
          console.log(`🏢 Subsidiary ID: ${subsidiaryId}`);
          
          // Obtener reglas de la sucursal
          const subsidiaryRules = await this.getSubsidiaryRules();
          const defaultRules = this.getDefaultSubsidiaryRules();
          const rules = subsidiaryRules[subsidiaryId] || defaultRules;
          
          // AGREGAR OW SI NO ESTÁ
          if (!rules.allowedEventTypes.includes('OW')) {
            rules.allowedEventTypes = [...rules.allowedEventTypes, 'OW'];
            console.log(`➕ Agregado OW a allowedEventTypes`);
          }
          
          console.log(`📋 Reglas aplicadas:`, {
            allowedEventTypes: rules.allowedEventTypes,
            allowedExceptionCodes: rules.allowedExceptionCodes,
            allowIncomeFor67: rules.allowIncomeFor67
          });
          
          // Validar si el evento está permitido según las reglas
          console.log(`🔍 Validando evento contra reglas...`);
          const validationResult = this.validateEventAgainstRules(
            latestEvent,
            exceptionCode,
            mappedStatus,
            rules,
            subsidiaryId,
            trackingNumber,
            shipment.id
          );
          
          console.log(`✅ Validación: ${validationResult.isValid ? 'PASÓ' : 'FALLÓ'}`);
          if (!validationResult.isValid) {
            console.log(`❌ Razón: ${validationResult.reason}`);
            if (validationResult.isUnusualCode) {
              results.unusualCodes.push({
                trackingNumber,
                derivedCode: latestStatusDetail?.derivedCode || latestEvent.derivedStatusCode || 'N/A',
                exceptionCode,
                eventDate: latestEvent.date || 'N/A',
                statusByLocale: latestStatusDetail?.statusByLocale || 'N/A',
                shipmentId: shipment.id,
                note: validationResult.reason
              });
            }
            results.shipmentsWithError.push({
              trackingNumber,
              reason: validationResult.reason,
              shipmentId: shipment.id
            });
            return;
          }
          
          // Ajustar estado si es necesario
          console.log(`🎯 Ajustando estado basado en reglas...`);
          let toStatus = this.adjustStatusBasedOnRules(mappedStatus, exceptionCode, rules, trackingNumber);
          console.log(`🎯 Estado ajustado: ${toStatus}`);
          
          // PARA CÓDIGO 67: Siempre considerar como evento nuevo (no validar frescura)
          const fromStatus = shipment.status;
          
          // ESPECIAL PARA CÓDIGO 67: Siempre procesar aunque el estado no cambie
          if (exceptionCode === '67') {
            console.log(`🚨 CÓDIGO 67 DETECTADO - Procesamiento especial activado`);
            console.log(`📊 Estado actual: ${fromStatus}, Nuevo estado: ${toStatus}`);
            
            // Registrar actualización SIEMPRE para código 67
            results.updatedShipments.push({
              trackingNumber,
              fromStatus,
              toStatus,
              eventDate: eventDate.toISOString(),
              shipmentId: shipment.id,
              consolidatedId: shipment.consolidatedId,
              subsidiaryId,
            });
            
            console.log(`💾 shouldPersist para código 67: ${shouldPersist}`);
            
            if (shouldPersist) {
              console.log(`🚀 LLAMANDO persistShipmentChanges para código 67...`);
              await this.persistShipmentChanges(
                shipment,
                trackingNumber,
                toStatus,
                latestEvent,
                latestStatusDetail,
                exceptionCode,
                eventDate,
                representativeShipment,
                rules,
                results
              );
            }
            
            console.log(`✅ CÓDIGO 67 PROCESADO EXITOSAMENTE\n`);
            return; // Salir después de procesar código 67
          }
          
          // Para otros códigos (no 67), usar lógica normal
          console.log(`📅 Validando si evento es más reciente (solo para no-código 67)...`);
          const isNewer = this.isEventNewerThanLastStatus(shipment, eventDate, toStatus, exceptionCode);
          console.log(`📅 ¿Evento es más reciente?: ${isNewer ? 'SÍ' : 'NO'}`);
          
          if (!isNewer) {
            console.log(`⏩ SKIP - Evento no es más reciente, saliendo...`);
            return;
          }
          
          // Para otros códigos: Validar si el estado cambia
          if (fromStatus === toStatus && toStatus !== ShipmentStatusType.ENTREGADO) {
            console.log(`🔄 Estado no cambia (${fromStatus} → ${toStatus}), solo actualizando receivedByName si aplica`);
            await this.updateReceivedByNameIfNeeded(
              shipment,
              latestStatusDetail,
              trackingNumber,
              shouldPersist,
              results.shipmentsWithError
            );
            
            // Pero aún así registrar en updatedShipments para el reporte
            results.updatedShipments.push({
              trackingNumber,
              fromStatus,
              toStatus,
              eventDate: eventDate.toISOString(),
              shipmentId: shipment.id,
              consolidatedId: shipment.consolidatedId,
              subsidiaryId,
            });
            
            console.log(`✅ PROCESAMIENTO COMPLETADO (sin cambio de estado)\n`);
            return;
          }
          
          // Si el estado cambia
          console.log(`📝 Cambio de estado detectado: ${fromStatus} → ${toStatus}`);
          
          results.updatedShipments.push({
            trackingNumber,
            fromStatus,
            toStatus,
            eventDate: eventDate.toISOString(),
            shipmentId: shipment.id,
            consolidatedId: shipment.consolidatedId,
            subsidiaryId,
          });
          
          console.log(`💾 shouldPersist: ${shouldPersist}`);
          
          if (shouldPersist) {
            console.log(`🚀 LLAMANDO persistShipmentChanges...`);
            await this.persistShipmentChanges(
              shipment,
              trackingNumber,
              toStatus,
              latestEvent,
              latestStatusDetail,
              exceptionCode,
              eventDate,
              representativeShipment,
              rules,
              results
            );
          } else {
            console.log(`⏸️ NO se persistirá (shouldPersist=false)`);
          }
          
          console.log(`✅ SHIPMENT PROCESADO EXITOSAMENTE\n`);
          
        } catch (error) {
          console.error(`❌ ERROR en processIndividualShipment:`, error);
          this.logger.error(`Error procesando shipment ${shipment.id}: ${error.message}`, error.stack);
          results.shipmentsWithError.push({
            trackingNumber,
            reason: `Error interno: ${error.message}`,
            shipmentId: shipment.id
          });
        }
      }

      private isEventNewerThanLastStatus(
        shipment: Shipment,
        eventDate: Date,
        toStatus: ShipmentStatusType,
        exceptionCode: string
      ): boolean {
        console.log(`\n📅 === VALIDANDO FRESCURA DEL EVENTO ===`);
        console.log(`📅 Event Date: ${eventDate.toISOString()}`);
        console.log(`🎯 To Status: ${toStatus}`);
        console.log(`🔢 Exception Code: ${exceptionCode}`);
        
        // ESPECIAL: Para código 67, NO validar frescura - siempre procesar
        if (exceptionCode === '67') {
          console.log(`🚨 CÓDIGO 67 - Sin validación de frescura, siempre procesar`);
          return true;
        }
        
        // Relajar validación para ENTREGADO y código 03
        if (toStatus === ShipmentStatusType.ENTREGADO || exceptionCode === '03') {
          console.log(`✅ Validación relajada para ${exceptionCode === '03' ? 'código 03' : 'ENTREGADO'}`);
          return true;
        }
        
        if (!shipment.statusHistory || shipment.statusHistory.length === 0) {
          console.log(`✅ No hay historial previo`);
          return true;
        }
        
        const latestStatusHistory = shipment.statusHistory.reduce((latest, current) => {
          return new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest;
        }, shipment.statusHistory[0]);
        
        console.log(`📋 Último estado en historial:`);
        console.log(`   - Estado: ${latestStatusHistory.status}`);
        console.log(`   - Timestamp: ${latestStatusHistory.timestamp}`);
        console.log(`   - Exception Code: ${latestStatusHistory.exceptionCode || 'N/A'}`);
        
        const isNewer = new Date(eventDate) > new Date(latestStatusHistory.timestamp);
        console.log(`✅ ¿Evento es más reciente? ${eventDate.toISOString()} > ${latestStatusHistory.timestamp.toISOString()} = ${isNewer ? 'SÍ' : 'NO'}`);
        
        return isNewer;
      }

      private getDefaultSubsidiaryRules() {
        return {
          allowedExceptionCodes: ['07', '03', '08', '17', '67', '14', '16', 'OD'],
          allowedStatuses: Object.values(ShipmentStatusType),
          maxEventAgeDays: 30,
          allowDuplicateStatuses: true, // Cambiar a true para permitir duplicados (especial para 67)
          allowedEventTypes: ['DL', 'DE', 'DU', 'RF', 'TA', 'TD', 'HL', 'OC', 'IT', 'AR', 'AF', 'CP', 'CC', 'PU', 'OW'], // Agregar OW
          noIncomeExceptionCodes: ['03'],
          notFoundExceptionCodes: [],
          minEvents08: 3,
          allowException03: true,
          allowException16: false,
          allowExceptionOD: false,
          allowIncomeFor07: true,
          allowIncomeFor67: false, // Los códigos 67 generalmente no generan ingresos
          alwaysProcess67: true, // Nueva regla: siempre procesar código 67
        };
      }

      private validateEventAgainstRules(
        latestEvent: any,
        exceptionCode: string,
        mappedStatus: ShipmentStatusType,
        rules: any,
        subsidiaryId: string,
        trackingNumber: string,
        shipmentId: string
      ): { isValid: boolean; reason?: string; isUnusualCode?: boolean } {
        // Verificar exceptionCode permitido (excepto para ENTREGADO)
        if (exceptionCode && 
            !rules.allowedExceptionCodes.includes(exceptionCode) && 
            mappedStatus !== ShipmentStatusType.ENTREGADO) {
          
          // Permitir códigos especiales
          if (exceptionCode === '03' && rules.allowException03) {
            return { isValid: true };
          }
          
          if (exceptionCode === '67' && rules.alwaysProcess67) {
            console.log(`🚨 CÓDIGO 67 - Validación especial, siempre permitido`);
            return { isValid: true };
          }
          
          return {
            isValid: false,
            reason: `exceptionCode=${exceptionCode} no permitido para sucursal ${subsidiaryId}`,
            isUnusualCode: true
          };
        }

        // Verificar estado permitido
        if (!rules.allowedStatuses.includes(mappedStatus) && mappedStatus !== ShipmentStatusType.ENTREGADO) {
          return {
            isValid: false,
            reason: `Estatus ${mappedStatus} no permitido para sucursal ${subsidiaryId}`,
            isUnusualCode: true
          };
        }

        // Verificar si hay evento válido para el estado mapeado
        const hasValidEvent = this.hasValidEventForStatus(
          latestEvent,
          mappedStatus,
          exceptionCode,
          rules
        );

        if (!hasValidEvent) {
          return {
            isValid: false,
            reason: `No se encontró evento válido para el estatus ${mappedStatus} (exceptionCode=${exceptionCode})`
          };
        }

        return { isValid: true };
      }

      private hasValidEventForStatus(
        latestEvent: any,
        mappedStatus: ShipmentStatusType,
        exceptionCode: string,
        rules: any
      ): boolean {
        console.log(`\n🎯 === VALIDANDO EVENTO PARA ESTADO ===`);
        console.log(`Event Type: ${latestEvent.eventType}`);
        console.log(`Mapped Status: ${mappedStatus}`);
        console.log(`Exception Code: ${exceptionCode}`);
        console.log(`Allowed Event Types: ${rules.allowedEventTypes.join(', ')}`);
        
        // Para código 67, siempre considerarlo como evento válido para EN_RUTA
        if (exceptionCode === '67') {
          console.log(`✅ Código 67 siempre válido para EN_RUTA`);
          return true;
        }

        // Para ENTREGADO
        if (mappedStatus === ShipmentStatusType.ENTREGADO && 
            (latestEvent.eventType === 'DL' || latestEvent.derivedStatusCode === 'DL')) {
          console.log(`✅ Evento DL válido para ENTREGADO`);
          return true;
        }

        // Para NO_ENTREGADO
        if (mappedStatus === ShipmentStatusType.NO_ENTREGADO && 
            ['DE', 'DU', 'RF', 'TD', 'TA'].includes(latestEvent.eventType)) {
          console.log(`✅ Evento ${latestEvent.eventType} válido para NO_ENTREGADO`);
          return true;
        }

        // Para EN_RUTA (incluyendo código 67 y OW)
        if (mappedStatus === ShipmentStatusType.EN_RUTA && 
            (['OC', 'IT', 'AR', 'AF', 'CP', 'CC', 'OW'].includes(latestEvent.eventType) || 
            exceptionCode === '67')) {
          console.log(`✅ Evento ${latestEvent.eventType} válido para EN_RUTA`);
          return true;
        }

        // Para otros estados
        if ((mappedStatus === ShipmentStatusType.PENDIENTE && ['HL'].includes(latestEvent.eventType)) ||
            (mappedStatus === ShipmentStatusType.RECOLECCION && ['PU'].includes(latestEvent.eventType))) {
          console.log(`✅ Evento ${latestEvent.eventType} válido para ${mappedStatus}`);
          return true;
        }

        // Permitir códigos de excepción específicos
        if ((exceptionCode === '03' && rules.allowException03) ||
            (exceptionCode === '07')) {
          console.log(`✅ Exception code ${exceptionCode} válido`);
          return true;
        }

        console.log(`❌ Evento NO válido para el estado`);
        return false;
      }

      private adjustStatusBasedOnRules(
        mappedStatus: ShipmentStatusType,
        exceptionCode: string,
        rules: any,
        trackingNumber: string
      ): ShipmentStatusType {
        let toStatus = mappedStatus;

        // Manejo específico para código 03
        if (exceptionCode === '03' && rules.allowException03) {
          this.logger.debug(`Procesando exceptionCode 03 para ${trackingNumber}, asignando estatus NO_ENTREGADO`);
          toStatus = ShipmentStatusType.NO_ENTREGADO;
        }

        // Forzar EN_RUTA para código 67
        if (exceptionCode === '67' && toStatus !== ShipmentStatusType.EN_RUTA) {
          this.logger.debug(`Código 67 detectado para ${trackingNumber}, forzando EN_RUTA`);
          toStatus = ShipmentStatusType.EN_RUTA;
        }

        return toStatus;
      }

      private async updateReceivedByNameIfNeeded(
        shipment: Shipment,
        latestStatusDetail: any,
        trackingNumber: string,
        shouldPersist: boolean,
        shipmentsWithError: any[]
      ): Promise<void> {
        if (shouldPersist && 
            latestStatusDetail?.deliveryDetails?.receivedByName && 
            latestStatusDetail.deliveryDetails.receivedByName !== shipment.receivedByName) {
          
          try {
            await this.shipmentRepository.manager.transaction(async (em) => {
              await em.update(
                Shipment, 
                { id: shipment.id }, 
                { receivedByName: latestStatusDetail.deliveryDetails.receivedByName }
              );
              this.logger.debug(`Actualizado receivedByName para ${trackingNumber} (shipmentId=${shipment.id}) sin cambio de estado`);
            });
          } catch (err) {
            const reason = `Error al actualizar receivedByName para ${trackingNumber}: ${err.message}`;
            this.logger.error(reason);
            shipmentsWithError.push({ trackingNumber, reason, shipmentId: shipment.id });
          }
        }
      }

      private async persistShipmentChanges(
        shipment: Shipment,
        trackingNumber: string,
        toStatus: ShipmentStatusType,
        latestEvent: any,
        latestStatusDetail: any,
        exceptionCode: string,
        eventDate: Date,
        representativeShipment: Shipment,
        rules: any,
        results: any
      ): Promise<void> {
        try {
          this.logger.debug(`=== INTENTANDO PERSISTIR CAMBIOS PARA ${trackingNumber} ===`);
          this.logger.debug(`Shipment ID: ${shipment.id}`);
          this.logger.debug(`From Status: ${shipment.status}`);
          this.logger.debug(`To Status: ${toStatus}`);
          this.logger.debug(`Exception Code: ${exceptionCode}`);
          this.logger.debug(`Event Date: ${eventDate.toISOString()}`);
          this.logger.debug(`Event Type: ${latestEvent.eventType}`);
          this.logger.debug(`Event Description: ${latestEvent.eventDescription}`);
          this.logger.debug(`Latest Status Detail: ${JSON.stringify(latestStatusDetail, null, 2)}`);
          this.logger.debug(`Representative Shipment ID: ${representativeShipment.id}`);
          this.logger.debug(`Rules allowIncomeFor67: ${rules.allowIncomeFor67}`);

          // Crear nuevo estado de shipment
          this.logger.debug(`Creando nuevo ShipmentStatus...`);
          const newShipmentStatus = new ShipmentStatus();
          newShipmentStatus.status = toStatus;
          newShipmentStatus.timestamp = eventDate;
          newShipmentStatus.notes = latestStatusDetail?.ancillaryDetails?.[0]
            ? `${latestStatusDetail.ancillaryDetails[0].reason} - ${latestStatusDetail.ancillaryDetails[0].actionDescription}`
            : `${latestEvent.eventType} - ${latestEvent.eventDescription}`;
          newShipmentStatus.exceptionCode = exceptionCode;
          newShipmentStatus.shipment = shipment;

          this.logger.debug(`ShipmentStatus creado:`, {
            status: newShipmentStatus.status,
            timestamp: newShipmentStatus.timestamp,
            notes: newShipmentStatus.notes,
            exceptionCode: newShipmentStatus.exceptionCode,
            shipmentId: shipment.id
          });

          // Actualizar shipment
          const previousStatus = shipment.status;
          shipment.status = toStatus;
          shipment.statusHistory = shipment.statusHistory || [];
          shipment.statusHistory.push(newShipmentStatus);
          
          const newReceivedByName = latestStatusDetail?.deliveryDetails?.receivedByName;
          if (newReceivedByName && newReceivedByName !== shipment.receivedByName) {
            this.logger.debug(`Actualizando receivedByName de '${shipment.receivedByName}' a '${newReceivedByName}'`);
            shipment.receivedByName = newReceivedByName;
          }

          // Actualizar estado de pago si aplica
          if (shipment.payment) {
            const previousPaymentStatus = shipment.payment.status;
            shipment.payment.status = toStatus === ShipmentStatusType.ENTREGADO ? PaymentStatus.PAID : PaymentStatus.PENDING;
            this.logger.debug(`Actualizado payment.status de ${previousPaymentStatus} a ${shipment.payment.status}`);
          }

          // Validar si se debe generar ingreso
          this.logger.debug(`Validando si se debe generar ingreso...`);
          const shouldGenerateIncome = this.shouldGenerateIncome(
            toStatus,
            exceptionCode,
            shipment,
            representativeShipment,
            rules
          );
          
          this.logger.debug(`shouldGenerateIncome: ${shouldGenerateIncome}`);
          this.logger.debug(`toStatus: ${toStatus}, exceptionCode: ${exceptionCode}`);
          this.logger.debug(`shipment.id === representativeShipment.id: ${shipment.id === representativeShipment.id}`);

          let incomeValidationResult: IncomeValidationResult = { isValid: true, timestamp: eventDate };

          if (shouldGenerateIncome) {
            this.logger.debug(`Iniciando validación de generación de ingreso...`);
            incomeValidationResult = await this.validateIncomeGeneration(
              shipment,
              toStatus,
              exceptionCode,
              trackingNumber,
              eventDate
            );
            this.logger.debug(`Resultado validación ingreso: ${incomeValidationResult.isValid ? 'VÁLIDO' : 'INVÁLIDO'}`);
            if (!incomeValidationResult.isValid) {
              this.logger.debug(`Razón: ${incomeValidationResult.reason}`);
            }
          }

          this.logger.debug(`ANTES DE TRANSACCIÓN - ShipmentStatus a crear:`, {
            status: toStatus,
            timestamp: eventDate,
            exceptionCode,
            shipmentId: shipment.id,
            notes: newShipmentStatus.notes
          });

          this.logger.debug(`ANTES DE TRANSACCIÓN - Shipment a actualizar:`, {
            id: shipment.id,
            previousStatus,
            newStatus: toStatus,
            receivedByName: shipment.receivedByName,
            paymentStatus: shipment.payment?.status
          });

          // Persistir en transacción
          await this.shipmentRepository.manager.transaction(async (em) => {
            this.logger.debug(`=== DENTRO DE TRANSACCIÓN - Iniciando persistencia ===`);
            
            try {
              this.logger.debug(`Guardando ShipmentStatus...`);
              const savedStatus = await em.save(ShipmentStatus, newShipmentStatus);
              this.logger.debug(`ShipmentStatus guardado con ID: ${savedStatus.id}`);
              this.logger.debug(`ShipmentStatus detalles:`, savedStatus);

              this.logger.debug(`Actualizando Shipment en base de datos...`);
              const updateResult = await em
                .createQueryBuilder()
                .update(Shipment)
                .set({
                  status: shipment.status,
                  receivedByName: shipment.receivedByName,
                  payment: shipment.payment,
                })
                .where('id = :id', { id: shipment.id })
                .execute();
              
              this.logger.debug(`Update Shipment resultado:`, {
                affected: updateResult.affected,
                raw: updateResult.raw
              });

              // Actualizar payment si existe
              if (shipment.payment) {
                this.logger.debug(`Actualizando Payment...`);
                await em.save(shipment.payment);
                this.logger.debug(`Payment actualizado: ${shipment.payment.id}`);
              }

              // Generar ingreso si es válido
              if (shouldGenerateIncome && 
                  incomeValidationResult.isValid && 
                  shipment.id === representativeShipment.id) {
                
                this.logger.debug(`=== GENERANDO INGRESO PARA ${trackingNumber} ===`);
                this.logger.debug(`Estado: ${toStatus}, Exception Code: ${exceptionCode}`);
                this.logger.debug(`Timestamp: ${incomeValidationResult.timestamp}`);
                
                try {
                  await this.generateIncomes(
                    shipment, 
                    incomeValidationResult.timestamp, 
                    newShipmentStatus.exceptionCode, 
                    em
                  );
                  
                  this.logger.debug(`Ingreso generado exitosamente para ${trackingNumber}`);
                
                } catch (incomeError) {
                  this.logger.error(`ERROR generando ingreso para ${trackingNumber}:`, {
                    error: incomeError.message,
                    stack: incomeError.stack
                  });
                  throw incomeError;
                }
              
              } else if (shouldGenerateIncome && !incomeValidationResult.isValid) {
                
                this.logger.debug(`Registrando fallo de validación de ingreso para ${trackingNumber}`);
                results.shipmentsWithInvalidIncome.push({
                  trackingNumber,
                  eventDate: eventDate.toISOString(),
                  shipmentId: shipment.id
                });
                
                this.logger.warn(`No se generó ingreso para ${trackingNumber}: ${incomeValidationResult.reason ?? 'Validación fallida'}`);
              }

              this.logger.debug(`=== TRANSACCIÓN COMPLETADA EXITOSAMENTE PARA ${trackingNumber} ===`);
              
            } catch (transactionError) {
              this.logger.error(`ERROR DENTRO DE TRANSACCIÓN para ${trackingNumber}:`, {
                error: transactionError.message,
                stack: transactionError.stack,
                shipmentId: shipment.id,
                exceptionCode
              });
              throw transactionError;
            }
          });

          this.logger.debug(`=== CAMBIOS PERSISTIDOS EXITOSAMENTE PARA ${trackingNumber} ===`);
          this.logger.debug(`Estado actualizado de ${previousStatus} a ${toStatus}`);
          this.logger.debug(`Exception Code procesado: ${exceptionCode}`);
          this.logger.debug(`Nuevo ShipmentStatus creado para shipment ${shipment.id}`);

        } catch (error) {
          this.logger.error(`ERROR en persistShipmentChanges para ${trackingNumber}:`, {
            error: error.message,
            stack: error.stack,
            shipmentId: shipment.id,
            toStatus,
            exceptionCode,
            eventDate: eventDate.toISOString()
          });
          throw new Error(`Error al persistir cambios para ${trackingNumber}: ${error.message}`);
        }
      }

      private shouldGenerateIncome(
        toStatus: ShipmentStatusType,
        exceptionCode: string,
        shipment: Shipment,
        representativeShipment: Shipment,
        rules: any
      ): boolean {
        this.logger.debug(`=== VALIDANDO GENERACIÓN DE INGRESO ===`);
        this.logger.debug(`toStatus: ${toStatus}`);
        this.logger.debug(`exceptionCode: ${exceptionCode}`);
        this.logger.debug(`shipment.id: ${shipment.id}`);
        this.logger.debug(`representativeShipment.id: ${representativeShipment.id}`);
        this.logger.debug(`allowIncomeFor67: ${rules.allowIncomeFor67}`);
        this.logger.debug(`noIncomeExceptionCodes: ${JSON.stringify(rules.noIncomeExceptionCodes)}`);

        // No generar ingreso si es código 67 (configurable en reglas)
        if (exceptionCode === '67' && !rules.allowIncomeFor67) {
          this.logger.debug(`NO generará ingreso: código 67 con allowIncomeFor67=${rules.allowIncomeFor67}`);
          return false;
        }

        // No generar ingreso para códigos de no ingreso
        if (rules.noIncomeExceptionCodes.includes(exceptionCode)) {
          this.logger.debug(`NO generará ingreso: exceptionCode ${exceptionCode} está en noIncomeExceptionCodes`);
          return false;
        }

        // Verificar si es el shipment representativo
        const isRepresentative = shipment.id === representativeShipment.id;
        this.logger.debug(`Es shipment representativo: ${isRepresentative}`);

        // Condiciones para generar ingreso
        const isEligibleStatus = [ShipmentStatusType.ENTREGADO, ShipmentStatusType.NO_ENTREGADO].includes(toStatus);
        const isException07 = exceptionCode === '07' && rules.allowIncomeFor07;
        const isException67 = exceptionCode === '67' && rules.allowIncomeFor67;
        
        this.logger.debug(`isEligibleStatus (ENTREGADO/NO_ENTREGADO): ${isEligibleStatus}`);
        this.logger.debug(`isException07: ${isException07}`);
        this.logger.debug(`isException67: ${isException67}`);

        const shouldGenerate = (
          isEligibleStatus ||
          isException07 ||
          isException67
        ) && isRepresentative;

        this.logger.debug(`RESULTADO shouldGenerateIncome: ${shouldGenerate}`);
        return shouldGenerate;
      }

      private async validateIncomeGeneration(
        shipment: Shipment,
        toStatus: ShipmentStatusType,
        exceptionCode: string,
        trackingNumber: string,
        eventDate: Date
      ): Promise<IncomeValidationResult> {
        try {
          this.logger.debug(`=== VALIDANDO GENERACIÓN DE INGRESO DETALLADO ===`);
          this.logger.debug(`Tracking: ${trackingNumber}`);
          this.logger.debug(`Shipment ID: ${shipment.id}`);
          this.logger.debug(`To Status: ${toStatus}`);
          this.logger.debug(`Exception Code: ${exceptionCode}`);

          // Obtener todos los exception codes del historial
          const exceptionCodes = shipment.statusHistory
            .map(h => h.exceptionCode)
            .filter(Boolean)
            .concat(exceptionCode ? [exceptionCode] : []);

          this.logger.debug(`Exception codes acumulados: ${exceptionCodes.join(', ')}`);
          this.logger.debug(`Número de statusHistory: ${shipment.statusHistory.length}`);

          this.logger.debug(`Llamando a applyIncomeValidationRules...`);
          const result = await this.applyIncomeValidationRules(
            shipment,
            toStatus,
            exceptionCodes,
            shipment.statusHistory || [],
            trackingNumber,
            eventDate
          );

          this.logger.debug(`Resultado de applyIncomeValidationRules:`, {
            isValid: result.isValid,
            reason: result.reason,
            timestamp: result.timestamp
          });

          return result;

        } catch (error) {
          this.logger.error(`ERROR en validación de ingreso para ${trackingNumber}:`, {
            error: error.message,
            stack: error.stack,
            shipmentId: shipment.id
          });
          return { 
            isValid: false, 
            timestamp: eventDate, 
            reason: `Error en validación: ${error.message}` 
          };
        }
      }

      private formatDate(date: Date): string {
        return format(date, 'yyyy-MM-dd HH:mm:ss');
      }

      private logFinalStats(results: any): void {
        this.logger.log(`Proceso finalizado:
          - ${results.updatedShipments.length} envíos actualizados
          - ${results.shipmentsWithError.length} errores
          - ${results.unusualCodes.length} códigos inusuales
          - ${results.shipmentsWithOD.length} excepciones OD
          - ${results.shipmentsWithInvalidIncome.length} fallos de validación de ingresos
          - ${results.forPickUpShipments.length} envíos ForPickUp`);
      }

    /******************************************************************* */


    /****** REPORTE DE PENDIENTE X SUCURSAL */
    private formatToHermosillo(date: Date | string | null): string {
      if (!date) return '';

      return new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Hermosillo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(date));
    }

    async generatePendingShipmentsExcel(
      shipments: Shipment[]
    ): Promise<Buffer> {

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Pendientes');

      /* ===================== Columnas ===================== */

      worksheet.columns = [
        { header: 'Tracking', key: 'trackingNumber', width: 18 },
        { header: 'Estado', key: 'status', width: 14 },
        { header: 'Prioridad', key: 'priority', width: 12 },
        { header: 'Fecha compromiso', key: 'commitDateTime', width: 22 },
        { header: 'Destinatario', key: 'recipientName', width: 26 },
        { header: 'Dirección', key: 'recipientAddress', width: 30 },
        { header: 'Ciudad', key: 'recipientCity', width: 18 },
        { header: 'CP', key: 'recipientZip', width: 10 },
        { header: 'Teléfono', key: 'recipientPhone', width: 16 },
        { header: 'Recibido por', key: 'receivedByName', width: 22 },
        { header: 'Consolidado', key: 'consolidatedId', width: 36 },
        { header: 'Alto valor', key: 'isHighValue', width: 12 },
        { header: 'Creado', key: 'createdAt', width: 22 }
      ];

      /* ===================== Header elegante ===================== */

      worksheet.getRow(1).eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1E293B' } // slate-800
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      /* ===================== Data ===================== */

      shipments.forEach(s => {
        worksheet.addRow({
          trackingNumber: s.trackingNumber,
          status: s.status,
          priority: s.priority,
          commitDateTime: this.formatToHermosillo(s.commitDateTime),
          recipientName: s.recipientName,
          recipientAddress: s.recipientAddress,
          recipientCity: s.recipientCity,
          recipientZip: s.recipientZip,
          recipientPhone: s.recipientPhone,
          receivedByName: s.receivedByName,
          consolidatedId: s.consolidatedId,
          isHighValue: s.isHighValue ? 'Sí' : 'No',
          createdAt: this.formatToHermosillo(s.createdAt),
        });
      });

      /* ===================== Estilo filas ===================== */

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell(cell => {
          cell.border = {
            top: { style: 'hair' },
            left: { style: 'hair' },
            bottom: { style: 'hair' },
            right: { style: 'hair' }
          };
          cell.alignment = { vertical: 'middle' };
        });
      });

      worksheet.views = [{ state: 'frozen', ySplit: 1 }];

      const arrayBuffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(arrayBuffer);  
    }


    async getPendingShipmentsBySubsidiaryResp(subsidiaryId: string, startDate: string, endDate: string): Promise<{ count: number, shipments: Shipment[] }> {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // Incluir todo el día final

      const shipments = await this.shipmentRepository.find({
        where: {
          subsidiary: { id: subsidiaryId },  
          status: In([ShipmentStatusType.EN_RUTA, ShipmentStatusType.PENDIENTE, ShipmentStatusType.DESCONOCIDO]),
          createdAt: Between(start, end),
        },
      }); 

      console.log(`🔍 Envíos pendientes encontrados para sucursal ${subsidiaryId} entre ${this.formatDate(start)} y ${this.formatDate(end)}: ${shipments.length}`);

      return { 
        count: shipments.length,  
        shipments 
      };
    }

    async getPendingShipmentsBySubsidiary(
      subsidiaryId: string, 
      /*startDate: string, 
      endDate: string*/
    ): Promise<{ count: number, shipments: Shipment[] }> {
      /*const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);*/

      // SUBCONSULTA: Obtener el ID más reciente por tracking number
      const subQuery = this.shipmentRepository
        .createQueryBuilder('s2')
        .select('MAX(s2.id)', 'max_id') // Usar ID máximo como proxy de más reciente
        .addSelect('s2.trackingNumber', 'tracking_number')
        .where('s2.subsidiaryId = :subsidiaryId', { subsidiaryId })
        //.andWhere('s2.createdAt BETWEEN :start AND :end', { start, end })
        .groupBy('s2.trackingNumber')
        .getQuery();

      // SUBCONSULTA: Tracking numbers que tienen entregados (para excluir)
      const deliveredSubQuery = this.shipmentRepository
        .createQueryBuilder('s3')
        .select('DISTINCT s3.trackingNumber', 'tracking_number')
        .where('s3.subsidiaryId = :subsidiaryId', { subsidiaryId })
        //.andWhere('s3.createdAt BETWEEN :start AND :end', { start, end })
        .andWhere('s3.status IN (:...deliveredStatuses)', {
          deliveredStatuses: ['ENTREGADO', 'ENTREGADA']
        })
        .getQuery();

      // QUERY PRINCIPAL
      const shipments = await this.shipmentRepository
        .createQueryBuilder('s')
        .innerJoin(
          `(${subQuery})`,
          'latest',
          's.trackingNumber = latest.tracking_number AND s.id = latest.max_id'
        )
        .where('s.subsidiaryId = :subsidiaryId', { subsidiaryId })
        //.andWhere('s.createdAt BETWEEN :start AND :end', { start, end })
        .andWhere(`s.trackingNumber NOT IN (${deliveredSubQuery})`)
        .andWhere('s.status IN (:...pendingStatuses)', {
          pendingStatuses: [
            'EN_RUTA',
            'PENDIENTE', 
            'DESCONOCIDO',
            /*'EN_BODEGA',
            'RECHAZADO',
            'NO_ENTREGADO'*/
          ]
        })
        .setParameters({
          subsidiaryId,
          /*start,
          end,*/
          deliveredStatuses: ['ENTREGADO', 'ENTREGADA'],
          pendingStatuses: ['EN_RUTA', 'PENDIENTE', 'DESCONOCIDO', 'EN_BODEGA'/*, 'RECHAZADO', 'NO_ENTREGADO'*/]
        })
        .orderBy('s.recipientZip', 'ASC')
        .getMany();

      console.log(`📊 Envíos pendientes únicos: ${shipments.length}`);

      return {
        count: shipments.length,
        shipments
      };
    }

    async getPendingShipmentsExcel(
      subsidiaryId: string,
      /*startDate: string,
      endDate: string*/
    ): Promise<Buffer> {

      const { shipments } =
        await this.getPendingShipmentsBySubsidiary(
          subsidiaryId,
          /*startDate,
          endDate*/
        );

      return this.generatePendingShipmentsExcel(shipments);
    }


    /************************************** */


    /************ (ACTIVO) NUEVO METODO PARA CHECK STATUS ON FEDEX 20-01-2026*/
    
      private SUBSIDIARY_CONFIG = {
        'abf2fc38-cb42-41b6-9554-4b71c11b8916': { // Cabo San Lucas
          trackExternalDelivery: true,
          forceFedexStatus: true
        }
      };

      async processMasterFedexUpdateResp1302(shipmentsToUpdate: Shipment[]) {
        this.logger.log(`💎 Master Update (Titanium): Procesando ${shipmentsToUpdate.length} guías con Garantía Total...`);

        // 1. Agrupación por Tracking (Evita procesar la misma guía 2 veces en el mismo ciclo)
        const shipmentsByTracking = shipmentsToUpdate.reduce((acc, s) => {
          if (!acc[s.trackingNumber]) acc[s.trackingNumber] = [];
          acc[s.trackingNumber].push(s.id);
          return acc;
        }, {} as Record<string, string[]>);

        const uniqueTrackingNumbers = Object.keys(shipmentsByTracking);
        const limit = pLimit(10); // Concurrencia controlada

        const tasks = uniqueTrackingNumbers.map((tn) => limit(async () => {
          const shipmentWithId = shipmentsToUpdate.find(s => s.trackingNumber === tn && s.fedexUniqueId);
          const currentUniqueId = shipmentWithId?.fedexUniqueId;

          // --- 1. OBTENCIÓN DE LA VERDAD (FEDEX) ---
          let fedexInfo;
          try {
            fedexInfo = await this.fedexService.trackPackage(tn, currentUniqueId);
          } catch (error) {
            this.logger.error(`[${tn}] Error API FedEx: ${error.message}`);
            return;
          }

          const allTrackResults = fedexInfo?.output?.completeTrackResults?.[0]?.trackResults || [];
          if (allTrackResults.length === 0) return; // FedEx no sabe nada

          // Filtro de Seguridad (6 meses)
          const validResults = allTrackResults.filter(result => {
            if (!result.scanEvents?.length) return true;
            const dates = result.scanEvents.map(e => new Date(e.date).getTime());
            return Math.max(...dates) > (Date.now() - (180 * 24 * 60 * 60 * 1000));
          });
          if (validResults.length === 0) return;

          const trackResult = validResults[0]; 
          let mergedScanEvents = validResults.flatMap(r => r.scanEvents || []);

          if (!mergedScanEvents || mergedScanEvents.length === 0) return;

          // ORDENAMIENTO CRÍTICO: Del más NUEVO (índice 0) al más VIEJO
          mergedScanEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          // --- 2. INICIO DE TRANSACCIÓN BLINDADA ---
          const queryRunner = this.dataSource.createQueryRunner();
          await queryRunner.connect();
          await queryRunner.startTransaction();

          try {
            const targetIds = shipmentsByTracking[tn];
            
            // BLOQUEO DE ESCRITURA: Nadie más toca estas guías mientras calculo
            const shipmentList = await queryRunner.manager.find(Shipment, {
              where: { id: In(targetIds) },
              relations: ['subsidiary'],
              lock: { mode: 'pessimistic_write' }
            });

            if (shipmentList.length === 0) {
                 await queryRunner.commitTransaction();
                 return;
            }

            // Contexto y Configuración
            const subId = shipmentList[0].subsidiary?.id?.toLowerCase() || '';
            const configKeys = Object.keys(this.SUBSIDIARY_CONFIG);
            const matchedKey = configKeys.find(key => key.toLowerCase() === subId);
            const subConfig = matchedKey ? this.SUBSIDIARY_CONFIG[matchedKey] : { trackExternalDelivery: false };

            // Estado Actual en Base de Datos (La "Foto" actual)
            const lastHistory = await queryRunner.manager.query(
              `SELECT status, exceptionCode, timestamp FROM shipment_status WHERE shipmentId = ? ORDER BY timestamp DESC LIMIT 1`,
              [shipmentList[0].id]
            );

            const dbStatus = lastHistory.length ? lastHistory[0].status : null;
            const dbTimestamp = lastHistory.length ? new Date(lastHistory[0].timestamp).getTime() : 0;
            const dbException = lastHistory.length ? (lastHistory[0].exceptionCode || '').trim() : '';
            const dbIsFinal = (dbStatus === ShipmentStatusType.ENTREGADO);

            // --- 3. CÁLCULO DEL "ESTADO OBJETIVO" (LA VERDAD DE FEDEX) ---
            // Aquí aplicamos TODAS tus reglas de negocio antes de decidir si guardar.
            
            let foundDelivered = false;
            let count08 = 0;
            const hasOD = mergedScanEvents.some(e => e.eventType === 'OD');

            // Barrido para banderas lógicas
            for (const event of mergedScanEvents) {
                const dCode = event.derivedStatusCode || '';
                const eCode = (event.exceptionCode || '').trim();
                const mapped = mapFedexStatusToLocalStatus(dCode, eCode);
                
                if (mapped === ShipmentStatusType.ENTREGADO) foundDelivered = true;
                if (eCode === '08') count08++;
            }

            // Análisis del evento más reciente (La punta de la lanza)
            const latestEvent = mergedScanEvents[0];
            const latestEx = (latestEvent.exceptionCode || '').trim();
            const latestCode = latestEvent.derivedStatusCode || '';
            let targetStatus = mapFedexStatusToLocalStatus(latestCode, latestEx);

            // A. Validador de Enum (Anti-Crash)
            const validValues = Object.values(ShipmentStatusType);
            if (!validValues.includes(targetStatus)) {
                this.logger.warn(`[${tn}] Estatus desconocido '${targetStatus}'. Usando DESCONOCIDO.`);
                targetStatus = ShipmentStatusType.DESCONOCIDO;
            }

            // =================================================================
            // 🧠 LÓGICA DE NEGOCIO CORREGIDA (REGLA DE SUPREMACÍA + OD)
            // =================================================================
            
            if (foundDelivered) {
                // CASO 1: YA SE ENTREGÓ (Hito Final)
                targetStatus = ShipmentStatusType.ENTREGADO;
                
                // Si fue externo, corregimos AHORA MISMO a Entregado por FedEx
                if (subConfig.trackExternalDelivery && hasOD) {
                    targetStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                }
            } else {
                // CASO 2: AÚN ESTÁ EN CAMINO (O Problemas)
                
                // Reglas de Terceros (OD) - ¡ACTÚA DE INMEDIATO!
                // No esperamos a que se entregue. Si vemos OD, cambiamos el estatus YA.
                if (subConfig.trackExternalDelivery && hasOD) {
                    const isCritical = [
                        ShipmentStatusType.RECHAZADO, 
                        ShipmentStatusType.DEVUELTO_A_FEDEX,
                        ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
                        ShipmentStatusType.DIRECCION_INCORRECTA
                    ].includes(targetStatus as any);

                    // Si no es un problema crítico, es "A Cargo de FedEx"
                    if (!isCritical) {
                        targetStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                    }
                }
            }

            // --- 4. DECISIÓN DE ACTUALIZACIÓN (EL CEREBRO) ---
            const targetDate = new Date(latestEvent.date);
            const targetException = latestEx;
            const targetDescription = latestEvent.eventDescription || trackResult.latestStatusDetail?.description || 'Update';

            // Detección de Cambios (Comparación Estricta)
            const isSameStatus = dbStatus === targetStatus;
            const isSameException = dbException === targetException;
            // Margen de tolerancia de 2 segundos para evitar duplicados por latencia
            const isSameTime = Math.abs(targetDate.getTime() - dbTimestamp) < 2000; 

            // Lógica de Bloqueo (Iron Locks)
            let isLocked = false;

            // Lock 1: Entregado es Final (A menos que sea corrección a Entregado por FedEx)
            if (dbIsFinal && targetStatus !== ShipmentStatusType.ENTREGADO && targetStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
                isLocked = true;
            }

            // Lock 2: Devolución es Semi-Final (Solo sale a Entregado, Rechazado o Error)
            if ((dbStatus === ShipmentStatusType.DEVUELTO_A_FEDEX || dbStatus === ShipmentStatusType.RETORNO_ABANDONO_FEDEX) && !isLocked) {
                 const allowed = [
                    ShipmentStatusType.ENTREGADO, ShipmentStatusType.ENTREGADO_POR_FEDEX,
                    ShipmentStatusType.RECHAZADO, ShipmentStatusType.DIRECCION_INCORRECTA,
                    ShipmentStatusType.CLIENTE_NO_DISPONIBLE, ShipmentStatusType.DEVUELTO_A_FEDEX, 
                    ShipmentStatusType.RETORNO_ABANDONO_FEDEX
                 ];
                 if (!allowed.includes(targetStatus)) isLocked = true;
            }

            // ¿Debemos Actualizar?
            const shouldUpdateHistory = !isLocked && (!isSameStatus || !isSameException || !isSameTime);
            
            // A veces el shipment queda desfasado del historial, forzamos update del shipment si no coincide
            const shouldUpdateShipment = !isLocked && (shipmentList[0].status !== targetStatus);

            const newUniqueId = trackResult.trackingNumberInfo?.trackingNumberUniqueId;
            const needsUniqueIdUpdate = newUniqueId && !currentUniqueId;


            // --- 5. EJECUCIÓN DE CAMBIOS (GARANTÍA DE DATOS) ---
            if (shouldUpdateHistory || shouldUpdateShipment || needsUniqueIdUpdate) {
                
                for (const shipment of shipmentList) {
                    // A. Historial (Solo si es nuevo evento)
                    if (shouldUpdateHistory) {
                        const historyEntry = queryRunner.manager.create(ShipmentStatus, {
                            status: targetStatus,
                            exceptionCode: targetException,
                            timestamp: targetDate,
                            shipment: shipment,
                            notes: targetDescription
                        });
                        await queryRunner.manager.save(historyEntry);
                    }

                    // B. Actualización de Shipment (Siempre que no coincida con la verdad)
                    let hasShipmentChanges = false;
                    if (shipment.status !== targetStatus && !isLocked) {
                        shipment.status = targetStatus as any;
                        hasShipmentChanges = true;
                    }

                    // Datos extra de entrega
                    if ((targetStatus === ShipmentStatusType.ENTREGADO || targetStatus === ShipmentStatusType.ENTREGADO_POR_FEDEX) 
                        && trackResult.deliveryDetails?.receivedByName && shipment.receivedByName !== trackResult.deliveryDetails.receivedByName) {
                        shipment.receivedByName = trackResult.deliveryDetails.receivedByName;
                        hasShipmentChanges = true;
                    }

                    // Unique ID
                    if (needsUniqueIdUpdate && !shipment.fedexUniqueId) {
                        shipment.fedexUniqueId = newUniqueId;
                        hasShipmentChanges = true;
                    }

                    if (hasShipmentChanges) {
                        await queryRunner.manager.save(Shipment, shipment);

                        // C. Sincronización de Cargos (ChargeShipment)
                        const charges = await queryRunner.manager.find(ChargeShipment, { where: { trackingNumber: tn } });
                        for (const c of charges) {
                            let chargeChanged = false;
                            if (c.status !== targetStatus as any) {
                                c.status = targetStatus as any;
                                chargeChanged = true;
                            }
                            if (trackResult.deliveryDetails?.receivedByName && c.receivedByName !== trackResult.deliveryDetails.receivedByName) {
                                c.receivedByName = trackResult.deliveryDetails.receivedByName;
                                chargeChanged = true;
                            }
                            if (chargeChanged) await queryRunner.manager.save(ChargeShipment, c);
                        }
                    }
                }
            }

            // --- 6. GARANTÍA DE INGRESOS (EL COBRADOR INFALIBLE) ---
            // Esta lógica corre SIEMPRE, se haya actualizado el estatus o no.
            // Si el estatus es de cobro, verificamos que el dinero exista.

            let isChargeable = false;
            let chargeReason = '';
            
            // Evaluamos el "Target Status" (La verdad actual de FedEx)
            if (targetStatus === ShipmentStatusType.ENTREGADO) {
                isChargeable = true;
                chargeReason = 'ENTREGADO (DL)';
            }
            else if (targetException === '07' || [ShipmentStatusType.RECHAZADO].includes(targetStatus as any)) {
                isChargeable = true;
                chargeReason = `RECHAZADO (${targetException})`;
            }
            else if (count08 >= 3) { // Usamos el conteo global que hicimos arriba
                isChargeable = true;
                chargeReason = `3ra VISITA (Acumulado 08)`;
            }

            // Regla de Exclusión: Externos NO pagan
            if (subConfig.trackExternalDelivery && hasOD) {
                isChargeable = false;
            }

            if (isChargeable) {
                const mDate = dayjs(targetDate);
                const startOfWeek = mDate.day(1).startOf('day').toDate();
                const endOfWeek = mDate.day(7).endOf('day').toDate();

                const incomeExists = await queryRunner.manager.findOne(Income, {
                    where: { 
                        trackingNumber: tn, 
                        date: Between(startOfWeek, endOfWeek) 
                    }
                });

                if (!incomeExists) {
                    // Si llegamos aquí, FALTA DINERO. Lo generamos AHORA.
                    // Usamos una copia temporal del shipment con el estatus "cobrable" para engañar al generador si es necesario
                    const tempShipment = { ...shipmentList[0] };
                    
                    // Ajuste para cobro de 3 visitas (que a veces requiere estatus específico)
                    if (chargeReason.includes('3ra VISITA')) {
                        tempShipment.status = ShipmentStatusType.CLIENTE_NO_DISPONIBLE as any;
                    } else {
                        tempShipment.status = targetStatus as any;
                    }

                    // this.logger.log(`💰 Garantía de Ingreso Activada: ${tn} - ${chargeReason}`);
                    await this.generateIncomes(tempShipment as Shipment, targetDate, targetException, queryRunner.manager);
                }
            }

            // --- 7. CIERRE ---
            await queryRunner.commitTransaction();

          } catch (error) {
            this.logger.error(`[${tn}] Error Transacción: ${error.message}`);
            if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
          } finally {
            await queryRunner.release();
          }
        }));

        await Promise.all(tasks);
      }
    
      async processMasterFedexUpdateResp1702(shipmentsToUpdate: Shipment[]) {
        this.logger.log(`💎 Master Update (Titanium - Definitive Edition): Procesando ${shipmentsToUpdate.length} guías...`);

        // 1. Agrupación por Tracking (Eficiencia)
        const shipmentsByTracking = shipmentsToUpdate.reduce((acc, s) => {
          if (!acc[s.trackingNumber]) acc[s.trackingNumber] = [];
          acc[s.trackingNumber].push(s.id);
          return acc;
        }, {} as Record<string, string[]>);

        const uniqueTrackingNumbers = Object.keys(shipmentsByTracking);
        const limit = pLimit(10); // Paralelismo controlado

        const tasks = uniqueTrackingNumbers.map((tn) => limit(async () => {
          const shipmentWithId = shipmentsToUpdate.find(s => s.trackingNumber === tn && s.fedexUniqueId);
          const currentUniqueId = shipmentWithId?.fedexUniqueId;

          // --- 1. CONSULTA FEDEX ---
          let fedexInfo;
          try {
             fedexInfo = await this.fedexService.trackPackage(tn, currentUniqueId);
          } catch (error) {
             this.logger.error(`[${tn}] Error API FedEx: ${error.message}`);
             return;
          }

          // Validación inicial de respuesta
          let allTrackResults = fedexInfo?.output?.completeTrackResults?.[0]?.trackResults || [];
          if (allTrackResults.length === 0) return;

          // =================================================================================
          // 🛡️ CORRECCIÓN 1: SELECTOR INTELIGENTE (Anti-Gemelo Malvado)
          // =================================================================================
          // Si FedEx devuelve múltiples historias (vieja vs nueva), ordenamos por fecha del evento más reciente
          // y tomamos el ganador.
          if (allTrackResults.length > 1) {
              allTrackResults.sort((a, b) => {
                  // Obtenemos la fecha del evento más reciente de cada resultado (o 0 si no tiene)
                  // Nota: FedEx suele mandar el más reciente en el índice 0 de scanEvents, pero verificamos.
                  const dateA = new Date(a.scanEvents?.[0]?.date || 0).getTime();
                  const dateB = new Date(b.scanEvents?.[0]?.date || 0).getTime();
                  return dateB - dateA; // Descendente (El más nuevo primero)
              });
              
              const winner = allTrackResults[0];
              this.logger.log(`[${tn}] ⚠️ Múltiples resultados (${allTrackResults.length}). Usando el más reciente: ${winner.latestStatusDetail?.statusByLocale} (${winner.dateAndTimes?.[0]?.dateTime})`);
          }

          const trackResult = allTrackResults[0]; 
          const scanEvents = trackResult.scanEvents || [];

          // --- 2. TRANSACCIÓN BD ---
          const queryRunner = this.dataSource.createQueryRunner();
          await queryRunner.connect();
          await queryRunner.startTransaction();

          try {
            const targetIds = shipmentsByTracking[tn];
            
            // Bloqueo pesimista para evitar colisiones de escritura
            const shipmentList = await queryRunner.manager.find(Shipment, {
              where: { id: In(targetIds) },
              relations: ['subsidiary'],
              lock: { mode: 'pessimistic_write' }
            });

            if (shipmentList.length === 0) {
                 await queryRunner.commitTransaction();
                 return;
            }

            const mainShipment = shipmentList[0];
            const subId = mainShipment.subsidiary?.id?.toLowerCase() || '';
            const configKeys = Object.keys(this.SUBSIDIARY_CONFIG);
            const matchedKey = configKeys.find(key => key.toLowerCase() === subId);
            const subConfig = matchedKey ? this.SUBSIDIARY_CONFIG[matchedKey] : { trackExternalDelivery: false };

            // =================================================================================
            // 🛡️ CORRECCIÓN 2: HUELLA DIGITAL (Signature Check)
            // =================================================================================
            // 1. Traemos TODA la historia existente para crear el mapa de firmas.
            const existingHistory = await queryRunner.manager.query(
              `SELECT timestamp, exceptionCode FROM shipment_status WHERE shipmentId = ?`,
              [mainShipment.id]
            );

            // 2. Creamos un Set de firmas únicas: "Milisegundos_Codigo"
            // Esto soluciona el problema de tus fechas manuales "en el futuro".
            const processedSignatures = new Set(existingHistory.map(h => {
                const t = new Date(h.timestamp).getTime();
                const c = (h.exceptionCode || '').trim(); 
                return `${t}_${c}`;
            }));

            const dbIsFinal = (mainShipment.status === ShipmentStatusType.ENTREGADO);

            // 3. Filtramos: Solo pasan eventos cuya firma NO exista en la base de datos.
            const newEvents = scanEvents.filter(e => {
                const t = new Date(e.date).getTime();
                const c = (e.exceptionCode || '').trim();
                const signature = `${t}_${c}`;
                return !processedSignatures.has(signature);
            });

            // 4. Ordenamos Cronológicamente (Viejo -> Nuevo) para procesar la historia linealmente
            newEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            
            // --- 4. PROCESAMIENTO DE HISTORIA ---
            // Contamos intentos previos (08)
            const existing08Count = await queryRunner.manager.count(ShipmentStatus, {
                where: { shipment: { id: mainShipment.id }, exceptionCode: '08' }
            });
            let current08Count = existing08Count;

            // 🛡️ CORRECCIÓN 4: Protección de Bucle (Loop Blindness)
            const paidWeeks = new Set<string>();

            for (const event of newEvents) {
                const eventDate = new Date(event.date);
                const dCode = event.derivedStatusCode || '';
                const eCode = (event.exceptionCode || '').trim();
                
                let eventStatus = mapFedexStatusToLocalStatus(dCode, eCode);

                // Regla 005 (Mapeo visual)
                if (eCode === '005') eventStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                
                // Fallback a desconocido si no existe en nuestro ENUM
                if (!Object.values(ShipmentStatusType).includes(eventStatus)) eventStatus = ShipmentStatusType.DESCONOCIDO;

                // Lógica OD (Visual)
                if (subConfig.trackExternalDelivery) {
                    if (event.eventType === 'OD') eventStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                }

                // 4.1 GUARDAR HISTORIA
                for (const ship of shipmentList) {
                    const historyEntry = queryRunner.manager.create(ShipmentStatus, {
                        status: eventStatus,
                        exceptionCode: eCode,
                        timestamp: eventDate,
                        shipment: ship,
                        notes: event.eventDescription || 'FedEx Scan'
                    });
                    await queryRunner.manager.save(historyEntry);
                }

                // =================================================================================
                // 🛡️ CORRECCIÓN 3: GARANTÍA DE INGRESOS BLINDADA
                // =================================================================================
                let isChargeable = false;
                let chargeReason = '';

                // A. Entregado (DL) - Cobra SIEMPRE, sin importar ODs pasados
                if (eventStatus === ShipmentStatusType.ENTREGADO) {
                    isChargeable = true;
                    chargeReason = 'ENTREGADO (DL)';
                } 
                // B. Rechazado
                else if (eCode === '07' || eventStatus === ShipmentStatusType.RECHAZADO) {
                    isChargeable = true;
                    chargeReason = `RECHAZADO (${eCode})`;
                } 
                // C. 3ra Visita
                else if (eCode === '08') {
                    current08Count++;
                    if (current08Count >= 3) {
                        isChargeable = true;
                        chargeReason = `3ra VISITA (Acumulado)`;
                    }
                }

                // Control de duplicados en memoria (mismo bucle)
                const mDate = dayjs(eventDate);
                const weekKey = `${mDate.year()}-W${mDate.isoWeek()}`;
                if (paidWeeks.has(weekKey)) isChargeable = false;

                if (isChargeable) {
                    const startOfWeek = mDate.day(1).startOf('day').toDate();
                    const endOfWeek = mDate.day(7).endOf('day').toDate();
                    
                    // Check BD (Transaccional)
                    const incomeExists = await queryRunner.manager.findOne(Income, {
                        where: { trackingNumber: tn, date: Between(startOfWeek, endOfWeek) }
                    });

                    if (!incomeExists) {
                        const tempShipment = { ...mainShipment };
                        // Forzamos el estatus en el objeto temporal para el cálculo correcto
                        if (chargeReason.includes('3ra VISITA')) tempShipment.status = ShipmentStatusType.CLIENTE_NO_DISPONIBLE as any;
                        else tempShipment.status = eventStatus as any;
                        
                        await this.generateIncomes(tempShipment as Shipment, eventDate, eCode, queryRunner.manager);
                        
                        // Marcamos pagado en memoria
                        paidWeeks.add(weekKey);
                    } else {
                        paidWeeks.add(weekKey);
                    }
                }
            }

            // --- 5. ESTATUS FINAL (DEEP SCAN) ---
            const lsd = trackResult.latestStatusDetail;
            // Ordenamos nuevo -> viejo para sacar el estatus actual
            const allSortedEvents = [...scanEvents].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            const latestScanEvent = allSortedEvents[0]; 
            
            if (latestScanEvent) {
                // A. Escáner de Códigos
                const possibleCodes = [
                    lsd?.code, lsd?.derivedCode, lsd?.ancillaryDetails?.[0]?.reason, 
                    lsd?.delayDetail?.status, lsd?.delayDetail?.subType,
                    latestScanEvent.derivedStatusCode, latestScanEvent.exceptionCode, latestScanEvent.eventType 
                ].filter(c => c && c.trim() !== '');

                // B. Prioridad
                let detectedStatus = ShipmentStatusType.DESCONOCIDO;
                let detectedPriority = 0; 

                for (const code of possibleCodes) {
                    let mapped = mapFedexStatusToLocalStatus(code, code);
                    if (code === '005') mapped = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    if (code === 'OD') mapped = ShipmentStatusType.ACARGO_DE_FEDEX;

                    let priority = 0;
                    if (mapped === ShipmentStatusType.ENTREGADO || mapped === ShipmentStatusType.ENTREGADO_POR_FEDEX) priority = 3;
                    else if ([ShipmentStatusType.RECHAZADO, ShipmentStatusType.DEVUELTO_A_FEDEX, ShipmentStatusType.DIRECCION_INCORRECTA].includes(mapped as any)) priority = 2;
                    else if (mapped !== ShipmentStatusType.DESCONOCIDO && mapped !== ShipmentStatusType.EN_TRANSITO) priority = 1;

                    if (priority > detectedPriority) {
                        detectedStatus = mapped;
                        detectedPriority = priority;
                    }
                }

                // Fallback
                if (detectedStatus === ShipmentStatusType.DESCONOCIDO) {
                     const stdEx = (lsd?.ancillaryDetails?.[0]?.reason || latestScanEvent.exceptionCode || '').trim();
                     const stdCode = latestScanEvent.derivedStatusCode || '';
                     detectedStatus = mapFedexStatusToLocalStatus(stdCode, stdEx);
                }

                let finalStatus = detectedStatus;

                // C. Reglas Finales de Negocio
                if (possibleCodes.includes('005')) finalStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;

                if (finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
                    const foundDeliveredInHistory = scanEvents.some(e => {
                         const map = mapFedexStatusToLocalStatus(e.derivedStatusCode || '', e.exceptionCode || '');
                         return map === ShipmentStatusType.ENTREGADO;
                    });
                    if (foundDeliveredInHistory) finalStatus = ShipmentStatusType.ENTREGADO;
                }

                // D. Lógica OD Final
                const hasODGlobal = scanEvents.some(e => e.eventType === 'OD'); 
                if (subConfig.trackExternalDelivery) {
                     const hasODSignal = possibleCodes.includes('OD');
                     
                     if (hasODSignal && finalStatus !== ShipmentStatusType.ENTREGADO && finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
                         finalStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                     } 
                     else if (finalStatus === ShipmentStatusType.ENTREGADO && hasODGlobal) {
                         finalStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                     }
                }

                // --- 6. CANDADOS Y GUARDADO ---
                let isLocked = false;
                
                // Iron Lock: Si BD es final, solo permitimos Entregado/Entregado_FedEx
                if (dbIsFinal && finalStatus !== ShipmentStatusType.ENTREGADO && finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) isLocked = true;
                
                // Return Lock: Si ya se devolvió, no puede regresar a tránsito
                if ((mainShipment.status === ShipmentStatusType.DEVUELTO_A_FEDEX || mainShipment.status === ShipmentStatusType.RETORNO_ABANDONO_FEDEX) && !isLocked) {
                     const allowed = [ShipmentStatusType.ENTREGADO, ShipmentStatusType.ENTREGADO_POR_FEDEX, ShipmentStatusType.RECHAZADO, ShipmentStatusType.DIRECCION_INCORRECTA, ShipmentStatusType.CLIENTE_NO_DISPONIBLE, ShipmentStatusType.DEVUELTO_A_FEDEX, ShipmentStatusType.RETORNO_ABANDONO_FEDEX];
                     if (!allowed.includes(finalStatus)) isLocked = true;
                }

                if (!isLocked) {
                    for (const shipment of shipmentList) {
                        let hasChanges = false;
                        
                        // Actualizar estatus
                        if (shipment.status !== finalStatus) { 
                            shipment.status = finalStatus as any; 
                            hasChanges = true; 
                        }
                        
                        // Actualizar ID único (si cambió)
                        const newUniqueId = trackResult.trackingNumberInfo?.trackingNumberUniqueId;
                        if (newUniqueId && shipment.fedexUniqueId !== newUniqueId) { 
                            shipment.fedexUniqueId = newUniqueId; 
                            hasChanges = true; 
                        }
                        
                        // Actualizar Recibido Por
                        if (trackResult.deliveryDetails?.receivedByName && shipment.receivedByName !== trackResult.deliveryDetails.receivedByName) { 
                            shipment.receivedByName = trackResult.deliveryDetails.receivedByName; 
                            hasChanges = true; 
                        }
                        
                        if (hasChanges) await queryRunner.manager.save(Shipment, shipment);
                    }
                }
            }

            await queryRunner.commitTransaction();

          } catch (error) {
            this.logger.error(`[${tn}] Error Transacción: ${error.message}`);
            if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
          } finally {
            await queryRunner.release();
          }
        }));

        await Promise.all(tasks);
      }

      async processMasterFedexUpdate1702_1117(shipmentsToUpdate: Shipment[]) {
        this.logger.log(`💎 Master Update (Titanium - Definitive Edition): Procesando ${shipmentsToUpdate.length} guías...`);

        // 1. Agrupación por Tracking (Eficiencia Máxima)
        const shipmentsByTracking = shipmentsToUpdate.reduce((acc, s) => {
          if (!acc[s.trackingNumber]) acc[s.trackingNumber] = [];
          acc[s.trackingNumber].push(s.id);
          return acc;
        }, {} as Record<string, string[]>);

        const uniqueTrackingNumbers = Object.keys(shipmentsByTracking);
        const limit = pLimit(10); // Paralelismo controlado

        const tasks = uniqueTrackingNumbers.map((tn) => limit(async () => {
          const shipmentWithId = shipmentsToUpdate.find(s => s.trackingNumber === tn && s.fedexUniqueId);
          const currentUniqueId = shipmentWithId?.fedexUniqueId;

          // --- 1. CONSULTA FEDEX ---
          let fedexInfo;
          try {
             fedexInfo = await this.fedexService.trackPackage(tn, currentUniqueId);
          } catch (error) {
             this.logger.error(`[${tn}] Error API FedEx: ${error.message}`);
             return;
          }

          let allTrackResults = fedexInfo?.output?.completeTrackResults?.[0]?.trackResults || [];
          if (allTrackResults.length === 0) return;

          // =================================================================================
          // 🛡️ CORRECCIÓN 1: SELECTOR INTELIGENTE (Anti-Gemelo Malvado)
          // =================================================================================
          if (allTrackResults.length > 1) {
              allTrackResults.sort((a, b) => {
                  const dateA = new Date(a.scanEvents?.[0]?.date || 0).getTime();
                  const dateB = new Date(b.scanEvents?.[0]?.date || 0).getTime();
                  return dateB - dateA; // Descendente (Nuevo -> Viejo)
              });
              const winner = allTrackResults[0];
              this.logger.log(`[${tn}] ⚠️ Múltiples resultados. Usando el más reciente: ${winner.latestStatusDetail?.statusByLocale}`);
          }

          const trackResult = allTrackResults[0]; 
          const scanEvents = trackResult.scanEvents || [];

          // --- 2. TRANSACCIÓN BD ---
          const queryRunner = this.dataSource.createQueryRunner();
          await queryRunner.connect();
          await queryRunner.startTransaction();

          try {
            const targetIds = shipmentsByTracking[tn];
            
            // Bloqueo pesimista para evitar colisiones
            const shipmentList = await queryRunner.manager.find(Shipment, {
              where: { id: In(targetIds) },
              relations: ['subsidiary'],
              lock: { mode: 'pessimistic_write' }
            });

            if (shipmentList.length === 0) {
                 await queryRunner.commitTransaction();
                 return;
            }

            const mainShipment = shipmentList[0];
            const subId = mainShipment.subsidiary?.id?.toLowerCase() || '';
            const configKeys = Object.keys(this.SUBSIDIARY_CONFIG);
            const matchedKey = configKeys.find(key => key.toLowerCase() === subId);
            const subConfig = matchedKey ? this.SUBSIDIARY_CONFIG[matchedKey] : { trackExternalDelivery: false };

            // =================================================================================
            // 🛡️ CORRECCIÓN 2: HUELLA DIGITAL (Evita Duplicados)
            // =================================================================================
            const existingHistory = await queryRunner.manager.query(
              `SELECT timestamp, exceptionCode FROM shipment_status WHERE shipmentId = ?`,
              [mainShipment.id]
            );

            // Creamos firmas. Usamos '' si es null para coincidir con la API
            const processedSignatures = new Set(existingHistory.map(h => {
                const t = new Date(h.timestamp).getTime();
                const c = (h.exceptionCode || '').trim(); 
                return `${t}_${c}`;
            }));

            // Filtramos eventos nuevos
            const newEvents = scanEvents.filter(e => {
                const t = new Date(e.date).getTime();
                const c = (e.exceptionCode || '').trim();
                const signature = `${t}_${c}`;
                return !processedSignatures.has(signature);
            });

            // Ordenamos Cronológicamente para procesar
            newEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            
            // --- 4. PROCESAMIENTO DE HISTORIA ---
            const existing08Count = await queryRunner.manager.count(ShipmentStatus, {
                where: { shipment: { id: mainShipment.id }, exceptionCode: '08' }
            });
            let current08Count = existing08Count;

            // 🛡️ CORRECCIÓN 3: Protección de Bucle (Loop Blindness)
            const paidWeeks = new Set<string>();

            for (const event of newEvents) {
                const eventDate = new Date(event.date);
                const dCode = event.derivedStatusCode || '';
                const eCode = (event.exceptionCode || '').trim();
                
                let eventStatus = mapFedexStatusToLocalStatus(dCode, eCode);
                if (eCode === '005') eventStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                if (!Object.values(ShipmentStatusType).includes(eventStatus)) eventStatus = ShipmentStatusType.DESCONOCIDO;

                if (subConfig.trackExternalDelivery) {
                    if (event.eventType === 'OD') eventStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                }

                // 4.1 GUARDAR HISTORIA
                for (const ship of shipmentList) {
                    const historyEntry = queryRunner.manager.create(ShipmentStatus, {
                        status: eventStatus,
                        exceptionCode: eCode,
                        timestamp: eventDate,
                        shipment: ship,
                        notes: event.eventDescription || 'FedEx Scan'
                    });
                    await queryRunner.manager.save(historyEntry);
                }

                // =================================================================================
                // 🛡️ GARANTÍA DE INGRESOS (BUCLE NORMAL)
                // =================================================================================
                let isChargeable = false;
                let chargeReason = '';

                if (eventStatus === ShipmentStatusType.ENTREGADO) {
                    isChargeable = true;
                    chargeReason = 'ENTREGADO (DL)';
                } else if (eCode === '07' || eventStatus === ShipmentStatusType.RECHAZADO) {
                    isChargeable = true;
                    chargeReason = `RECHAZADO (${eCode})`;
                } else if (eCode === '08') {
                    current08Count++;
                    if (current08Count >= 3) {
                        isChargeable = true;
                        chargeReason = `3ra VISITA (Acumulado)`;
                    }
                }

                const mDate = dayjs(eventDate);
                const weekKey = `${mDate.year()}-W${mDate.isoWeek()}`;
                if (paidWeeks.has(weekKey)) isChargeable = false;

                if (isChargeable) {
                    const startOfWeek = mDate.day(1).startOf('day').toDate();
                    const endOfWeek = mDate.day(7).endOf('day').toDate();
                    
                    const incomeExists = await queryRunner.manager.findOne(Income, {
                        where: { trackingNumber: tn, date: Between(startOfWeek, endOfWeek) }
                    });

                    if (!incomeExists) {
                        const tempShipment = { ...mainShipment };
                        if (chargeReason.includes('3ra VISITA')) tempShipment.status = ShipmentStatusType.CLIENTE_NO_DISPONIBLE as any;
                        else tempShipment.status = eventStatus as any;
                        
                        await this.generateIncomes(tempShipment as Shipment, eventDate, eCode, queryRunner.manager);
                        this.logger.log(`💰 Ingreso Generado [${tn}]: ${chargeReason}`);
                        paidWeeks.add(weekKey);
                    } else {
                        paidWeeks.add(weekKey);
                    }
                }
            }

            // =================================================================================
            // 🚨 SAFETY NET: RESPALDO FINANCIERO (El Parche del "Header Ghost")
            // =================================================================================
            // Si el bucle de arriba falló porque FedEx se comió el evento en la lista, pero el header dice Entregado:
            const lsdCheck = trackResult.latestStatusDetail;
            const isDeliveredGlobal = (lsdCheck?.code === 'DL' || lsdCheck?.derivedCode === 'DL');

            if (isDeliveredGlobal) {
                // Buscamos la fecha REAL de entrega en los metadatos (Backup)
                const actualDeliveryDateStr = trackResult.dateAndTimes?.find(d => d.type === 'ACTUAL_DELIVERY')?.dateTime;
                
                if (actualDeliveryDateStr) {
                    const deliveryDate = new Date(actualDeliveryDateStr);
                    const mDate = dayjs(deliveryDate);
                    const weekKey = `${mDate.year()}-W${mDate.isoWeek()}`;

                    // Solo procedemos si NO hemos pagado ya en esta ejecución
                    if (!paidWeeks.has(weekKey)) {
                        const startOfWeek = mDate.day(1).startOf('day').toDate();
                        const endOfWeek = mDate.day(7).endOf('day').toDate();

                        // Verificación final en BD
                        const incomeExists = await queryRunner.manager.findOne(Income, {
                            where: { trackingNumber: tn, date: Between(startOfWeek, endOfWeek) }
                        });

                        if (!incomeExists) {
                            // Forzamos estatus ENTREGADO en una copia para que el cálculo sea correcto
                            const tempShipment = { ...mainShipment, status: ShipmentStatusType.ENTREGADO as any };
                            
                            await this.generateIncomes(tempShipment as Shipment, deliveryDate, 'DL', queryRunner.manager);
                            
                            this.logger.log(`💰 Ingreso Generado (Backup Header) [${tn}]: ENTREGADO (DL)`);
                            paidWeeks.add(weekKey);
                        } else {
                            paidWeeks.add(weekKey);
                        }
                    }
                }
            }

            // --- 5. ESTATUS FINAL (DEEP SCAN) ---
            const lsd = trackResult.latestStatusDetail;
            const allSortedEvents = [...scanEvents].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            const latestScanEvent = allSortedEvents[0]; 
            
            if (latestScanEvent) {
                const possibleCodes = [
                    lsd?.code, lsd?.derivedCode, lsd?.ancillaryDetails?.[0]?.reason, 
                    lsd?.delayDetail?.status, lsd?.delayDetail?.subType,
                    latestScanEvent.derivedStatusCode, latestScanEvent.exceptionCode, latestScanEvent.eventType 
                ].filter(c => c && c.trim() !== '');

                let detectedStatus = ShipmentStatusType.DESCONOCIDO;
                let detectedPriority = 0; 

                for (const code of possibleCodes) {
                    let mapped = mapFedexStatusToLocalStatus(code, code);
                    if (code === '005') mapped = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    if (code === 'OD') mapped = ShipmentStatusType.ACARGO_DE_FEDEX;

                    let priority = 0;
                    if (mapped === ShipmentStatusType.ENTREGADO || mapped === ShipmentStatusType.ENTREGADO_POR_FEDEX) priority = 3;
                    else if ([ShipmentStatusType.RECHAZADO, ShipmentStatusType.DEVUELTO_A_FEDEX, ShipmentStatusType.DIRECCION_INCORRECTA].includes(mapped as any)) priority = 2;
                    else if (mapped !== ShipmentStatusType.DESCONOCIDO && mapped !== ShipmentStatusType.EN_TRANSITO) priority = 1;

                    if (priority > detectedPriority) {
                        detectedStatus = mapped;
                        detectedPriority = priority;
                    }
                }

                if (detectedStatus === ShipmentStatusType.DESCONOCIDO) {
                     const stdEx = (lsd?.ancillaryDetails?.[0]?.reason || latestScanEvent.exceptionCode || '').trim();
                     const stdCode = latestScanEvent.derivedStatusCode || '';
                     detectedStatus = mapFedexStatusToLocalStatus(stdCode, stdEx);
                }

                let finalStatus = detectedStatus;

                if (possibleCodes.includes('005')) finalStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;

                if (finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
                    const foundDeliveredInHistory = scanEvents.some(e => {
                         const map = mapFedexStatusToLocalStatus(e.derivedStatusCode || '', e.exceptionCode || '');
                         return map === ShipmentStatusType.ENTREGADO;
                    });
                    if (foundDeliveredInHistory) finalStatus = ShipmentStatusType.ENTREGADO;
                }

                const hasODGlobal = scanEvents.some(e => e.eventType === 'OD'); 
                if (subConfig.trackExternalDelivery) {
                     const hasODSignal = possibleCodes.includes('OD');
                     if (hasODSignal && finalStatus !== ShipmentStatusType.ENTREGADO && finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
                         finalStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                     } 
                     else if (finalStatus === ShipmentStatusType.ENTREGADO && hasODGlobal) {
                         finalStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                     }
                }

                // --- 6. CANDADOS Y GUARDADO ---
                let isLocked = false;
                const dbIsFinal = (mainShipment.status === ShipmentStatusType.ENTREGADO);
                
                // Iron Lock
                if (dbIsFinal && finalStatus !== ShipmentStatusType.ENTREGADO && finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) isLocked = true;
                
                // Return Lock
                if ((mainShipment.status === ShipmentStatusType.DEVUELTO_A_FEDEX || mainShipment.status === ShipmentStatusType.RETORNO_ABANDONO_FEDEX) && !isLocked) {
                     const allowed = [ShipmentStatusType.ENTREGADO, ShipmentStatusType.ENTREGADO_POR_FEDEX, ShipmentStatusType.RECHAZADO, ShipmentStatusType.DIRECCION_INCORRECTA, ShipmentStatusType.CLIENTE_NO_DISPONIBLE, ShipmentStatusType.DEVUELTO_A_FEDEX, ShipmentStatusType.RETORNO_ABANDONO_FEDEX];
                     if (!allowed.includes(finalStatus)) isLocked = true;
                }

                if (!isLocked) {
                    for (const shipment of shipmentList) {
                        let hasChanges = false;
                        
                        // Actualizar estatus
                        if (shipment.status !== finalStatus) { 
                            shipment.status = finalStatus as any; 
                            hasChanges = true; 
                        }
                        
                        // Actualizar ID único
                        const newUniqueId = trackResult.trackingNumberInfo?.trackingNumberUniqueId;
                        if (newUniqueId && shipment.fedexUniqueId !== newUniqueId) { 
                            shipment.fedexUniqueId = newUniqueId; 
                            hasChanges = true; 
                        }
                        
                        // Actualizar Recibido Por
                        if (trackResult.deliveryDetails?.receivedByName && shipment.receivedByName !== trackResult.deliveryDetails.receivedByName) { 
                            shipment.receivedByName = trackResult.deliveryDetails.receivedByName; 
                            hasChanges = true; 
                        }
                        
                        if (hasChanges) await queryRunner.manager.save(Shipment, shipment);
                    }
                }
            }

            await queryRunner.commitTransaction();

          } catch (error) {
            this.logger.error(`[${tn}] Error Transacción: ${error.message}`);
            if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
          } finally {
            await queryRunner.release();
          }
        }));

        await Promise.all(tasks);
      }

      async processMasterFedexUpdateR1210(shipmentsToUpdate: Shipment[]) {
        this.logger.log(`💎 Master Update (Titanium - Definitive Edition): Procesando ${shipmentsToUpdate.length} guías...`);

        // 1. Agrupación por Tracking (Eficiencia Máxima)
        const shipmentsByTracking = shipmentsToUpdate.reduce((acc, s) => {
          if (!acc[s.trackingNumber]) acc[s.trackingNumber] = [];
          acc[s.trackingNumber].push(s.id);
          return acc;
        }, {} as Record<string, string[]>);

        const uniqueTrackingNumbers = Object.keys(shipmentsByTracking);
        const limit = pLimit(10); // Paralelismo controlado

        const tasks = uniqueTrackingNumbers.map((tn) => limit(async () => {
          const shipmentWithId = shipmentsToUpdate.find(s => s.trackingNumber === tn && s.fedexUniqueId);
          const currentUniqueId = shipmentWithId?.fedexUniqueId;

          // --- 1. CONSULTA FEDEX (Estrategia Proactiva) ---
          let fedexInfo;
          try {
             fedexInfo = await this.fedexService.trackPackage(tn, currentUniqueId);
          } catch (error) {
             this.logger.error(`[${tn}] Error API FedEx: ${error.message}`);
             return;
          }

          let allTrackResults = fedexInfo?.output?.completeTrackResults?.[0]?.trackResults || [];

          // 🚨 EL PARCHE CLAVE:
          // Si el resultado es "Label Created" (OC) pero tenemos un UniqueID,
          // hay un 99% de probabilidad de que sea el ID equivocado. Reintentamos global.
          const isLabelOnly = allTrackResults.some(r => 
            r.latestStatusDetail?.code === 'OC' && (r.scanEvents?.length || 0) <= 1
          );

          if (isLabelOnly || allTrackResults.length === 0) {
              try {
                  const retryInfo = await this.fedexService.trackPackage(tn, undefined);
                  const retryResults = retryInfo?.output?.completeTrackResults?.[0]?.trackResults || [];
                  if (retryResults.length > 0) {
                      allTrackResults = retryResults;
                  }
              } catch (e) {
                  this.logger.warn(`[${tn}] Falló reintento global: ${e.message}`);
              }
          }

          if (allTrackResults.length === 0) return;

          // =================================================================================
          // 🛡️ CORRECCIÓN 1: SELECTOR INTELIGENTE (Anti-Gemelo Malvado)
          // =================================================================================
          if (allTrackResults.length > 1) {
              allTrackResults.sort((a, b) => {
                  const dateA = new Date(a.scanEvents?.[0]?.date || 0).getTime();
                  const dateB = new Date(b.scanEvents?.[0]?.date || 0).getTime();
                  return dateB - dateA; // Descendente (Nuevo -> Viejo)
              });
              const winner = allTrackResults[0];
              this.logger.log(`[${tn}] ⚠️ Múltiples resultados. Usando el más reciente: ${winner.latestStatusDetail?.statusByLocale}`);
          }

          const trackResult = allTrackResults[0]; 
          const scanEvents = trackResult.scanEvents || [];

          // --- 2. TRANSACCIÓN BD ---
          const queryRunner = this.dataSource.createQueryRunner();
          await queryRunner.connect();
          await queryRunner.startTransaction();

          try {
            const targetIds = shipmentsByTracking[tn];
            
            // Bloqueo pesimista para evitar colisiones
            const shipmentList = await queryRunner.manager.find(Shipment, {
              where: { id: In(targetIds) },
              relations: ['subsidiary'],
              lock: { mode: 'pessimistic_write' }
            });

            if (shipmentList.length === 0) {
                 await queryRunner.commitTransaction();
                 return;
            }

            const mainShipment = shipmentList[0];
            const subId = mainShipment.subsidiary?.id?.toLowerCase() || '';
            const configKeys = Object.keys(this.SUBSIDIARY_CONFIG);
            const matchedKey = configKeys.find(key => key.toLowerCase() === subId);
            const subConfig = matchedKey ? this.SUBSIDIARY_CONFIG[matchedKey] : { trackExternalDelivery: false };

            // =================================================================================
            // 🛡️ CORRECCIÓN 2: HUELLA DIGITAL (Evita Duplicados)
            // =================================================================================
            const existingHistory = await queryRunner.manager.query(
              `SELECT timestamp, exceptionCode FROM shipment_status WHERE shipmentId = ?`,
              [mainShipment.id]
            );

            // Creamos firmas. Usamos '' si es null para coincidir con la API
            const processedSignatures = new Set(existingHistory.map(h => {
                const t = new Date(h.timestamp).getTime();
                const c = (h.exceptionCode || '').trim(); 
                return `${t}_${c}`;
            }));

            // Filtramos eventos nuevos
            const newEvents = scanEvents.filter(e => {
                const t = new Date(e.date).getTime();
                const c = (e.exceptionCode || '').trim();
                const signature = `${t}_${c}`;
                return !processedSignatures.has(signature);
            });

            // Ordenamos Cronológicamente para procesar
            newEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            
            // --- 4. PROCESAMIENTO DE HISTORIA ---
            const existing08Count = await queryRunner.manager.count(ShipmentStatus, {
                where: { shipment: { id: mainShipment.id }, exceptionCode: '08' }
            });
            let current08Count = existing08Count;

            // 🛡️ CORRECCIÓN 3: Protección de Bucle (Loop Blindness)
            const paidWeeks = new Set<string>();

            for (const event of newEvents) {
                const eventDate = new Date(event.date);
                const dCode = event.derivedStatusCode || '';
                const eCode = (event.exceptionCode || '').trim();
                
                let eventStatus = mapFedexStatusToLocalStatus(dCode, eCode);
                if (eCode === '005') eventStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                if (!Object.values(ShipmentStatusType).includes(eventStatus)) eventStatus = ShipmentStatusType.DESCONOCIDO;

                if (subConfig.trackExternalDelivery) {
                    if (event.eventType === 'OD') eventStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                }

                // 4.1 GUARDAR HISTORIA
                for (const ship of shipmentList) {
                    const historyEntry = queryRunner.manager.create(ShipmentStatus, {
                        status: eventStatus,
                        exceptionCode: eCode,
                        timestamp: eventDate,
                        shipment: ship,
                        notes: event.eventDescription || 'FedEx Scan'
                    });
                    await queryRunner.manager.save(historyEntry);
                }

                // =================================================================================
                // 🛡️ GARANTÍA DE INGRESOS (BUCLE NORMAL)
                // =================================================================================
                let isChargeable = false;
                let chargeReason = '';

                if (eventStatus === ShipmentStatusType.ENTREGADO) {
                    isChargeable = true;
                    chargeReason = 'ENTREGADO (DL)';
                } else if (eCode === '07' || eventStatus === ShipmentStatusType.RECHAZADO) {
                    isChargeable = true;
                    chargeReason = `RECHAZADO (${eCode})`;
                } else if (eCode === '08') {
                    current08Count++;
                    if (current08Count >= 3) {
                        isChargeable = true;
                        chargeReason = `3ra VISITA (Acumulado)`;
                    }
                }

                const mDate = dayjs(eventDate);
                const weekKey = `${mDate.year()}-W${mDate.isoWeek()}`;
                if (paidWeeks.has(weekKey)) isChargeable = false;

                if (isChargeable) {
                    const startOfWeek = mDate.day(1).startOf('day').toDate();
                    const endOfWeek = mDate.day(7).endOf('day').toDate();
                    
                    const incomeExists = await queryRunner.manager.findOne(Income, {
                        where: { trackingNumber: tn, date: Between(startOfWeek, endOfWeek) }
                    });

                    if (!incomeExists) {
                        const tempShipment = { ...mainShipment };
                        if (chargeReason.includes('3ra VISITA')) tempShipment.status = ShipmentStatusType.CLIENTE_NO_DISPONIBLE as any;
                        else tempShipment.status = eventStatus as any;
                        
                        await this.generateIncomes(tempShipment as Shipment, eventDate, eCode, queryRunner.manager);
                        this.logger.log(`💰 Ingreso Generado [${tn}]: ${chargeReason}`);
                        paidWeeks.add(weekKey);
                    } else {
                        paidWeeks.add(weekKey);
                    }
                }
            }

            // =================================================================================
            // 🚨 SAFETY NET: RESPALDO FINANCIERO (El Parche del "Header Ghost")
            // =================================================================================
            // Si el bucle de arriba falló porque FedEx se comió el evento en la lista, pero el header dice Entregado:
            const lsdCheck = trackResult.latestStatusDetail;
            const isDeliveredGlobal = (lsdCheck?.code === 'DL' || lsdCheck?.derivedCode === 'DL');

            if (isDeliveredGlobal) {
                // Buscamos la fecha REAL de entrega en los metadatos (Backup)
                const actualDeliveryDateStr = trackResult.dateAndTimes?.find(d => d.type === 'ACTUAL_DELIVERY')?.dateTime;
                
                if (actualDeliveryDateStr) {
                    const deliveryDate = new Date(actualDeliveryDateStr);
                    const mDate = dayjs(deliveryDate);
                    const weekKey = `${mDate.year()}-W${mDate.isoWeek()}`;

                    // Solo procedemos si NO hemos pagado ya en esta ejecución
                    if (!paidWeeks.has(weekKey)) {
                        const startOfWeek = mDate.day(1).startOf('day').toDate();
                        const endOfWeek = mDate.day(7).endOf('day').toDate();

                        // Verificación final en BD
                        const incomeExists = await queryRunner.manager.findOne(Income, {
                            where: { trackingNumber: tn, date: Between(startOfWeek, endOfWeek) }
                        });

                        if (!incomeExists) {
                            // Forzamos estatus ENTREGADO en una copia para que el cálculo sea correcto
                            const tempShipment = { ...mainShipment, status: ShipmentStatusType.ENTREGADO as any };
                            
                            await this.generateIncomes(tempShipment as Shipment, deliveryDate, 'DL', queryRunner.manager);
                            
                            this.logger.log(`💰 Ingreso Generado (Backup Header) [${tn}]: ENTREGADO (DL)`);
                            paidWeeks.add(weekKey);
                        } else {
                            paidWeeks.add(weekKey);
                        }
                    }
                }
            }

            // --- 5. ESTATUS FINAL (DEEP SCAN) ---
            const lsd = trackResult.latestStatusDetail;
            const allSortedEvents = [...scanEvents].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            const latestScanEvent = allSortedEvents[0]; 
            
            if (latestScanEvent) {
                const possibleCodes = [
                    lsd?.code, lsd?.derivedCode, lsd?.ancillaryDetails?.[0]?.reason, 
                    lsd?.delayDetail?.status, lsd?.delayDetail?.subType,
                    latestScanEvent.derivedStatusCode, latestScanEvent.exceptionCode, latestScanEvent.eventType 
                ].filter(c => c && c.trim() !== '');

                let detectedStatus = ShipmentStatusType.DESCONOCIDO;
                let detectedPriority = 0; 

                for (const code of possibleCodes) {
                    let mapped = mapFedexStatusToLocalStatus(code, code);
                    if (code === '005') mapped = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    if (code === 'OD') mapped = ShipmentStatusType.ACARGO_DE_FEDEX;

                    let priority = 0;
                    if (mapped === ShipmentStatusType.ENTREGADO || mapped === ShipmentStatusType.ENTREGADO_POR_FEDEX) priority = 3;
                    else if ([ShipmentStatusType.RECHAZADO, ShipmentStatusType.DEVUELTO_A_FEDEX, ShipmentStatusType.DIRECCION_INCORRECTA].includes(mapped as any)) priority = 2;
                    else if (mapped !== ShipmentStatusType.DESCONOCIDO && mapped !== ShipmentStatusType.EN_TRANSITO) priority = 1;

                    if (priority > detectedPriority) {
                        detectedStatus = mapped;
                        detectedPriority = priority;
                    }
                }

                if (detectedStatus === ShipmentStatusType.DESCONOCIDO) {
                     const stdEx = (lsd?.ancillaryDetails?.[0]?.reason || latestScanEvent.exceptionCode || '').trim();
                     const stdCode = latestScanEvent.derivedStatusCode || '';
                     detectedStatus = mapFedexStatusToLocalStatus(stdCode, stdEx);
                }

                let finalStatus = detectedStatus;

                if (possibleCodes.includes('005')) finalStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;

                if (finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
                    const foundDeliveredInHistory = scanEvents.some(e => {
                         const map = mapFedexStatusToLocalStatus(e.derivedStatusCode || '', e.exceptionCode || '');
                         return map === ShipmentStatusType.ENTREGADO;
                    });
                    if (foundDeliveredInHistory) finalStatus = ShipmentStatusType.ENTREGADO;
                }

                const hasODGlobal = scanEvents.some(e => e.eventType === 'OD'); 
                if (subConfig.trackExternalDelivery) {
                     const hasODSignal = possibleCodes.includes('OD');
                     if (hasODSignal && finalStatus !== ShipmentStatusType.ENTREGADO && finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
                         finalStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                     } 
                     else if (finalStatus === ShipmentStatusType.ENTREGADO && hasODGlobal) {
                         finalStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                     }
                }

                // --- 6. CANDADOS Y GUARDADO ---
                let isLocked = false;
                const dbIsFinal = (mainShipment.status === ShipmentStatusType.ENTREGADO);
                
                // Iron Lock
                if (dbIsFinal && finalStatus !== ShipmentStatusType.ENTREGADO && finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) isLocked = true;
                
                // Return Lock
                if ((mainShipment.status === ShipmentStatusType.DEVUELTO_A_FEDEX || mainShipment.status === ShipmentStatusType.RETORNO_ABANDONO_FEDEX) && !isLocked) {
                     const allowed = [ShipmentStatusType.ENTREGADO, ShipmentStatusType.ENTREGADO_POR_FEDEX, ShipmentStatusType.RECHAZADO, ShipmentStatusType.DIRECCION_INCORRECTA, ShipmentStatusType.CLIENTE_NO_DISPONIBLE, ShipmentStatusType.DEVUELTO_A_FEDEX, ShipmentStatusType.RETORNO_ABANDONO_FEDEX];
                     if (!allowed.includes(finalStatus)) isLocked = true;
                }

                if (!isLocked) {
                    for (const shipment of shipmentList) {
                        let hasChanges = false;
                        
                        // Actualizar estatus
                        if (shipment.status !== finalStatus) { 
                            shipment.status = finalStatus as any; 
                            hasChanges = true; 
                        }
                        
                        // Actualizar ID único
                        const newUniqueId = trackResult.trackingNumberInfo?.trackingNumberUniqueId;
                        if (newUniqueId && shipment.fedexUniqueId !== newUniqueId) { 
                            shipment.fedexUniqueId = newUniqueId; 
                            hasChanges = true; 
                        }
                        
                        // Actualizar Recibido Por
                        if (trackResult.deliveryDetails?.receivedByName && shipment.receivedByName !== trackResult.deliveryDetails.receivedByName) { 
                            shipment.receivedByName = trackResult.deliveryDetails.receivedByName; 
                            hasChanges = true; 
                        }
                        
                        if (hasChanges) await queryRunner.manager.save(Shipment, shipment);
                    }
                }
            }

            await queryRunner.commitTransaction();

          } catch (error) {
            this.logger.error(`[${tn}] Error Transacción: ${error.message}`);
            if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
          } finally {
            await queryRunner.release();
          }
        }));

        await Promise.all(tasks);
      }

      async processMasterFedexUpdate(shipmentsToUpdate: Shipment[]) {
        this.logger.log(`💎 Master Update (Titanium - Time Shield Edition): Procesando ${shipmentsToUpdate.length} guías...`);

        // 1. Agrupación por Tracking (Eficiencia Máxima)
        const shipmentsByTracking = shipmentsToUpdate.reduce((acc, s) => {
            if (!acc[s.trackingNumber]) acc[s.trackingNumber] = [];
            acc[s.trackingNumber].push(s.id);
            return acc;
        }, {} as Record<string, string[]>);

        const uniqueTrackingNumbers = Object.keys(shipmentsByTracking);
        const limit = pLimit(10); // Paralelismo controlado

        const tasks = uniqueTrackingNumbers.map((tn) => limit(async () => {
            const shipmentWithId = shipmentsToUpdate.find(s => s.trackingNumber === tn && s.fedexUniqueId);
            const currentUniqueId = shipmentWithId?.fedexUniqueId;

            // --- 1. CONSULTA FEDEX (Estrategia Proactiva) ---
            let fedexInfo;
            try {
                fedexInfo = await this.fedexService.trackPackage(tn, currentUniqueId);
            } catch (error) {
                this.logger.error(`[${tn}] Error API FedEx: ${error.message}`);
                return;
            }

            let allTrackResults = fedexInfo?.output?.completeTrackResults?.[0]?.trackResults || [];

            // 🚨 Reintento global si es Label Only o está vacío
            const isLabelOnly = allTrackResults.some(r => 
                r.latestStatusDetail?.code === 'OC' && (r.scanEvents?.length || 0) <= 1
            );

            if (isLabelOnly || allTrackResults.length === 0) {
                try {
                    const retryInfo = await this.fedexService.trackPackage(tn, undefined);
                    const retryResults = retryInfo?.output?.completeTrackResults?.[0]?.trackResults || [];
                    if (retryResults.length > 0) {
                        allTrackResults = retryResults;
                    }
                } catch (e) {
                    this.logger.warn(`[${tn}] Falló reintento global: ${e.message}`);
                }
            }

            if (allTrackResults.length === 0) return;

            // =================================================================================
            // 🛡️ CORRECCIÓN 1: SELECTOR DE GENERACIÓN (Jerarquía de UniqueID)
            // =================================================================================
            if (allTrackResults.length > 1) {
                allTrackResults.sort((a, b) => {
                    const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
                    const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
                    if (seqA !== seqB) return seqB - seqA;

                    const timeA = new Date(a.scanEvents?.[0]?.date || 0).getTime();
                    const timeB = new Date(b.scanEvents?.[0]?.date || 0).getTime();
                    return timeB - timeA;
                });

                const winner = allTrackResults[0];
                this.logger.log(`[${tn}] 🚀 Selector de Generación: Elegido ID ${winner.trackingNumberInfo?.trackingNumberUniqueId} (Secuencia Mayor).`);
            }

            const trackResult = allTrackResults[0]; 
            const scanEvents = trackResult.scanEvents || [];
            const lsdHeader = trackResult.latestStatusDetail;

            // --- 2. TRANSACCIÓN BD ---
            const queryRunner = this.dataSource.createQueryRunner();
            await queryRunner.connect();
            await queryRunner.startTransaction();

            try {
                const targetIds = shipmentsByTracking[tn];
                
                const shipmentList = await queryRunner.manager.find(Shipment, {
                    where: { id: In(targetIds) },
                    relations: ['subsidiary'],
                    lock: { mode: 'pessimistic_write' }
                });

                if (shipmentList.length === 0) {
                    await queryRunner.commitTransaction();
                    return;
                }

                const mainShipment = shipmentList[0];
                const subId = mainShipment.subsidiary?.id?.toLowerCase() || '';
                const configKeys = Object.keys(this.SUBSIDIARY_CONFIG);
                const matchedKey = configKeys.find(key => key.toLowerCase() === subId);
                const subConfig = matchedKey ? this.SUBSIDIARY_CONFIG[matchedKey] : { trackExternalDelivery: false };

                // 🛡️ HUELLA DIGITAL (Evita Duplicados en DB y localiza el INIT)
                const existingHistory = await queryRunner.manager.query(
                    `SELECT timestamp, exceptionCode FROM shipment_status WHERE shipmentId = ?`,
                    [mainShipment.id]
                );

                const processedSignatures = new Set(existingHistory.map(h => {
                    const t = new Date(h.timestamp).getTime();
                    const c = (h.exceptionCode || '').trim(); 
                    return `${t}_${c}`;
                }));

                const newEvents = scanEvents.filter(e => {
                    const t = new Date(e.date).getTime();
                    const c = (e.exceptionCode || '').trim();
                    const signature = `${t}_${c}`;
                    return !processedSignatures.has(signature);
                });

                // Orden cronológico para el procesamiento de Incomes e historial
                newEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                
                // --- 4. PROCESAMIENTO DE HISTORIA ---
                const existing08Count = await queryRunner.manager.count(ShipmentStatus, {
                    where: { shipment: { id: mainShipment.id }, exceptionCode: '08' }
                });
                let current08Count = existing08Count;
                const paidWeeks = new Set<string>();

                // 🛡️ Pre-validación: Verificamos si en algún punto FedEx tomó el control
                const hasODInHistory = subConfig.trackExternalDelivery && (scanEvents.some(e => e.eventType === 'OD') || lsdHeader?.code === 'OD');

                for (const event of newEvents) {
                    const eventDate = new Date(event.date);
                    const dCode = event.derivedStatusCode || '';
                    const eCode = (event.exceptionCode || '').trim();
                    
                    let eventStatus = mapFedexStatusToLocalStatus(dCode, eCode);

                    // 🛡️ BLINDAJE ANTI-COBROS FALSOS
                    // Si FedEx retomó el paquete (OD), forzamos las entregas (DL) a ENTREGADO_POR_FEDEX
                    if (hasODInHistory && (event.eventType === 'DL' || dCode === 'DL' || eCode === '005')) {
                        eventStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    } else if (eCode === '005') {
                        eventStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    }
                    
                    if (!Object.values(ShipmentStatusType).includes(eventStatus)) eventStatus = ShipmentStatusType.DESCONOCIDO;

                    if (subConfig.trackExternalDelivery && event.eventType === 'OD') {
                        eventStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                    }

                    // 4.1 GUARDAR HISTORIA
                    for (const ship of shipmentList) {
                        const historyEntry = queryRunner.manager.create(ShipmentStatus, {
                            status: eventStatus,
                            exceptionCode: eCode,
                            timestamp: eventDate,
                            shipment: ship,
                            notes: event.eventDescription || 'FedEx Scan'
                        });
                        await queryRunner.manager.save(historyEntry);
                    }

                    // --- GARANTÍA DE INGRESOS (BUCLE NORMAL) ---
                    let isChargeable = false;
                    let chargeReason = '';

                    // Gracias al blindaje de arriba, los entregados por FedEx no entrarán a este "if"
                    if (eventStatus === ShipmentStatusType.ENTREGADO) {
                        isChargeable = true;
                        chargeReason = 'ENTREGADO (DL)';
                    } else if (eCode === '07' || eventStatus === ShipmentStatusType.RECHAZADO) {
                        isChargeable = true;
                        chargeReason = `RECHAZADO (${eCode})`;
                    } else if (eCode === '08') {
                        current08Count++;
                        if (current08Count >= 3) {
                            isChargeable = true;
                            chargeReason = `3ra VISITA (Acumulado)`;
                        }
                    }

                    const mDate = dayjs(eventDate);
                    const weekKey = `${mDate.year()}-W${mDate.isoWeek()}`;
                    if (paidWeeks.has(weekKey)) isChargeable = false;

                    if (isChargeable) {
                        const startOfWeek = mDate.day(1).startOf('day').toDate();
                        const endOfWeek = mDate.day(7).endOf('day').toDate();
                        
                        const incomeExists = await queryRunner.manager.findOne(Income, {
                            where: { trackingNumber: tn, date: Between(startOfWeek, endOfWeek) }
                        });

                        if (!incomeExists) {
                            const tempShipment = { ...mainShipment };
                            if (chargeReason.includes('3ra VISITA')) tempShipment.status = ShipmentStatusType.CLIENTE_NO_DISPONIBLE as any;
                            else tempShipment.status = eventStatus as any;
                            
                            await this.generateIncomes(tempShipment as Shipment, eventDate, eCode, queryRunner.manager);
                            this.logger.log(`💰 Ingreso Generado [${tn}]: ${chargeReason}`);
                            paidWeeks.add(weekKey);
                        } else {
                            paidWeeks.add(weekKey);
                        }
                    }
                }

                // 🚨 SAFETY NET: RESPALDO FINANCIERO (Header Backup)
                const isDeliveredGlobal = (lsdHeader?.code === 'DL' || lsdHeader?.derivedCode === 'DL');
                if (isDeliveredGlobal && !hasODInHistory) {
                    const actualDeliveryDateStr = trackResult.dateAndTimes?.find(d => d.type === 'ACTUAL_DELIVERY')?.dateTime;
                    if (actualDeliveryDateStr) {
                        const deliveryDate = new Date(actualDeliveryDateStr);
                        const mDate = dayjs(deliveryDate);
                        const weekKey = `${mDate.year()}-W${mDate.isoWeek()}`;

                        if (!paidWeeks.has(weekKey)) {
                            const startOfWeek = mDate.day(1).startOf('day').toDate();
                            const endOfWeek = mDate.day(7).endOf('day').toDate();

                            const incomeExists = await queryRunner.manager.findOne(Income, {
                                where: { trackingNumber: tn, date: Between(startOfWeek, endOfWeek) }
                            });

                            if (!incomeExists) {
                                const tempShipment = { ...mainShipment, status: ShipmentStatusType.ENTREGADO as any };
                                await this.generateIncomes(tempShipment as Shipment, deliveryDate, 'DL', queryRunner.manager);
                                this.logger.log(`💰 Ingreso Generado (Backup Header) [${tn}]: ENTREGADO (DL)`);
                                paidWeeks.add(weekKey);
                            }
                        }
                    }
                }

                // =================================================================================
                // 🛡️ SECCIÓN 5: LÓGICA DE PESOS Y CONSENSO (CON BLINDAJE DE LÍNEA DE TIEMPO)
                // =================================================================================
                const getWeight = (status: any) => {
                  // 🏆 NIVEL 10: EL REY INDISCUTIBLE
                  if (status === ShipmentStatusType.ENTREGADO || status === ShipmentStatusType.ENTREGADO_POR_FEDEX) return 10;
                  
                  // 🚨 NIVEL 9: LOS DEX / EXCEPCIONES CRÍTICAS
                  if ([ShipmentStatusType.RECHAZADO, ShipmentStatusType.DIRECCION_INCORRECTA, ShipmentStatusType.CLIENTE_NO_DISPONIBLE, ShipmentStatusType.DEVUELTO_A_FEDEX, ShipmentStatusType.RETORNO_ABANDONO_FEDEX].includes(status)) return 9;
                  
                  // 🚚 NIVEL 8: TUS ESTATUS CUSTOM
                  if (status === ShipmentStatusType.EN_RUTA) return 8; 

                  // 🤝 NIVEL 6: TRANSICIÓN A TERCEROS
                  if (status === ShipmentStatusType.ACARGO_DE_FEDEX) return 6;
                  
                  // 📦 NIVEL 4: TU PRESENTE OPERATIVO INICIAL
                  if (status === ShipmentStatusType.PENDIENTE || status === ShipmentStatusType.EN_BODEGA) return 4;
                  
                  // ⏱️ NIVEL 3: EXCEPCIONES MENORES / RETRASOS DE FEDEX
                  if ([ShipmentStatusType.LLEGADO_DESPUES, ShipmentStatusType.CAMBIO_FECHA_SOLICITADO].includes(status)) return 3;
                  
                  // ✈️ NIVEL 2: VIAJES LOGÍSTICOS DE FEDEX
                  if (status === ShipmentStatusType.EN_TRANSITO || status === ShipmentStatusType.ESTACION_FEDEX) return 2;
                  
                  // 📍 NIVEL 1: EL ORIGEN
                  if (status === ShipmentStatusType.RECOLECCION) return 1;
                  
                  return 0; // DESCONOCIDO
                };

                // 1. Estatus según Header
                const headerStatus = mapFedexStatusToLocalStatus(lsdHeader?.derivedCode || lsdHeader?.code || '', lsdHeader?.ancillaryDetails?.[0]?.reason);
                
                // 2. Estatus según Historia (Respetando el corte de tiempo de tu operación)
                let historyStatus = ShipmentStatusType.DESCONOCIDO;
                let historyWeight = -1;
                
                // 🛡️ FILTRO TEMPORAL: Buscamos cuándo se creó el paquete en tu BD (El INIT)
                const initEvent = existingHistory.find(h => h.exceptionCode === 'INIT');
                const creationTime = initEvent ? new Date(initEvent.timestamp).getTime() : ((mainShipment as any).createdAt ? new Date((mainShipment as any).createdAt).getTime() : 0);

                // Nota: FedEx manda los scanEvents del MÁS NUEVO al MÁS VIEJO.
                for (const event of scanEvents) {
                    const eventTime = new Date(event.date).getTime();
                    
                    // Si el evento de FedEx pasó ANTES de que tú registraras el INIT, es historia muerta para el estatus final
                    if (eventTime < creationTime) {
                        continue;
                    }

                    const s = mapFedexStatusToLocalStatus(event.derivedStatusCode || '', event.exceptionCode || '');
                    const w = getWeight(s);
                    
                    // > asegura que en empates gane el más nuevo
                    if (w > historyWeight) { 
                        historyStatus = s; 
                        historyWeight = w; 
                    }
                }

                // 3. Decisión de Consenso
                let finalStatus = (historyWeight > getWeight(headerStatus)) ? historyStatus : headerStatus;

                // 4. Prioridad de Entrega Absoluta 
                if (lsdHeader?.code === 'DL' || lsdHeader?.derivedCode === 'DL' || scanEvents.some(e => e.derivedStatusCode === 'DL' || e.eventType === 'DL')) {
                    finalStatus = ShipmentStatusType.ENTREGADO;
                }

                // 5. Aplicación de OD (Subsidiarias)
                if (subConfig.trackExternalDelivery) {
                    if (hasODInHistory && finalStatus !== ShipmentStatusType.ENTREGADO && finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
                        finalStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                    } else if (finalStatus === ShipmentStatusType.ENTREGADO && hasODInHistory) {
                        finalStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    }
                }

                // =================================================================================
                // 🛡️ SECCIÓN 6: CANDADOS DE INTEGRIDAD Y GUARDADO FINAL
                // =================================================================================
                const dbWeight = getWeight(mainShipment.status);
                const targetWeight = getWeight(finalStatus);
                
                // Regla de Oro 1: Una entrega en DB no se revierte
                let isLocked = (mainShipment.status === ShipmentStatusType.ENTREGADO && finalStatus !== ShipmentStatusType.ENTREGADO);

                // Regla de Oro 2 (Escudo de Oro): Bloquear si el estatus guardado pesa más que el de FedEx
                if (!isLocked && dbWeight > targetWeight && finalStatus !== ShipmentStatusType.ENTREGADO) {
                    
                    // 🔄 VÁLVULA DE ESCAPE (Anti-Cobros Falsos)
                    // Permite a FedEx "robarse" el paquete si lanzó un OD, incluso si nosotros lo teníamos en ruta
                    const isFedexTakingBack = (mainShipment.status === ShipmentStatusType.EN_RUTA || mainShipment.status === ShipmentStatusType.EN_BODEGA || mainShipment.status === ShipmentStatusType.PENDIENTE) 
                                               && finalStatus === ShipmentStatusType.ACARGO_DE_FEDEX;

                    if (isFedexTakingBack) {
                        this.logger.warn(`[${tn}] 🔄 Válvula de Escape: FedEx retomó control (OD) desde ${mainShipment.status}. Permitido para evitar falso income.`);
                    } else {
                        this.logger.warn(`[${tn}] 🔒 Escudo de Oro: Bloqueado retroceso de ${mainShipment.status} (Peso ${dbWeight}) a ${finalStatus} (Peso ${targetWeight})`);
                        isLocked = true; 
                    }
                }

                // Regla de Oro 3: Return Lock
                if (!isLocked && (mainShipment.status === ShipmentStatusType.DEVUELTO_A_FEDEX || mainShipment.status === ShipmentStatusType.RETORNO_ABANDONO_FEDEX)) {
                    const allowedStatusForReturn = [
                        ShipmentStatusType.ENTREGADO, ShipmentStatusType.ENTREGADO_POR_FEDEX, 
                        ShipmentStatusType.RECHAZADO, ShipmentStatusType.DIRECCION_INCORRECTA, 
                        ShipmentStatusType.CLIENTE_NO_DISPONIBLE, ShipmentStatusType.DEVUELTO_A_FEDEX, 
                        ShipmentStatusType.RETORNO_ABANDONO_FEDEX
                    ];
                    if (!allowedStatusForReturn.includes(finalStatus as any)) {
                        isLocked = true;
                    }
                }

                if (!isLocked) {
                    const newUniqueId = trackResult.trackingNumberInfo?.trackingNumberUniqueId;
                    const newReceivedBy = trackResult.deliveryDetails?.receivedByName;

                    for (const ship of shipmentList) {
                        let hasChanges = false;
                        
                        if (ship.status !== finalStatus) { 
                            ship.status = finalStatus as any; 
                            hasChanges = true; 
                        }
                        if (newUniqueId && ship.fedexUniqueId !== newUniqueId) { 
                            ship.fedexUniqueId = newUniqueId; 
                            hasChanges = true; 
                        }
                        if (newReceivedBy && ship.receivedByName !== newReceivedBy) { 
                            ship.receivedByName = newReceivedBy; 
                            hasChanges = true; 
                        }
                        
                        if (hasChanges) {
                            await queryRunner.manager.save(Shipment, ship);
                        }
                    }
                }

                await queryRunner.commitTransaction();

            } catch (error) {
                this.logger.error(`[${tn}] Error Transacción: ${error.message}`);
                if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
            } finally {
                await queryRunner.release();
            }
        }));

        await Promise.all(tasks);
      }

      async processChargeFedexUpdate(chargeShipmentsToUpdate: ChargeShipment[]) {
        this.logger.log(`🛡️ F2 Charge Update (Titanium Deep Scan): Procesando ${chargeShipmentsToUpdate.length} cargas...`);

        // 1. Agrupación por Tracking
        const shipmentsByTracking = chargeShipmentsToUpdate.reduce((acc, s) => {
            if (!acc[s.trackingNumber]) acc[s.trackingNumber] = [];
            acc[s.trackingNumber].push(s.id);
            return acc;
        }, {} as Record<string, string[]>);

        const uniqueTrackingNumbers = Object.keys(shipmentsByTracking);
        const limit = pLimit(5); 

        const tasks = uniqueTrackingNumbers.map((tn) => limit(async () => {
            const chargeWithId = chargeShipmentsToUpdate.find(s => s.trackingNumber === tn && (s as any).fedexUniqueId);
            const currentUniqueId = (chargeWithId as any)?.fedexUniqueId;

            // --- 1. API FedEx ---
            let fedexInfo;
            try {
                fedexInfo = await this.fedexService.trackPackage(tn, currentUniqueId);
            } catch (error) {
                this.logger.error(`[F2 - ${tn}] ❌ Error API FedEx: ${error.message}`);
                return;
            }

            let allTrackResults = fedexInfo?.output?.completeTrackResults?.[0]?.trackResults || [];

            // =================================================================================
            // 🚨 PROTECCIÓN 1: DETECCIÓN DE "LABEL ONLY" Y REINTENTO GLOBAL
            // =================================================================================
            const isLabelOnly = allTrackResults.some(r => 
                r.latestStatusDetail?.code === 'OC' && (r.scanEvents?.length || 0) <= 1
            );

            if (isLabelOnly || allTrackResults.length === 0) {
                try {
                    const retryInfo = await this.fedexService.trackPackage(tn, undefined);
                    const retryResults = retryInfo?.output?.completeTrackResults?.[0]?.trackResults || [];
                    if (retryResults.length > 0) {
                        allTrackResults = retryResults;
                    }
                } catch (e) {
                    this.logger.warn(`[F2 - ${tn}] Falló reintento global: ${e.message}`);
                }
            }

            if (allTrackResults.length === 0) return;

            // Filtro de 6 meses
            const validResults = allTrackResults.filter(result => {
                if (!result.scanEvents?.length) return true;
                const dates = result.scanEvents.map(e => new Date(e.date).getTime());
                return Math.max(...dates) > (Date.now() - (180 * 24 * 60 * 60 * 1000));
            });
            
            if (validResults.length === 0) return;

            // =================================================================================
            // 🛡️ PROTECCIÓN 2: SELECTOR DE GENERACIÓN (JERARQUÍA UNIQUEID)
            // =================================================================================
            if (validResults.length > 1) {
                validResults.sort((a, b) => {
                    const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
                    const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
                    return seqB - seqA; // El ID más alto es el más nuevo
                });
            }

            const trackResult = validResults[0];
            const scanEvents = trackResult.scanEvents || [];
            const lsdHeader = trackResult.latestStatusDetail;

            // --- 2. TRANSACCIÓN BD ---
            const queryRunner = this.dataSource.createQueryRunner();
            await queryRunner.connect();
            await queryRunner.startTransaction();

            try {
                const targetIds = shipmentsByTracking[tn]; 
                
                const chargeList = await queryRunner.manager.find(ChargeShipment, {
                    where: { id: In(targetIds) }, 
                    relations: ['subsidiary'],
                    lock: { mode: 'pessimistic_write' }
                });

                if (chargeList.length === 0) {
                     await queryRunner.commitTransaction();
                     return;
                }

                const mainCharge = chargeList[0];
                const subId = mainCharge.subsidiary?.id?.toLowerCase() || '';
                const configKeys = Object.keys(this.SUBSIDIARY_CONFIG);
                const matchedKey = configKeys.find(key => key.toLowerCase() === subId);
                const subConfig = matchedKey ? this.SUBSIDIARY_CONFIG[matchedKey] : { trackExternalDelivery: false };

                // HUELLA DIGITAL (Evita Duplicados en Historial)
                const existingHistory = await queryRunner.manager.query(
                    `SELECT timestamp, exceptionCode FROM shipment_status WHERE chargeShipmentId = ?`,
                    [mainCharge.id]
                );

                const processedSignatures = new Set(existingHistory.map(h => {
                    const t = new Date(h.timestamp).getTime();
                    const c = (h.exceptionCode || '').trim(); 
                    return `${t}_${c}`;
                }));

                const newEvents = scanEvents.filter(e => {
                    const t = new Date(e.date).getTime();
                    const c = (e.exceptionCode || e.derivedStatusCode || e.eventType || '').trim();
                    const signature = `${t}_${c}`;
                    return !processedSignatures.has(signature);
                });

                newEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                // GUARDAR NUEVOS EVENTOS
                for (const event of newEvents) {
                    const eCode = (event.exceptionCode || '').trim();
                    const dCode = (event.derivedStatusCode || '').trim();
                    let codeToSave = eCode || dCode || event.eventType;

                    let mappedStatus = mapFedexStatusToLocalStatus(dCode, eCode);
                    if (codeToSave === '67') mappedStatus = ShipmentStatusType.PENDIENTE; // Regla del 67
                    if (codeToSave === '005') mappedStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    if (mappedStatus === ShipmentStatusType.DESCONOCIDO) continue;

                    for (const charge of chargeList) {
                        const historyEntry = queryRunner.manager.create(ShipmentStatus, {
                            status: mappedStatus,
                            exceptionCode: codeToSave,
                            timestamp: new Date(event.date),
                            chargeShipment: charge,
                            notes: event.exceptionDescription ? `[${codeToSave}] ${event.exceptionDescription}` : `[${codeToSave}] ${event.eventDescription}`
                        });
                        await queryRunner.manager.save(historyEntry);
                    }
                }

                // =================================================================================
                // 🛡️ SECCIÓN 5: LÓGICA DE PESOS Y CONSENSO (VALIDACIÓN CRUZADA)
                // =================================================================================
                const getWeight = (status: any) => {
                    if (status === ShipmentStatusType.ENTREGADO || status === ShipmentStatusType.ENTREGADO_POR_FEDEX) return 10;
                    if ([ShipmentStatusType.RECHAZADO, ShipmentStatusType.DIRECCION_INCORRECTA, ShipmentStatusType.CLIENTE_NO_DISPONIBLE, ShipmentStatusType.RETORNO_ABANDONO_FEDEX, ShipmentStatusType.LLEGADO_DESPUES].includes(status)) return 5;
                    if (status !== ShipmentStatusType.DESCONOCIDO && status !== ShipmentStatusType.PENDIENTE && status !== ShipmentStatusType.EN_TRANSITO) return 1;
                    return 0;
                };

                // 1. Estatus según Header
                const headerStatus = mapFedexStatusToLocalStatus(lsdHeader?.derivedCode || lsdHeader?.code || '', lsdHeader?.ancillaryDetails?.[0]?.reason);
                
                // 2. Estatus según Historia Completa (buscamos el evento más pesado)
                let historyStatus = ShipmentStatusType.DESCONOCIDO;
                let historyWeight = -1;
                for (const event of scanEvents) {
                    const eCode = (event.exceptionCode || '').trim();
                    const dCode = (event.derivedStatusCode || '').trim();
                    let s = mapFedexStatusToLocalStatus(dCode, eCode);
                    if (eCode === '67' || dCode === '67') s = ShipmentStatusType.PENDIENTE;
                    
                    const w = getWeight(s);
                    if (w >= historyWeight) { 
                        historyStatus = s; 
                        historyWeight = w; 
                    }
                }

                // 3. Consenso Final
                let finalStatus = (historyWeight > getWeight(headerStatus)) ? historyStatus : headerStatus;

                // 4. Prioridad Absoluta de Entrega
                if (lsdHeader?.code === 'DL' || lsdHeader?.derivedCode === 'DL' || scanEvents.some(e => e.derivedStatusCode === 'DL')) {
                    finalStatus = ShipmentStatusType.ENTREGADO;
                }

                // 5. Aplicación de OD
                if (subConfig.trackExternalDelivery) {
                    const hasODSignal = (lsdHeader?.code === 'OD' || scanEvents.some(e => e.eventType === 'OD'));
                    if (hasODSignal && finalStatus !== ShipmentStatusType.ENTREGADO && finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
                        finalStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                    } else if (finalStatus === ShipmentStatusType.ENTREGADO && scanEvents.some(e => e.eventType === 'OD')) {
                        finalStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    }
                }

                // =================================================================================
                // 🛡️ SECCIÓN 6: CANDADOS DE INTEGRIDAD (ESCUDO DE ORO)
                // =================================================================================
                const dbWeight = getWeight(mainCharge.status);
                const targetWeight = getWeight(finalStatus);
                
                // Regla 1: No des-entregar
                let isLocked = (mainCharge.status === ShipmentStatusType.ENTREGADO && finalStatus !== ShipmentStatusType.ENTREGADO);

                // Regla 2 (Escudo de Oro): No degradar un error real (Peso 5) a algo genérico (Peso < 5)
                if (!isLocked && dbWeight >= 5 && targetWeight < 5 && finalStatus !== ShipmentStatusType.ENTREGADO) {
                    this.logger.warn(`[F2 - ${tn}] 🔒 Escudo de Oro: Bloqueada degradación de ${mainCharge.status} a ${finalStatus}`);
                    isLocked = true; 
                }

                // Regla 3: Return Lock
                if (!isLocked && (mainCharge.status === ShipmentStatusType.DEVUELTO_A_FEDEX || mainCharge.status === ShipmentStatusType.RETORNO_ABANDONO_FEDEX)) {
                     const allowedReturn = [ShipmentStatusType.ENTREGADO, ShipmentStatusType.ENTREGADO_POR_FEDEX, ShipmentStatusType.RECHAZADO, ShipmentStatusType.DIRECCION_INCORRECTA, ShipmentStatusType.CLIENTE_NO_DISPONIBLE, ShipmentStatusType.DEVUELTO_A_FEDEX, ShipmentStatusType.RETORNO_ABANDONO_FEDEX];
                     if (!allowedReturn.includes(finalStatus as any)) isLocked = true;
                }

                // --- 7. GUARDADO FINAL ---
                if (!isLocked) {
                    const newUniqueId = trackResult.trackingNumberInfo?.trackingNumberUniqueId;
                    const newReceivedBy = trackResult.deliveryDetails?.receivedByName;

                    for (const charge of chargeList) {
                        let hasChanges = false;
                        
                        if (charge.status !== finalStatus) { 
                            charge.status = finalStatus as any; 
                            hasChanges = true; 
                        }
                        if (newUniqueId && (charge as any).fedexUniqueId !== newUniqueId) { 
                            (charge as any).fedexUniqueId = newUniqueId; 
                            hasChanges = true; 
                        }
                        if (newReceivedBy && charge.receivedByName !== newReceivedBy) { 
                            charge.receivedByName = newReceivedBy; 
                            hasChanges = true; 
                        }
                        
                        if (hasChanges) {
                            await queryRunner.manager.save(ChargeShipment, charge);
                        }
                    }
                }

                await queryRunner.commitTransaction();

            } catch (error) {
                this.logger.error(`[F2 - ${tn}] 💥 Error Transacción: ${error.message}`);
                if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
            } finally {
                await queryRunner.release();
            }
        }));

        await Promise.all(tasks);
      }  

     /************************************************************** */

      async syncShipmentsStatusByDispatchTracking(trackingNumber: string): Promise<void> {
        this.logger.log(`🔍 Iniciando validación de estatus para Dispatch: ${trackingNumber}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
          // 1. Buscar el Dispatch por trackingNumber y obtener sus Shipments
          // Cargamos la relación 'shipments' para tener los IDs
          const dispatch = await queryRunner.manager.findOne(PackageDispatch, {
            where: { trackingNumber: trackingNumber },
            relations: ['shipments']
          });

          if (!dispatch) {
            throw new Error(`No se encontró el package_dispatch con tracking: ${trackingNumber}`);
          }

          if (!dispatch.shipments || dispatch.shipments.length === 0) {
            this.logger.warn(`El dispatch ${trackingNumber} no tiene shipments asociados.`);
            await queryRunner.rollbackTransaction();
            return;
          }

          this.logger.log(`📦 Procesando ${dispatch.shipments.length} paquetes del dispatch ID: ${dispatch.id}`);

          for (const shipment of dispatch.shipments) {
            // 2. Buscar la última historia de este shipment específico
            // Ordenamos por timestamp descendente para obtener el evento más reciente
            const lastHistory = await queryRunner.manager.findOne(ShipmentStatus, {
              where: { shipment: { id: shipment.id } },
              order: { timestamp: 'DESC' }
            });

            if (!lastHistory) {
              this.logger.warn(`⚠️ El shipment ${shipment.trackingNumber} no tiene historial de estatus.`);
              continue;
            }

            // 3. Comparar el estatus del Maestro vs la última Historia
            if (shipment.status !== lastHistory.status) {
              this.logger.warn(
                `❌ Desincronización detectada en ${shipment.trackingNumber}: ` +
                `Maestro(${shipment.status}) vs Historia(${lastHistory.status}). Corrigiendo...`
              );

              // 4. Corregir el estatus del Shipment Maestro
              shipment.status = lastHistory.status;
              
              // Usamos save para persistir el cambio en el objeto cargado
              await queryRunner.manager.save(Shipment, shipment);
              
              this.logger.log(`✅ Shipment ${shipment.trackingNumber} actualizado a ${lastHistory.status}`);
            } else {
              this.logger.log(`|| ${shipment.trackingNumber} está correcto (${shipment.status})`);
            }
          }

          await queryRunner.commitTransaction();
          this.logger.log(`🎉 Proceso de sincronización para Dispatch ${trackingNumber} completado.`);

        } catch (error) {
          this.logger.error(`💥 Error sincronizando dispatch ${trackingNumber}: ${error.message}`);
          if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
          throw error;
        } finally {
          await queryRunner.release();
        }
      }

      /**
       * Método Orquestador: Obtiene IDs específicos de Shipments
       * Normaliza cualquier entrada (Entity ID o Trackings) a un array de Shipment IDs (UUIDs)
       */
      async auditByEntity(
        type: 'trackings' | 'dispatch' | 'consolidated' | 'unloading',
        idOrList: string | string[],
        applyFix: boolean = false
      ) {
        let shipmentIds: string[] = [];
        
        // 1. Normalización y Limpieza de nulos/vacíos
        const inputList = (Array.isArray(idOrList) ? idOrList : [idOrList])
            .filter(val => val && val.trim() !== '');

        if (inputList.length === 0) {
            return { status: 'NO_DATA', message: 'No se proporcionaron datos válidos para auditar.' };
        }

        this.logger.log(`🔎 Audit By Entity [${type}]: Buscando referencias para ${inputList.length} items...`);

        switch (type) {
          case 'trackings':
            const shipmentsT = await this.shipmentRepository.find({
                where: { trackingNumber: In(inputList) },
                select: ['id']
            });
            shipmentIds = shipmentsT.map(s => s.id);
            break;

          case 'dispatch':
            // SOPORTE HÍBRIDO: Busca por ID del despacho (uuid) O por TrackingNumber del despacho
            // Nota: Verifica que 'trackingNumber' sea el nombre real de la columna en tu entidad PackageDispatch
            const shipmentsD = await this.shipmentRepository.find({
              where: [
                  { packageDispatch: { id: In(inputList) } },             // Caso 1: IDs
                  { packageDispatch: { trackingNumber: In(inputList) } }  // Caso 2: Trackings de Despacho
              ],
              select: ['id']
            });
            shipmentIds = shipmentsD.map(s => s.id);
            break;

          case 'consolidated':
            // CORRECCIÓN APLICADA AQUÍ: Quitamos las llaves extra en In()
            const shipmentsC = await this.shipmentRepository.find({
              where: [
                  { consolidatedId: In(inputList) },    // Caso 1: UUIDs directos
                  { consNumber: In(inputList) }         // Caso 2: Folios Públicos (ej. CON-2026)
              ],
              select: ['id']
            });
            shipmentIds = shipmentsC.map(s => s.id);
            break;

          case 'unloading':
             // SOPORTE HÍBRIDO: Busca por ID de Unloading O por TrackingNumber de Unloading
            const shipmentsU = await this.shipmentRepository.find({
              where: [
                  { unloading: { id: In(inputList) } },             // Caso 1: IDs
                  { unloading: { trackingNumber: In(inputList) } }  // Caso 2: Trackings
              ],
              select: ['id']
            });
            shipmentIds = shipmentsU.map(s => s.id);
            break;
        }

        // Eliminamos duplicados por seguridad (si un ID y un Folio apuntan a lo mismo)
        shipmentIds = [...new Set(shipmentIds)];

        if (!shipmentIds || shipmentIds.length === 0) {
          return { 
              status: 'NO_MATCH', 
              message: `No se encontraron guías vinculadas a ${type} con los datos proporcionados.` 
          };
        }

        this.logger.log(`🚀 Iniciando Auditoría Titanium para ${shipmentIds.length} guías encontradas...`);

        // Llamamos al método fix pasando los UUIDs recolectados
        return await this.auditAndFixFedexShipments(shipmentIds, applyFix);
      }
      
      async auditAndFixFedexShipments(shipmentIds: string[], applyFix: boolean = false) {
        const limit = pLimit(5);
        const logDir = './logs';
        const logFile = `${logDir}/audit_forensic_${new Date().toISOString().replace(/:/g, '-')}.txt`;

        if (!fsSync.existsSync(logDir)) fsSync.mkdirSync(logDir, { recursive: true });

        const tasks = shipmentIds.map((shipmentId) => limit(async () => {
            const queryRunner = this.dataSource.createQueryRunner();
            await queryRunner.connect();
            await queryRunner.startTransaction();

            const audit = {
                shipmentId: shipmentId,
                tracking: 'PENDING',
                status: 'PENDING',
                analysis: [] as string[],
                actions: [] as string[],
                detected_incomes: 0,
                recovered_incomes: 0
            };

            try {
                // 1. OBTENER DATOS BD
                const shipment = await queryRunner.manager.findOne(Shipment, {
                    where: { id: shipmentId },
                    relations: ['subsidiary']
                });

                if (!shipment) {
                    audit.status = 'NOT_FOUND_IN_DB';
                    await queryRunner.rollbackTransaction();
                    return audit;
                }

                audit.tracking = shipment.trackingNumber;
                const tn = shipment.trackingNumber;
                const dbStatus = shipment.status as any;

                // 2. OBTENER DATOS FEDEX
                let fedexInfo;
                try {
                    fedexInfo = await this.fedexService.trackPackage(tn, shipment.fedexUniqueId || undefined);
                } catch (e) {
                    audit.status = 'FEDEX_API_ERROR';
                    audit.analysis.push(`Error API: ${e.message}`);
                    await queryRunner.rollbackTransaction();
                    return audit;
                }

                let allTrackResults = fedexInfo?.output?.completeTrackResults?.[0]?.trackResults || [];
                
                // 🚨 REINTENTO GLOBAL (Mantenido de tu lógica original)
                if (allTrackResults.length === 0) {
                    audit.analysis.push("🔍 Sin datos iniciales. Intentando consulta global...");
                    try {
                        const globalInfo = await this.fedexService.trackPackage(tn, undefined);
                        allTrackResults = globalInfo?.output?.completeTrackResults?.[0]?.trackResults || [];
                    } catch (retryError) {
                        audit.analysis.push(`❌ Error reintento global: ${retryError.message}`);
                    }
                }

                if (allTrackResults.length === 0) {
                    audit.status = 'NO_DATA_FEDEX';
                    audit.analysis.push("Sin datos en FedEx tras reintento");
                    await queryRunner.rollbackTransaction();
                    return audit;
                }

                // =================================================================================
                // 🛡️ CORRECCIÓN 1: SELECTOR DE GENERACIÓN (Jerarquía de UniqueID)
                // =================================================================================
                if (allTrackResults.length > 1) {
                    allTrackResults.sort((a, b) => {
                        // Extraemos la secuencia numérica del inicio del UniqueID (ej: 2461089000)
                        const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
                        const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');

                        // La secuencia más alta es SIEMPRE la más reciente (la nueva vida de la guía)
                        if (seqA !== seqB) return seqB - seqA;

                        // Respaldo por fecha solo si los IDs son idénticos (muy raro)
                        const timeA = new Date(a.scanEvents?.[0]?.date || 0).getTime();
                        const timeB = new Date(b.scanEvents?.[0]?.date || 0).getTime();
                        return timeB - timeA;
                    });

                    const winner = allTrackResults[0];
                    this.logger.log(`[${tn}] 🚀 Selector de Generación: Elegido ID ${winner.trackingNumberInfo.trackingNumberUniqueId} (Secuencia Mayor).`);
                }

                const trackResult = allTrackResults[0]; 
                const scanEvents = trackResult.scanEvents || [];
                const lsd = trackResult.latestStatusDetail;
                const chronologicalEvents = [...scanEvents].sort((a, b) => 
                    new Date(a.date).getTime() - new Date(b.date).getTime()
                );

                // 🛡️ HUELLA DIGITAL (Mantenida)
                const existingHistory = await queryRunner.manager.query(
                    `SELECT timestamp, exceptionCode FROM shipment_status WHERE shipmentId = ?`,
                    [shipment.id]
                );
                const processedSignatures = new Set(existingHistory.map(h => {
                    const t = new Date(h.timestamp).getTime();
                    const c = (h.exceptionCode || '').trim();
                    return `${t}_${c}`;
                }));

                // 3. ANÁLISIS FORENSE (Event Loop)
                let count08 = 0;
                const subId = shipment.subsidiary?.id?.toLowerCase();
                const configKeys = Object.keys(this.SUBSIDIARY_CONFIG);
                const matchedKey = configKeys.find(key => key.toLowerCase() === subId);
                const subConfig = matchedKey ? this.SUBSIDIARY_CONFIG[matchedKey] : { trackExternalDelivery: false };
                const paidWeeks = new Set<string>();

                for (const event of chronologicalEvents) {
                    const evtCode = (event.exceptionCode || '').trim();
                    const evtDate = new Date(event.date);
                    let evtStatus = mapFedexStatusToLocalStatus(event.derivedStatusCode || '', evtCode);

                    if (evtCode === '005') evtStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    if (subConfig.trackExternalDelivery && event.eventType === 'OD') evtStatus = ShipmentStatusType.ACARGO_DE_FEDEX;

                    // A. Recuperación de Historia
                    const signature = `${evtDate.getTime()}_${evtCode}`;
                    if (!processedSignatures.has(signature)) {
                        if (applyFix) {
                            const historyEntry = queryRunner.manager.create(ShipmentStatus, {
                                status: evtStatus,
                                exceptionCode: evtCode,
                                timestamp: evtDate,
                                shipment: shipment,
                                notes: event.eventDescription || 'FedEx Scan (Recovered)'
                            });
                            await queryRunner.manager.save(historyEntry);
                            processedSignatures.add(signature); 
                            audit.actions.push(`✅ Historia recuperada: [${evtCode || 'N/A'}] -> ${evtStatus}`);
                        } else {
                            audit.analysis.push(`📜 Falta evento: ${evtCode} (${evtStatus})`);
                        }
                    }

                    // B. Cobros (Mantenido)
                    let shouldCharge = false;
                    let chargeReason = '';
                    if (evtStatus === ShipmentStatusType.ENTREGADO) { shouldCharge = true; chargeReason = 'ENTREGADO (DL)'; } 
                    else if (evtCode === '07' || evtStatus === ShipmentStatusType.RECHAZADO) { shouldCharge = true; chargeReason = `RECHAZADO (${evtCode})`; } 
                    else if (evtCode === '08') {
                        count08++;
                        if (count08 >= 3) { shouldCharge = true; chargeReason = `3ra VISITA (08)`; }
                    }

                    const mDate = dayjs(evtDate);
                    const weekKey = `${mDate.year()}-W${mDate.isoWeek()}`;
                    if (shouldCharge && !paidWeeks.has(weekKey)) {
                        audit.detected_incomes++;
                        const incomeExists = await queryRunner.manager.findOne(Income, {
                            where: { trackingNumber: tn, date: Between(mDate.startOf('week').toDate(), mDate.endOf('week').toDate()) }
                        });
                        if (!incomeExists) {
                            if (applyFix) {
                                const tempShipment = { ...shipment, status: (chargeReason.includes('3ra') ? ShipmentStatusType.CLIENTE_NO_DISPONIBLE : evtStatus) as any };
                                await this.generateIncomes(tempShipment as Shipment, evtDate, evtCode, queryRunner.manager);
                                audit.recovered_incomes++;
                                audit.actions.push(`✅ Ingreso GENERADO: ${chargeReason}`);
                            } else {
                                audit.analysis.push(`💰 FALTA INGRESO: ${chargeReason} - Semana ${weekKey}`);
                            }
                        }
                        paidWeeks.add(weekKey);
                    }
                }

                // 🚨 SAFETY NET (Mantenido)
                const isDeliveredGlobal = (lsd?.code === 'DL' || lsd?.derivedCode === 'DL');
                if (audit.detected_incomes === 0 && isDeliveredGlobal) {
                    const actualDeliveryDateStr = trackResult.dateAndTimes?.find(d => d.type === 'ACTUAL_DELIVERY')?.dateTime;
                    if (actualDeliveryDateStr) {
                        const deliveryDate = new Date(actualDeliveryDateStr);
                        const mDate = dayjs(deliveryDate);
                        const weekKey = `${mDate.year()}-W${mDate.isoWeek()}`;
                        if (!paidWeeks.has(weekKey)) {
                            const incomeExists = await queryRunner.manager.findOne(Income, {
                                where: { trackingNumber: tn, date: Between(mDate.startOf('week').toDate(), mDate.endOf('week').toDate()) }
                            });
                            if (!incomeExists) {
                                if (applyFix) {
                                    const tempShipment = { ...shipment, status: ShipmentStatusType.ENTREGADO as any };
                                    await this.generateIncomes(tempShipment as Shipment, deliveryDate, 'DL', queryRunner.manager);
                                    audit.recovered_incomes++;
                                    audit.actions.push(`✅ Ingreso GENERADO via Safety Net.`);
                                } else {
                                    audit.analysis.push(`🚨 RESCATE: Entregado según Header pero sin ingreso.`);
                                }
                            }
                        }
                    }
                }

                // =========================================================
                // 🚨 SECCIÓN 4: ESTATUS FINAL (REESTRUCTURADA PARA SEGURIDAD)
                // =========================================================
                const getWeight = (status: any) => {
                    if (status === ShipmentStatusType.ENTREGADO || status === ShipmentStatusType.ENTREGADO_POR_FEDEX) return 10;
                    if ([ShipmentStatusType.RECHAZADO, ShipmentStatusType.DIRECCION_INCORRECTA, ShipmentStatusType.CLIENTE_NO_DISPONIBLE, ShipmentStatusType.RETORNO_ABANDONO_FEDEX, ShipmentStatusType.LLEGADO_DESPUES].includes(status)) return 5;
                    if (status !== ShipmentStatusType.DESCONOCIDO && status !== ShipmentStatusType.PENDIENTE && status !== ShipmentStatusType.EN_TRANSITO) return 1;
                    return 0;
                };

                // 1. Proposición del Header
                const headerStatus = mapFedexStatusToLocalStatus(lsd?.derivedCode || lsd?.code || '', lsd?.ancillaryDetails?.[0]?.reason);
                
                // 2. Proposición de la Historia (Buscamos la falla más específica)
                let historyStatus = ShipmentStatusType.DESCONOCIDO;
                let historyWeight = -1;
                for (const event of scanEvents) {
                    const s = mapFedexStatusToLocalStatus(event.derivedStatusCode || '', event.exceptionCode || '');
                    const w = getWeight(s);
                    if (w >= historyWeight) { historyStatus = s; historyWeight = w; }
                }

                // 3. Consenso Final
                let targetStatus = headerStatus;
                if (historyWeight > getWeight(headerStatus)) {
                    targetStatus = historyStatus;
                    audit.analysis.push(`⚖️ Consenso: Historia (${historyStatus}) domina encabezado genérico.`);
                }

                // 4. Candados (IRON LOCK + PRIORITY PROTECT)
                const dbWeight = getWeight(dbStatus);
                let lockReason = null;

                if (dbStatus === ShipmentStatusType.ENTREGADO && targetStatus !== ShipmentStatusType.ENTREGADO) {
                    lockReason = `🔒 IRON LOCK (Entregado en DB no se toca)`;
                } else if (dbWeight >= 5 && getWeight(targetStatus) < 5 && targetStatus !== ShipmentStatusType.ENTREGADO) {
                    lockReason = `🔒 PRIORITY PROTECT: No degradar ${dbStatus} a ${targetStatus}`;
                }

                if (lockReason) {
                    audit.analysis.push(lockReason);
                    targetStatus = dbStatus; // Mantenemos el de la DB
                }

                // --- 5. APLICACIÓN DE CAMBIOS (Mantenido con ChargeShipment) ---
                const newUniqueId = trackResult.trackingNumberInfo?.trackingNumberUniqueId;
                const newReceivedBy = trackResult.deliveryDetails?.receivedByName;
                const statusChanged = shipment.status !== targetStatus;
                const idChanged = newUniqueId && shipment.fedexUniqueId !== newUniqueId;
                const receivedChanged = newReceivedBy && shipment.receivedByName !== newReceivedBy;

                if (statusChanged || idChanged || receivedChanged) {
                    if (statusChanged) audit.analysis.push(`🔄 Diferencias: Estatus ${shipment.status}->${targetStatus}`);
                    
                    if (applyFix) {
                        shipment.status = targetStatus as any;
                        if (idChanged) shipment.fedexUniqueId = newUniqueId;
                        if (receivedChanged) shipment.receivedByName = newReceivedBy;
                        await queryRunner.manager.save(Shipment, shipment);
                        
                        // Sincronizar ChargeShipment (Tu bloque original)
                        const charges = await queryRunner.manager.find(ChargeShipment, { where: { trackingNumber: tn } });
                        for (const c of charges) {
                            c.status = targetStatus as any;
                            if (receivedChanged) c.receivedByName = newReceivedBy;
                            await queryRunner.manager.save(ChargeShipment, c);
                        }
                        audit.actions.push(`✅ Sincronización completa aplicada.`);
                    } else {
                        audit.actions.push(`⚠️ Sugerencia: Sincronizar a ${targetStatus}.`);
                    }
                }

                await queryRunner.commitTransaction();
                audit.status = applyFix && audit.actions.length > 0 ? 'FIXED' : (audit.analysis.length > 0 ? 'ISSUES_FOUND' : 'HEALTHY');
                if (audit.status !== 'HEALTHY') this.logDeepAudit(logFile, audit, applyFix);
                return audit;

            } catch (e) {
                if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
                const errorAudit = { ...audit, status: 'ERROR', analysis: [e.message] };
                this.logDeepAudit(logFile, errorAudit, applyFix);
                return errorAudit;
            } finally {
                await queryRunner.release();
            }
        }));

        const results = await Promise.all(tasks);
        return {
            summary: {
                total_processed: results.length,
                healthy: results.filter(r => r.status === 'HEALTHY').length,
                issues_found: results.filter(r => r.status !== 'HEALTHY').length,
                fixed: results.filter(r => r.status === 'FIXED').length,
                log_file: logFile
            },
            details: results.filter(r => r.status !== 'HEALTHY')
        };
    }

      // Helper simple para log
      private logDeepAudit(path: string, audit: any, applyFix: boolean) {
        const timestamp = new Date().toISOString();
        const content = `
          [${timestamp}] TRACKING: ${audit.tracking} | RESULT: ${audit.status}
          ----------------------------------------------------------------
          [ANÁLISIS]:
          ${audit.analysis.join('\n      ')}
          
          [INGRESOS]: Detectados: ${audit.detected_incomes} | Recuperados: ${audit.recovered_incomes}
          
          [ACCIÓN]: ${applyFix ? 'CAMBIOS APLICADOS' : 'SOLO REPORTE'}
          ----------------------------------------------------------------\n`;
        fsSync.appendFileSync(path, content);
      }

      // Método genérico que funciona para ambos tipos
      private mapEntityToReturnValidation(
        entity: Shipment | ChargeShipment,
        isCharge: boolean
      ): ReturnValidationDto {
        // Obtener el último status del historial
        const lastStatusHistory = entity.statusHistory && entity.statusHistory.length > 0
          ? [...entity.statusHistory].sort((a, b) => 
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            )[0]
          : null;

        return {
          id: entity.id,
          trackingNumber: entity.trackingNumber,
          status: entity.status,
          recipientAddress: entity.recipientAddress || '',
          recipientName: entity.recipientName || '',
          recipientPhone: entity.recipientPhone || '',
          recipientZip: entity.recipientZip || '',
          subsidiaryId: entity.subsidiary?.id || '',
          subsidiaryName: entity.subsidiary?.name || '',
          hasIncome: entity.payment ? true : false,
          isCharge: isCharge,
          lastStatus: lastStatusHistory ? {
            type: null,
            exceptionCode: lastStatusHistory.exceptionCode || null,
            notes: lastStatusHistory.notes || null
          } : null
        };
      }

      async trackFedexDirect(trackingNumbers: string[]) {
        // Ejecutamos todas las consultas en paralelo
        const results = await Promise.all(
          trackingNumbers.map(async (tn) => {
            try {
              const fedexInfo = await this.fedexService.trackPackage(tn);
              const trackDetail = fedexInfo?.output?.completeTrackResults?.[0]?.trackResults?.[0];
              
              if (!trackDetail) return { trackingNumber: tn, isError: true, description: 'No encontrado' };

              const latestStatus = trackDetail.latestStatusDetail;
              const scanEvents = trackDetail.scanEvents || [];
              const lastEvent = scanEventsFilter(scanEvents) as any;
              
              const ancillaryReason = latestStatus?.ancillaryDetails?.[0]?.reason || '';
              const exceptionCode = ancillaryReason !== '' ? ancillaryReason : (lastEvent?.exceptionCode || '');
              const derivedStatusCode = latestStatus?.derivedCode || latestStatus?.code || '';

              return {
                trackingNumber: tn,
                status: mapFedexStatusToLocalStatus(derivedStatusCode, exceptionCode),
                description: latestStatus?.description || 'Sin info',
                location: latestStatus?.statusByLocale || 'MÉXICO',
                deliveredTo: trackDetail.deliveryDetails?.receivedByName || null,
                isError: false
              };
            } catch (err) {
              return { trackingNumber: tn, isError: true, description: 'Error de conexión' };
            }
          })
        );
        return results;
      }

      async findNonDeliveredShipments(
        subsidiaryId: string, 
        date: Date
      ): Promise<ReturnValidationDto[]> {
        const formattedDate = dayjs(date).format('YYYY-MM-DD');
        const targetStatuses = [
          ShipmentStatusType.NO_ENTREGADO,
          ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
          ShipmentStatusType.RECHAZADO,
          ShipmentStatusType.DIRECCION_INCORRECTA,
          ShipmentStatusType.CAMBIO_FECHA_SOLICITADO,
        ];

        const buildQuery = (repo: any) => {
          return repo.createQueryBuilder('entity')
            .leftJoinAndSelect('entity.subsidiary', 'subsidiary')
            .leftJoinAndSelect('entity.statusHistory', 'statusHistory') // Esta es la relación en tu entidad
            .leftJoinAndSelect('entity.payment', 'payment')
            .where('subsidiary.id = :subsidiaryId', { subsidiaryId })
            .andWhere('entity.status IN (:...statuses)', { statuses: targetStatuses })
            .andWhere((qb) => {
              const subQuery = qb.subQuery()
                .select('1')
                .from('shipment_status', 'sh') // <-- NOMBRE CORRECTO SEGÚN TU LOG
                .where('sh.shipmentId = entity.id OR sh.chargeShipmentId = entity.id')
                .andWhere('sh.status IN (:...statuses)', { statuses: targetStatuses })
                .andWhere('DATE(sh.createdAt) = :date', { date: formattedDate })
                .getQuery();
              return `EXISTS ${subQuery}`;
            })
            .orderBy('entity.createdAt', 'DESC') // Usamos createdAt ya que updatedAt no existe
            .getMany();
        };

        const [shipments, chargeShipments] = await Promise.all([
          buildQuery(this.shipmentRepository),
          buildQuery(this.chargeShipmentRepository)
        ]);

        return [
          ...shipments.map(s => this.mapEntityToReturnValidation(s, false)),
          ...chargeShipments.map(cs => this.mapEntityToReturnValidation(cs, true))
        ];
      }

}



