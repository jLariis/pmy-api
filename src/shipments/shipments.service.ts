import { BadRequestException, forwardRef, HttpStatus, Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Brackets, EntityManager, In, MoreThanOrEqual, Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ShipmentStatusType, TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';
import * as XLSX from 'xlsx';
import { FedexService } from './fedex.service';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { getPriority, parseDynamicFileF2, parseDynamicHighValue, parseDynamicSheet, parseDynamicSheetCharge, parseDynamicSheetDHL, pickSheetWithHeaders, parsePaymentCell } from 'src/utils/file-upload.utils';
import { scanEventsFilter } from 'src/utils/scan-events-filter';
import { ParsedShipmentDto } from './dto/parsed-shipment.dto';
import { mapFedexStatusToLocalStatus } from 'src/utils/fedex.utils';
import { mapWhereParcelStatusToLocal } from 'src/utils/dhl.utils';
import type { NormalizedTrackingResult } from 'src/tracking/where-parcel-dhl.service';
import { addDays, differenceInCalendarDays, differenceInDays, endOfToday, format, isSameDay, parse, parseISO, startOfToday } from 'date-fns';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { Consolidated, Income, Payment, Subsidiary } from 'src/entities';
import { PaymentStatus } from 'src/common/enums/payment-status.enum';
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
import { formatInTimeZone, fromZonedTime, toDate, toZonedTime } from 'date-fns-tz';
import { MailService } from 'src/mail/mail.service';
import { SubsidiaryRules } from './dto/subsidiary-rules';
import { ForPickUp } from 'src/entities/for-pick-up.entity';
import { ForPickUpDto } from './dto/for-pick-up.dto';
import { IncomeValidationResult } from './dto/income-validation.dto';
import { TrackingProcessResultDto } from './dto/check-status-result.dto';
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
import { DhlService } from './dhl.service';
import { BusinessException } from 'src/common/business.exception';
import { LD_QUALIFYING_SQL_IN } from 'src/common/ld-codes';
import { TemplateService } from 'src/documents/template.service';
import { buildShipmentsNo67Data } from 'src/documents/data/shipments-no67.mapper';
import { buildReceived67Data } from 'src/documents/data/received-67.mapper';
import { buildPendingShipmentsData } from 'src/documents/data/pending-shipments.mapper';

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
    private readonly dhlService: DhlService,
    private readonly subsidiaryService: SubsidiariesService,
    @Inject(forwardRef(() => ConsolidatedService))
    private readonly consolidatedService: ConsolidatedService,
    private readonly mailService: MailService,
    private dataSource: DataSource,
    private readonly templateService: TemplateService,
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
  
  async findAllShipmentsAndChargesResp(subsidiaryId: string): Promise<ShipmentAndChargeDto[]> {
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

  async findAllShipmentsAndCharges(
    subsidiaryId: string,
    startDate?: string | Date, // Opcional para el futuro
    endDate?: string | Date    // Opcional para el futuro
  ): Promise<ShipmentAndChargeDto[]> {
    
    // --- INICIO HARDCODEO DEL MES ACTUAL (HERMOSILLO -> UTC) ---
    
    // 1. Aseguramos saber qué mes/año es en Hermosillo AHORA mismo.
    // Esto previene fallos si en UTC ya cambió el mes, pero en Hermosillo aún no.
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Hermosillo',
      year: 'numeric',
      month: 'numeric'
    });
    
    const parts = formatter.formatToParts(new Date());
    const year = parseInt(parts.find(p => p.type === 'year')!.value, 10);
    const month = parseInt(parts.find(p => p.type === 'month')!.value, 10) - 1; // 0-indexed para Date.UTC

    // 2. Convertimos el inicio del mes (00:00:00 Hermosillo) a UTC sumando 7 horas.
    const firstDayOfMonthUTC = new Date(Date.UTC(year, month, 1, 7, 0, 0, 0));
    
    // 3. Calculamos el primer instante del SIGUIENTE mes en Hermosillo (00:00:00 + 7hrs).
    const firstDayOfNextMonthUTC = new Date(Date.UTC(year, month + 1, 1, 7, 0, 0, 0));
    
    // 4. Restamos 1 milisegundo para tener el último instante exacto del mes actual.
    const lastDayOfMonthUTC = new Date(firstDayOfNextMonthUTC.getTime() - 1);
    
    // --- FIN HARDCODEO ---

    // Condición de búsqueda compartida (Enviando las fechas en UTC a la BD)
    const whereCondition = { 
      subsidiary: { id: subsidiaryId },
      commitDateTime: Between(firstDayOfMonthUTC, lastDayOfMonthUTC) 
    };
    
    const orderCondition = { commitDateTime: 'DESC' as const };

    // Ejecutar AMBAS consultas al mismo tiempo
    const [shipments, charges] = await Promise.all([
      this.shipmentRepository.find({
        select: {
          id: true, trackingNumber: true, recipientName: true, recipientAddress: true,
          recipientCity: true, recipientZip: true, commitDateTime: true, shipmentType: true,
          priority: true, status: true,
          statusHistory: { id: true, status: true, exceptionCode: true, timestamp: true, createdAt: true },
          payment: { id: true, amount: true, type: true, status: true },
          subsidiary: { id: true, name: true },
        },
        relations: ['statusHistory', 'payment', 'subsidiary'],
        where: whereCondition,
        order: orderCondition,
      }),
      this.chargeShipmentRepository.find({
        select: {
          id: true, trackingNumber: true, recipientName: true, recipientAddress: true,
          recipientCity: true, recipientZip: true, commitDateTime: true, shipmentType: true,
          priority: true, status: true,
          statusHistory: { id: true, status: true, exceptionCode: true, timestamp: true, createdAt: true },
          payment: { id: true, amount: true, type: true, status: true },
          subsidiary: { id: true, name: true },
        },
        relations: ['statusHistory', 'payment', 'charge', 'subsidiary'],
        where: whereCondition,
        order: orderCondition,
      })
    ]);

    // Mapear charges
    const chargeDtos: ShipmentAndChargeDto[] = charges.map(charge => ({
      ...charge,
      subsidiaryId: charge.subsidiary?.id,
      isChargePackage: true,
    }));

    // Combinar
    const allShipments: ShipmentAndChargeDto[] = [...shipments, ...chargeDtos];

    // Ordenar el resultado final
    allShipments.sort((a, b) => {
      return new Date(b.commitDateTime).getTime() - new Date(a.commitDateTime).getTime();
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

  async processFileF2(file: Express.Multer.File, subsidiaryId: string, consNumber: string, consDate?: Date, userId?: string) {
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
      const { sheet } = pickSheetWithHeaders(workbook); // multi-hoja: toma la hoja con datos
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
              createdById: userId ?? null,
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
            // commitDateTime (columna NOT NULL): del Excel o fallback hoy 18:00.
            let csCommitDateTime: Date | undefined;
            if (data.commitDate && data.commitTime) {
              const d = new Date(`${data.commitDate}T${data.commitTime}`);
              if (!isNaN(d.getTime())) csCommitDateTime = d;
            }
            if (!csCommitDateTime || isNaN(csCommitDateTime.getTime())) {
              csCommitDateTime = new Date();
              csCommitDateTime.setHours(18, 0, 0, 0);
            }

            const newCS = this.chargeShipmentRepository.create({
              trackingNumber: data.trackingNumber,
              recipientName: data.recipientName || 'N/A',
              recipientAddress: data.recipientAddress || 'N/A',
              recipientZip: data.recipientZip || 'N/A',
              recipientCity: data.recipientCity || 'N/A',
              recipientPhone: data.recipientPhone || 'N/A',
              commitDateTime: csCommitDateTime,
              shipmentType: ShipmentType.FEDEX,
              status: ShipmentStatusType.PENDIENTE,
              charge: savedCharge,
              subsidiary: chargeSubsidiary,
              createdById: userId ?? null,
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
          createdById: userId ?? null,
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
  async addChargeShipments(file: Express.Multer.File, subsidiaryId: string, consNumber: string, consDate?: Date, userId?: string) {
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
      const { sheet } = pickSheetWithHeaders(workbook); // multi-hoja: toma la hoja con datos

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
      
      const processPromises = chargeShipmentsToSave.map(async (shipment) => {
        try {
          console.log("🔄 Creating charge shipment for:", shipment.trackingNumber);

          // commitDateTime POR PAQUETE (antes la var estaba fuera del map y, peor,
          // nunca se asignaba a la entidad → la columna NOT NULL tronaba). Igual
          // que en shipments: del Excel (date+time) y, si no viene/ inválido,
          // fallback a hoy 18:00.
          let commitDateTime: Date | undefined;
          if (shipment.commitDate && shipment.commitTime) {
            const d = new Date(`${shipment.commitDate}T${shipment.commitTime}`);
            if (!isNaN(d.getTime())) commitDateTime = d;
          }
          if (!commitDateTime || isNaN(commitDateTime.getTime())) {
            commitDateTime = new Date();
            commitDateTime.setHours(18, 0, 0, 0);
          }

          const chargeShipment = this.chargeShipmentRepository.create({
            ...shipment,
            id: undefined,
            commitDateTime, // ← se asigna explícitamente
            shipmentType: ShipmentType.FEDEX,
            status: ShipmentStatusType.PENDIENTE,
            subsidiary: chargeSubsidiary, // antes no se ligaba la sucursal
            charge: savedCharge, // ✅ Asegurar que savedCharge tenga id
            createdById: userId ?? null,
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
            createdById: userId ?? null,
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
    const { sheet } = pickSheetWithHeaders(workbook, true); // multi-hoja (headers de cargos)

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
              const shipmentInfo: FedExTrackingResponseDto = await this.fedexService.trackPackage(trackingNumber);
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
              const shipmentInfo: FedExTrackingResponseDto = await this.fedexService.trackPackage(trackingNumber);
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

  async addConsMasterBySubsidiaryResp0705(
    file: Express.Multer.File,
    subsidiaryId: string,
    consNumber: string,
    consDate?: Date,
    isAereo?: boolean,
    userId?: string,
  ): Promise<any> {
      const startTime = Date.now();
      this.logger.log(`📂 Procesando archivo: ${file?.originalname} | Tipo: ${isAereo ? 'AÉREO' : 'ORDINARIO'}`);

      if (!file) throw new BadRequestException('No se ha recibido el archivo de Excel.');
      
      const predefinedSubsidiary = await this.subsidiaryService.findById(subsidiaryId);
      if (!predefinedSubsidiary) throw new BadRequestException(`La subsidiaria seleccionada no es válida.`);

      // Unicidad NORMALIZADA + por sucursal/carrier (evita falsos positivos entre
      // sucursales y atrapa variaciones de espacios/mayúsculas).
      const existingCons = await this.consolidatedService.findByConsNumberScoped(consNumber, subsidiaryId, ShipmentType.FEDEX);
      if (existingCons) {
        const fecha = existingCons.date ? new Date(existingCons.date).toLocaleDateString('es-MX') : 's/fecha';
        throw new BadRequestException(`El consolidado '${consNumber}' ya existe en esta sucursal (${existingCons.numberOfPackages ?? 0} guías, ${fecha}).`);
      }

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
              createdById: userId ?? null,
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
                          savedCons.id,
                          userId,
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

  async addConsMasterBySubsidiary(
    file: Express.Multer.File,
    subsidiaryId: string,
    consNumber: string,
    consDate?: Date,
    isAereo?: boolean,
    userId?: string,
  ): Promise<any> {
      const startTime = Date.now();
      this.logger.log(`📂 Procesando archivo: ${file?.originalname} | Tipo: ${isAereo ? 'AÉREO' : 'ORDINARIO'}`);

      if (!file) throw new BadRequestException('No se ha recibido el archivo de Excel.');
      
      const predefinedSubsidiary = await this.subsidiaryService.findById(subsidiaryId);
      if (!predefinedSubsidiary) throw new BadRequestException(`La subsidiaria seleccionada no es válida.`);

      // Unicidad NORMALIZADA + por sucursal/carrier (evita falsos positivos entre
      // sucursales y atrapa variaciones de espacios/mayúsculas).
      const existingCons = await this.consolidatedService.findByConsNumberScoped(consNumber, subsidiaryId, ShipmentType.FEDEX);
      if (existingCons) {
        const fecha = existingCons.date ? new Date(existingCons.date).toLocaleDateString('es-MX') : 's/fecha';
        throw new BadRequestException(`El consolidado '${consNumber}' ya existe en esta sucursal (${existingCons.numberOfPackages ?? 0} guías, ${fecha}).`);
      }

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
              createdById: userId ?? null,
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
                          savedCons.id,
                          userId,
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

                      // --- LOG DE DEPURACIÓN PARA LA TABLA SHIPMENT ---
                      const estatusShipments = [...new Set(this.shipmentBatch.map(s => s.status))];
                      this.logger.debug(`[DEBUG] Lote ${i + 1} - Estatus a guardar en Shipment: ${estatusShipments.join(', ')}`);

                      // A. Insertar Guías
                      let savedShipments;
                      try {
                          savedShipments = await transactionalEntityManager.save(Shipment, this.shipmentBatch, { chunk: 50 });
                      } catch (err) {
                          this.logger.error(`🚨 ERROR EXACTO EN TABLA 'Shipment' (Lote ${i + 1}): ${err.message}`);
                          throw new Error(`Fallo en tabla Shipment: ${err.message}`);
                      }

                      const paymentsToSave = [];
                      const historiesToSave = [];

                      savedShipments.forEach(s => {
                          const pay = paymentMap.get(s.trackingNumber);
                          if (pay) { pay.shipment = { id: s.id }; paymentsToSave.push(pay); }

                          const fedexHist = statusHistoryMap.get(s.trackingNumber);
                          if (fedexHist) {
                              fedexHist.forEach(h => { h.shipment = { id: s.id }; historiesToSave.push(h); });
                          }

                          // INYECTAR HISTORIA INICIAL
                          historiesToSave.push(transactionalEntityManager.create(ShipmentStatus, {
                              status: ShipmentStatusType.PENDIENTE,
                              notes: `Registro inicial. Cons: ${savedCons.consNumber}`,
                              timestamp: now,
                              shipment: { id: s.id },
                              exceptionCode: 'INIT'
                          }));
                      });

                      // B. Insertar Payments
                      if (paymentsToSave.length) {
                          try {
                              await transactionalEntityManager.save(Payment, paymentsToSave);
                          } catch (err) {
                              this.logger.error(`🚨 ERROR EXACTO EN TABLA 'Payment' (Lote ${i + 1}): ${err.message}`);
                              throw new Error(`Fallo en tabla Payment: ${err.message}`);
                          }
                      }

                      // C. Insertar ShipmentStatus
                      if (historiesToSave.length) {
                          this.logger.debug(`[DEBUG] Lote ${i + 1} - Intentando guardar ${historiesToSave.length} historiales...`);
                          
                          // 🕵️‍♂️ MODO CAZADOR: Guardamos uno por uno en lugar de en bloque
                          for (let idx = 0; idx < historiesToSave.length; idx++) {
                              const historyToSave = historiesToSave[idx];
                              
                              try {
                                  await transactionalEntityManager.save(ShipmentStatus, historyToSave);
                              } catch (err) {
                                  // 🚨 ¡AQUÍ ATRAPAMOS AL CULPABLE CON LAS MANOS EN LA MASA!
                                  this.logger.error(`========================================================`);
                                  this.logger.error(`🎯 ¡TE ENCONTRÉ! El estatus problemático es exactamente: -> "${historyToSave.status}" <-`);
                                  this.logger.error(`📦 Tracking Number: ${historyToSave.shipment?.trackingNumber || historyToSave.shipment?.id}`);
                                  this.logger.error(`📄 Objeto completo que se intentó guardar: ${JSON.stringify(historyToSave)}`);
                                  this.logger.error(`========================================================`);
                                  
                                  throw new Error(`Fallo exacto en tabla ShipmentStatus. Valor no permitido: '${historyToSave.status}'. Error DB: ${err.message}`);
                              }
                          }
                      }

                      for (const item of shipmentsToGenerateIncomes) {
                          await this.generateIncomes(item.shipment, item.timestamp, item.exceptionCode, transactionalEntityManager);
                      }
                      shipmentsToGenerateIncomes.length = 0;

                  } catch (err) {
                      this.logger.error(`❌ Error general en lote ${i + 1}: ${err.message}`);
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
    consolidatedId: string,
    userId?: string,
  ): Promise<void> {
    const trackingNumber = shipment.trackingNumber?.toString().trim();

    // 1. Validación de Tracking — fila sin guía se OMITE (no aborta todo el archivo).
    if (!trackingNumber) {
      result.failed++;
      (result.failedTrackings ||= []).push({ ...shipment, reason: `Fila ${shipmentIndex} (Lote ${batchNumber}): sin número de guía` });
      return;
    }

    // 2. Validación de Duplicados (archivo + BD a nivel SUCURSAL → no permite
    //    reimportar las mismas guías aunque cambien el consNumber).
    if (processedTrackingNumbers.has(trackingNumber) || await this.existShipmentForSubsidiary(trackingNumber, predefinedSubsidiary?.id)) {
      result.duplicated++;
      result.duplicatedTrackings.push(shipment);
      processedTrackingNumbers.add(trackingNumber);
      return;
    }
    processedTrackingNumbers.add(trackingNumber);

    // 3. Consulta FedEx 
    let fedexShipmentData: FedExTrackingResponseDto;
    try {
      fedexShipmentData = await this.fedexService.trackPackage(trackingNumber);
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
      newShipment.createdById = userId ?? null;
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

      // 8. LÓGICA DE PAGOS (robusta): acepta número o texto, separadores de
      //    miles/decimales y tipo COD/FTC/ROD. Antes el regex tomaba el primer
      //    dígito (montos mal/cero) y tronaba con celdas numéricas → cobros perdidos.
      const parsedPayment = parsePaymentCell(shipment.payment);
      if (parsedPayment) {
        newShipment.payment = {
          amount: parsedPayment.amount,
          type: parsedPayment.type,
          status: finalStatus === ShipmentStatusType.ENTREGADO ? PaymentStatus.PAID : PaymentStatus.PENDING,
          createdAt: new Date(),
        } as any;
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
    // 1. Obtener costo de la sucursal SEGÚN EL TIPO (FedEx vs DHL).
    // Antes siempre cobraba fedexCostPackage aunque la guía fuera DHL.
    const subsidiaryId = shipment.subsidiary?.id;
    const isDhl = String(shipment.shipmentType).toLowerCase() === ShipmentType.DHL.toLowerCase();
    const costOf = (s?: { fedexCostPackage?: number; dhlCostPackage?: number } | null) =>
      Number((isDhl ? s?.dhlCostPackage : s?.fedexCostPackage) || 0);

    let packageCost = costOf(shipment.subsidiary as any);

    if (packageCost <= 0 && subsidiaryId) {
      const subsidiary = await transactionalEntityManager.getRepository(Subsidiary).findOne({
        where: { id: subsidiaryId },
        select: ['fedexCostPackage', 'dhlCostPackage', 'name']
      });
      packageCost = costOf(subsidiary);
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
      createdById: (shipment as any).createdById ?? null, // hereda el autor del envío
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

  /**
   * Ventana (días) para considerar una guía "duplicada". Una guía importada hace
   * MÁS de estos días NO se considera duplicada: FedEx a veces regresa un paquete
   * y lo reenvía semanas después con la misma guía → debe poder re-subirse.
   */
  private readonly DEDUP_WINDOW_DAYS = 21;
  private dedupCutoff(): Date {
    return new Date(Date.now() - this.DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  }

  /** Estatus que, si son el ÚLTIMO estatus guardado de la guía, permiten volver a
   * subirla sin importar cuánto tiempo pasó: FedEx la regresó y no debe quedar
   * atrapada esperando los 21 días para poder reingresarla. */
  private static readonly RETURN_STATUSES_BYPASS_DEDUP = [
    ShipmentStatusType.DEVUELTO_A_FEDEX,
    ShipmentStatusType.RETORNO_ABANDONO_FEDEX,
  ];

  /** Existe la guía en la sucursal DENTRO de la ventana reciente (no las de semanas
   * atrás) Y no está devuelta — una guía devuelta puede volver a subirse en
   * cualquier momento. */
  private async existShipmentForSubsidiary(trackingNumber: string, subsidiaryId?: string): Promise<boolean> {
    if (!subsidiaryId) return false;
    try {
      // OJO: sin `select` parcial — combinado con `order by createdAt` sobre un
      // `where` con relación (subsidiary), TypeORM arma una subquery DISTINCT y
      // truena con "Unknown column ...createdAt" si createdAt no está en el
      // select. Costo de traer la fila completa es irrelevante (1 fila).
      const existing = await this.shipmentRepository.findOne({
        where: { trackingNumber, subsidiary: { id: subsidiaryId }, createdAt: MoreThanOrEqual(this.dedupCutoff()) },
        order: { createdAt: 'DESC' },
      });
      if (!existing) return false;
      return !ShipmentsService.RETURN_STATUSES_BYPASS_DEDUP.includes(existing.status as any);
    } catch (err) {
      this.logger.error(`existShipmentForSubsidiary ${trackingNumber}: ${err.message}`);
      return false;
    }
  }

  /** Guías del archivo que YA existen para la sucursal (con su consNumber/fecha) — para el preview. */
  async findExistingTrackings(trackingNumbers: string[], subsidiaryId: string): Promise<{ trackingNumber: string; consNumber: string | null; date: Date | null }[]> {
    const tns = [...new Set((trackingNumbers || []).map((t) => String(t ?? '').trim()).filter(Boolean))];
    if (!tns.length || !subsidiaryId) return [];
    const out: any[] = [];
    const CHUNK = 500;
    for (let i = 0; i < tns.length; i += CHUNK) {
      const slice = tns.slice(i, i + CHUNK);
      const rows = await this.shipmentRepository.createQueryBuilder('s')
        .leftJoin('s.subsidiary', 'sub')
        .leftJoin('consolidated', 'c', 'c.id = s.consolidatedId')
        .select('s.trackingNumber', 'trackingNumber')
        .addSelect('c.consNumber', 'consNumber')
        .addSelect('c.date', 'date')
        .where('sub.id = :subsidiaryId', { subsidiaryId })
        .andWhere('s.trackingNumber IN (:...slice)', { slice })
        .andWhere('s.createdAt >= :cutoff', { cutoff: this.dedupCutoff() }) // solo recientes (FedEx reenvía guías viejas)
        // Devueltas: se pueden re-subir en cualquier momento, no cuentan como "ya importadas".
        .andWhere('s.status NOT IN (:...returnStatuses)', { returnStatuses: ShipmentsService.RETURN_STATUSES_BYPASS_DEDUP })
        .getRawMany();
      out.push(...rows);
    }
    return out;
  }

  /** Pre-validación de un archivo FedEx SIN guardar (para avisar antes de subir). */
  async previewUpload(file: Express.Multer.File, subsidiaryId: string, consNumber: string, carrier: ShipmentType = ShipmentType.FEDEX) {
    if (!file) throw new BadRequestException('No se recibió el archivo.');
    const sub = await this.subsidiaryService.findById(subsidiaryId);
    if (!sub) throw new BadRequestException('La sucursal seleccionada no es válida.');

    let rows: any[] = [];
    let parseError: string | null = null;
    try {
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      rows = parseDynamicSheet(wb, { fileName: file.originalname }) || [];
    } catch (e: any) {
      parseError = e?.message ?? 'No se pudo leer el archivo.';
    }

    const all = rows.map((r) => String(r?.trackingNumber ?? '').trim());
    const withTn = all.filter(Boolean);
    const seen = new Set<string>();
    const dupInFile = new Set<string>();
    withTn.forEach((t) => { if (seen.has(t)) dupInFile.add(t); else seen.add(t); });
    const uniqueTns = [...seen];

    const existing = uniqueTns.length ? await this.findExistingTrackings(uniqueTns, subsidiaryId) : [];
    const existingSet = new Set(existing.map((e) => String(e.trackingNumber)));
    const consExists = await this.consolidatedService.findByConsNumberScoped(consNumber, subsidiaryId, carrier);

    return {
      fileName: file.originalname,
      parseError,
      totalRows: all.length,
      withTracking: withTn.length,
      emptyTracking: all.length - withTn.length,
      duplicatesInFile: dupInFile.size,
      alreadyImportedCount: existingSet.size,
      alreadyImported: existing.slice(0, 100),
      newCount: uniqueTns.filter((t) => !existingSet.has(t)).length,
      consNumberExists: consExists ? {
        id: consExists.id, consNumber: consExists.consNumber, type: consExists.type,
        date: consExists.date, numberOfPackages: consExists.numberOfPackages,
        subsidiary: consExists.subsidiary?.name ?? null,
      } : null,
    };
  }

  async findByTrackingNumber(trackingNumber: string) {
    const shipment = await this.shipmentRepository.findOne({
      where : {trackingNumber},
      relations: ['statusHistory'],
      order: { createdAt: 'DESC' }, // con duplicados, el más reciente
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
      relations: ['statusHistory'],
      order: { createdAt: 'DESC' }, // con duplicados, el más reciente
    });

    if (!shipment) {
      throw new Error('Shipment not found');
    }

    return shipment.statusHistory;
  }


  /********************  DHL ********************/
    async processDhlTxtFile(fileContent: string) {
      const shipmentsDto = this.dhlService.parseDhlText(fileContent);
      
      return shipmentsDto;

      /*let results = { success: 0, errors: 0 };

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

              // 1. Hacemos el tracking a DHL con el AWB del DTO
              this.logger.log(`Consultando API de DHL para AWB: ${dto.awb}`);
              const trackData = await this.dhlService.trackPackage(dto.awb);

              // 2. Imprimimos los datos que retorna DHL (útil para que veas la estructura en tu consola y sepas qué mapear)
              this.logger.debug(`Datos recibidos de DHL para ${dto.awb}: ${JSON.stringify(trackData, null, 2)}`);

              // 3. Pasamos tanto el dto original (del TXT) como los datos de rastreo (de la API)
              // Nota: Necesitarás modificar la firma de createShipmentFromDhlDto para que acepte este segundo parámetro.
              await this.createShipmentFromDhlDto(dto);
              
              results.success++;
              this.logger.log(`Envío ${dto.awb} guardado correctamente`);
          } catch (error) {
              results.errors++;
              this.logger.error(`Error procesando/rastreando el AWB ${dto.awb}: ${error.message}`);
          }
      }

      return results;*/
  }

    private calculatePriority(commitDate: Date): Priority {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalizamos 'hoy' a medianoche
      
      const targetDate = new Date(commitDate);
      targetDate.setHours(0, 0, 0, 0); // Normalizamos el 'commitDate' a medianoche

      // Calculamos la diferencia en milisegundos y la pasamos a días
      const diffTime = targetDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        // Vence hoy o ya está vencido
        return Priority.ALTA;
      } else if (diffDays > 0 && diffDays <= 3) {
        // Vence mañana o dentro de los próximos 3 días
        return Priority.MEDIA;
      } else {
        // Vence en más de 3 días
        return Priority.BAJA;
      }
    }

    async processDhlExcelFile(
      file: Express.Multer.File,
      subsidiaryId: string,
      consDate: Date | string | null,
      userId?: string,
      consNumber?: string
    ) {
      if (!file) {
        throw new BusinessException('generic', 'No se ha subido ningún archivo.', 'E', HttpStatus.BAD_REQUEST);
      }

      const { buffer, originalname } = file;
      const timeZone = 'America/Hermosillo'; // Tu zona horaria base

      console.log(`🚀 [DHL Import] Iniciando procesamiento del archivo: ${originalname}`);

      if (!originalname.match(/\.(csv|xlsx?)$/i)) {
        throw new BusinessException('generic', 'Tipo de archivo no soportado. Sube un .csv o .xlsx', 'E', HttpStatus.BAD_REQUEST);
      }

      // 1. Read and parse the Excel file
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsedShipments = parseDynamicSheetDHL(sheet);

      console.log(`📊 [DHL Import] Paquetes extraídos del Excel: ${parsedShipments ? parsedShipments.length : 0}`);

      if (!parsedShipments || parsedShipments.length === 0) {
        throw new BusinessException('generic', 'El archivo está vacío o no contiene paquetes válidos.', 'E', HttpStatus.BAD_REQUEST);
      }

      // =========================================================================
      // 🚀 VALIDACIÓN DE CABECERAS PARA EL FRONTEND
      // =========================================================================
      const columnMapping: Record<string, string> = {
        'trackingNumber': 'AWB Maestro',
        'dhlUniqueId': 'PID (Pieza)',
        'recipientName': 'Nombre',
        'recipientAddress': 'Dirección',
        'recipientCity': 'Ciudad',
        'recipientZip': 'CP',
        'recipientPhone': 'Teléfono',
        'commitDate': 'Vencimiento'
      };

      // Obtenemos las llaves técnicas (trackingNumber, recipientName, etc.)
      const requiredColumns = Object.keys(columnMapping); 
      const firstShipment = parsedShipments[0];
      
      // 2. Filtramos cuáles de esas llaves técnicas faltan o son undefined
      const missingTechnicalColumns = requiredColumns.filter(col => 
        !(col in firstShipment) || firstShipment[col] === undefined
      );
      
      // 3. Si hay columnas faltantes, las "traducimos" usando el diccionario
      if (missingTechnicalColumns.length > 0) {
        const missingFriendlyNames = missingTechnicalColumns.map(col => columnMapping[col]);

        throw new BusinessException(
          'generic',
          `El archivo no tiene el formato correcto. Faltan cabeceras obligatorias o están vacías: ${missingFriendlyNames.join(', ')}`,
          `El archivo no tiene el formato correcto. Faltan cabeceras obligatorias o están vacías: ${missingFriendlyNames.join(', ')}`, 
          HttpStatus.BAD_REQUEST,
          { missingColumns: missingFriendlyNames } // 👈 Ahora manda ["Guía", "Dirección"] en vez de ["trackingNumber", "recipientAddress"]
        );
      }
          // =========================================================================

      // 2. Fetch the subsidiary to get its name for the recipientCity
      const subsidiary = await this.subsidiaryRepository.findOneBy({ id: subsidiaryId });
      if (!subsidiary) {
        console.error(`❌ [DHL Import] Sucursal no encontrada con ID: ${subsidiaryId}`);
        throw new BusinessException('generic', 'Sucursal no encontrada', 'E', HttpStatus.BAD_REQUEST);
      }
      
      const subsidiaryCityName = subsidiary.name;
      console.log(`🏢 [DHL Import] Sucursal asignada: ${subsidiaryCityName}`);

      // 3. Generate consNumber con fecha en America/Hermosillo
      let finalConsNumber = consNumber;
      if (!finalConsNumber || finalConsNumber.trim() === '') {
        const now = new Date();
        const dateStringForCons = formatInTimeZone(now, timeZone, 'yyyyMMdd');
        finalConsNumber = `DHL-${dateStringForCons}`;
      }

      // 3.5 Manejo de fecha del consolidado (forzando horas a 0 en Hermosillo)
      let finalConsDate: Date;
      
      if (consDate) {
        const dateString = typeof consDate === 'string' ? consDate : consDate.toISOString();
        const [year, month, day] = dateString.split('T')[0].split('-');
        finalConsDate = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
      } else {
        const now = new Date();
        finalConsDate = toZonedTime(now, timeZone);
        finalConsDate.setHours(0, 0, 0, 0);
      }

      // 4. Create the Consolidated record
      const consolidated = this.consolidatedRepository.create({
        date: finalConsDate,
        type: ConsolidatedType.ORDINARIA,
        carrier: ShipmentType.DHL,
        numberOfPackages: parsedShipments.length,
        subsidiary: { id: subsidiaryId } as Subsidiary,
        isCompleted: false,
        createdById: userId,
        consNumber: finalConsNumber,
      });

      try {
        const savedConsolidated = await this.consolidatedRepository.save(consolidated);
        console.log(`📁 [DHL Import] Consolidado guardado correctamente con ID: ${savedConsolidated.id} y consNumber: ${finalConsNumber}`);

        const processedShipments: Shipment[] = [];

        // 5. Unconditionally create new shipments linked to the new consolidated
        for (const [index, data] of parsedShipments.entries()) {
          console.log("🚀 ~ ShipmentsService ~ processDhlExcelFile ~ data:", data)
          
          const { 
            trackingNumber, 
            dhlUniqueId, // Extraemos el PID de DHL
            recipientAddress, 
            commitDate, 
            recipientName, 
            recipientZip, 
            recipientPhone 
          } = data;

          // Centralizamos la lógica de fechas en el nuevo método
          const finalCommitDateTime = this.parseAndFormatCommitDate(commitDate);
          const calculatedPriority = this.calculatePriority(finalCommitDateTime);

          const fullAddress = `${recipientAddress || ''}`.trim();

          const newShipment = this.shipmentRepository.create({
            trackingNumber,
            dhlUniqueId,
            shipmentType: ShipmentType.DHL,
            recipientName: recipientName || '-',
            recipientAddress: fullAddress || '-',
            recipientCity: subsidiaryCityName, 
            recipientZip: recipientZip?.trim() || '-',
            recipientPhone: recipientPhone || '-',
            commitDateTime: finalCommitDateTime,
            status: ShipmentStatusType.PENDIENTE,
            priority: calculatedPriority, 
            consolidatedId: savedConsolidated.id,
            consNumber: finalConsNumber,
            subsidiary: { id: subsidiaryId } as Subsidiary,
            createdById: userId ?? null,
          });

          try {
            const saved = await this.shipmentRepository.save(newShipment);
            processedShipments.push(saved);
            console.log(`✅ [DHL Import] [${index + 1}/${parsedShipments.length}] Paquete guardado: ${trackingNumber}`);
          } catch (dbError: any) {
            console.error(`❌ [DHL Import] Error al guardar el paquete ${trackingNumber}:`, dbError.message);
          }
        }

        console.log(`🎉 [DHL Import] Proceso completado. Total de paquetes guardados: ${processedShipments.length}`);

        return {
          success: true,
          consolidated: savedConsolidated,
          totalProcessed: processedShipments.length,
        };

      } catch (consError: any) {
        console.error(`❌ [DHL Import] Error crítico al guardar el consolidado:`, consError.message);
        throw new BusinessException(
          'generic', 
          'Error al guardar el registro consolidado', 
          'E', 
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
    }

    private parseAndFormatCommitDate(commitDate: any): Date {
      const TZ = 'America/Hermosillo';
      const pad = (n: number) => String(n).padStart(2, '0');

      // Sin hora en el archivo => se asume 21:00 (9 pm) HORA HERMOSILLO.
      // Como la BD guarda UTC y Hermosillo es UTC-7, esto queda como el día
      // siguiente a las 04:00 UTC. (Antes se escribía 21:00 UTC, que en
      // Hermosillo se veía como las 14:00 / 2 pm: bug corregido.)
      const at9pmHermosillo = (year: number, month1: number, day: number): Date =>
        fromZonedTime(`${year}-${pad(month1)}-${pad(day)} 21:00:00`, TZ);

      // Fallback: hoy (según el calendario de Hermosillo) a las 21:00.
      const [fy, fm, fd] = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
        .split('-')
        .map(Number);
      const fallbackDate = at9pmHermosillo(fy, fm, fd);

      if (!commitDate) return fallbackDate;

      const str = String(commitDate).trim().toLowerCase();
      const currentYear = fy;

      // 1. Formato de Excel corto: "30-may", "01-jun", "30/may" (DD-MMM)
      const monthMap: Record<string, number> = {
        'ene': 0, 'jan': 0, 'feb': 1, 'mar': 2, 'abr': 3, 'apr': 3,
        'may': 4, 'jun': 5, 'jul': 6, 'ago': 7, 'aug': 7,
        'sep': 8, 'oct': 9, 'nov': 10, 'dic': 11, 'dec': 11
      };

      const ddMmmMatch = str.match(/^(\d{1,2})[-\/]([a-z]{3})/);
      if (ddMmmMatch && monthMap[ddMmmMatch[2]] !== undefined) {
        return at9pmHermosillo(currentYear, monthMap[ddMmmMatch[2]] + 1, parseInt(ddMmmMatch[1], 10));
      }

      // 2. Formato ISO: "YYYY-MM-DD" o "YYYY/MM/DD" (Ej: 2026-06-19)
      const yyyyMmDdMatch = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
      if (yyyyMmDdMatch) {
        return at9pmHermosillo(+yyyyMmDdMatch[1], +yyyyMmDdMatch[2], +yyyyMmDdMatch[3]);
      }

      // 3. Formato del export DHL: "MM/DD/YYYY" (US), p. ej. 06/19/2026 = 19 de junio.
      // (Antes se interpretaba como DD/MM/YYYY: leía el día como mes y, al
      // desbordarse, brincaba el año a 2027. Bug corregido.)
      const mmDdYyyyMatch = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
      if (mmDdYyyyMatch) {
        return at9pmHermosillo(+mmDdYyyyMatch[3], +mmDdYyyyMatch[1], +mmDdYyyyMatch[2]);
      }

      // 4. Último recurso (dejamos que JS intente leerlo).
      const parsedFallback = new Date(str);
      if (!isNaN(parsedFallback.getTime())) {
        let y = parsedFallback.getFullYear();
        if (y < 2020) y = currentYear; // Protegemos contra años erróneos (como 2001)
        return at9pmHermosillo(y, parsedFallback.getMonth() + 1, parsedFallback.getDate());
      }

      return fallbackDate;
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
          ShipmentStatusType.CAMBIO_FECHA_SOLICITADO,
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
          ShipmentStatusType.CAMBIO_FECHA_SOLICITADO,
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

    async checkStatusOnFedexChargeShipment(trackingNumbers: string[]) {
        const chargeShipmentsWithError = [];
        const updatedChargeShipments = [];

        this.logger.log(`📦 Iniciando verificación de estado para ${trackingNumbers.length} charge shipments`);

        for (const trackingNumber of trackingNumbers) {
          try {
            this.logger.log(`🔍 Procesando tracking number: ${trackingNumber}`);

            // 1. Obtener información de seguimiento de FedEx
            this.logger.log(`🔄 Consultando estado en FedEx para: ${trackingNumber}`);
            const shipmentInfo: FedExTrackingResponseDto = await this.fedexService.trackPackage(trackingNumber);

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

    /**
     * Historiales de estatus por número de guía (lote). Lo usa el detalle de
     * Ingresos para cargar el timeline BAJO DEMANDA (getIncome no une statusHistory
     * por performance). Devuelve, por guía, su historial ordenado cronológicamente
     * (de la copia más reciente).
     */
    async getStatusHistoriesByTrackingNumbers(
      trackingNumbers: string[],
    ): Promise<Record<string, { status: string; timestamp: Date; exceptionCode?: string; notes?: string }[]>> {
      const tns = [...new Set((trackingNumbers || []).map((t) => `${t}`.trim()).filter(Boolean))];
      const out: Record<string, any[]> = {};
      if (tns.length === 0) return out;

      const [shipments, charges] = await Promise.all([
        this.shipmentRepository.find({ where: { trackingNumber: In(tns) }, relations: ['statusHistory'], order: { createdAt: 'DESC' } }),
        this.chargeShipmentRepository.find({ where: { trackingNumber: In(tns) }, relations: ['statusHistory'], order: { createdAt: 'DESC' } }),
      ]);

      const put = (tn: string, hist: any[]) => {
        if (out[tn]) return; // ya tomamos la copia más reciente (orden DESC)
        out[tn] = (hist || [])
          .map((h) => ({ status: h.status, timestamp: h.timestamp, exceptionCode: h.exceptionCode, notes: h.notes }))
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      };
      for (const s of shipments) put(s.trackingNumber, s.statusHistory);
      for (const c of charges) put(c.trackingNumber, c.statusHistory);
      return out;
    }

    /**
     * Valida el estatus de "Local Delay" (LD) para una lista arbitraria de guías
     * (mezcla de shipments y charge-shipments, de cualquier sucursal). A diferencia
     * del reporte de inventario (`InventoriesService.getInventoryLDReport`, que usa
     * un rango de fecha compartido de una sucursal/inventario), aquí cada guía se
     * evalúa contra SU PROPIO `commitDateTime`: "vencida" = su día de compromiso ya
     * pasó por completo (si es hoy, no cuenta como vencida todavía).
     */
    async checkLdStatus(trackingNumbers: string[]): Promise<{
      trackingNumber: string;
      found: boolean;
      isCharge?: boolean;
      status?: string;
      commitDateTime?: string | null;
      recipientName?: string;
      shipmentType?: string;
      ldState: 'active' | 'ld' | 'delivered' | 'closed' | null;
    }[]> {
      const tns = [...new Set((trackingNumbers || []).map((t) => `${t}`.trim()).filter(Boolean))].slice(0, 300);
      if (tns.length === 0) return [];

      const [shipments, charges] = await Promise.all([
        this.shipmentRepository.find({
          where: { trackingNumber: In(tns) },
          order: { createdAt: 'DESC' },
          select: ['id', 'trackingNumber', 'status', 'commitDateTime', 'recipientName', 'shipmentType'],
        }),
        this.chargeShipmentRepository.find({
          where: { trackingNumber: In(tns) },
          order: { createdAt: 'DESC' },
          select: ['id', 'trackingNumber', 'status', 'commitDateTime', 'recipientName', 'shipmentType'],
        }),
      ]);

      type FoundRec = { id: string; isCharge: boolean; status: string; commitDateTime: Date | null; recipientName?: string; shipmentType?: string };
      const found = new Map<string, FoundRec>();
      for (const s of shipments) {
        if (found.has(s.trackingNumber)) continue; // ya tomamos la copia más reciente (orden DESC)
        found.set(s.trackingNumber, { id: s.id, isCharge: false, status: s.status, commitDateTime: s.commitDateTime, recipientName: s.recipientName, shipmentType: s.shipmentType });
      }
      for (const c of charges) {
        if (found.has(c.trackingNumber)) continue;
        found.set(c.trackingNumber, { id: c.id, isCharge: true, status: c.status, commitDateTime: c.commitDateTime, recipientName: c.recipientName, shipmentType: c.shipmentType });
      }

      const HER = -7 * 3600 * 1000; // America/Hermosillo, sin horario de verano.
      const herDay = (x: any) => new Date(new Date(x).getTime() + HER).toISOString().slice(0, 10);
      const today = herDay(new Date());

      const chunk = <T,>(arr: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
      // Mismo patrón que `aggBy()` en InventoriesService.getInventoryLDReport, pero sin
      // acotar por rango de fechas (cada guía compara contra SU commitDay, no uno compartido).
      const aggDays = async (ids: string[], fkCol: 'shipmentId' | 'chargeShipmentId') => {
        const moved = new Map<string, Set<string>>();
        const dex = new Map<string, Set<string>>();
        for (const part of chunk([...new Set(ids)], 800)) {
          if (part.length === 0) continue;
          const ph = part.map(() => '?').join(',');
          const mv: any[] = await this.dataSource.query(
            `SELECT ${fkCol} AS id, timestamp AS ts FROM shipment_status WHERE ${fkCol} IN (${ph})`,
            part,
          );
          for (const r of mv) {
            if (!r.id) continue;
            const key = String(r.id);
            if (!moved.has(key)) moved.set(key, new Set());
            moved.get(key)!.add(herDay(r.ts));
          }
          const dx: any[] = await this.dataSource.query(
            `SELECT ${fkCol} AS id, timestamp AS ts FROM shipment_status WHERE ${fkCol} IN (${ph}) AND exceptionCode IN (${LD_QUALIFYING_SQL_IN})`,
            part,
          );
          for (const r of dx) {
            if (!r.id) continue;
            const key = String(r.id);
            if (!dex.has(key)) dex.set(key, new Set());
            dex.get(key)!.add(herDay(r.ts));
          }
        }
        return { moved, dex };
      };

      const shipmentIds = [...found.values()].filter((v) => !v.isCharge).map((v) => v.id);
      const chargeIds = [...found.values()].filter((v) => v.isCharge).map((v) => v.id);
      const [shipAgg, chargeAgg] = await Promise.all([
        aggDays(shipmentIds, 'shipmentId'),
        aggDays(chargeIds, 'chargeShipmentId'),
      ]);

      const DELIVERED = new Set<string>([ShipmentStatusType.ENTREGADO, ShipmentStatusType.ENTREGADO_POR_FEDEX, ShipmentStatusType.ENTREGADO_EN_BODEGA]);
      const CLOSED = new Set<string>(TERMINAL_SHIPMENT_STATUSES);

      return tns.map((trackingNumber) => {
        const rec = found.get(trackingNumber);
        if (!rec) return { trackingNumber, found: false, ldState: null };

        const agg = rec.isCharge ? chargeAgg : shipAgg;
        const statusLower = String(rec.status ?? '').toLowerCase();
        const commitDay = rec.commitDateTime ? herDay(rec.commitDateTime) : null;
        const isDelivered = DELIVERED.has(statusLower);
        const isOtherClosed = !isDelivered && CLOSED.has(statusLower as any);
        const pastDue = !!commitDay && commitDay < today;
        const movedOnCommitDay = !!commitDay && !!agg.moved.get(rec.id)?.has(commitDay);
        const dexOnCommitDay = !!commitDay && !!agg.dex.get(rec.id)?.has(commitDay);
        const isLD = pastDue && !isDelivered && !dexOnCommitDay && !movedOnCommitDay;

        const ldState: 'active' | 'ld' | 'delivered' | 'closed' =
          isDelivered ? 'delivered' : isOtherClosed ? 'closed' : isLD ? 'ld' : 'active';

        return {
          trackingNumber,
          found: true,
          isCharge: rec.isCharge,
          status: rec.status,
          commitDateTime: rec.commitDateTime ? new Date(rec.commitDateTime).toISOString() : null,
          recipientName: rec.recipientName,
          shipmentType: rec.shipmentType,
          ldState,
        };
      });
    }

    /**
     * Persiste en los envíos DHL los estatus normalizados que devuelve 17TRACK.
     * Por cada resultado: localiza el envío (variantes JJD↔JD + dhlUniqueId, el
     * MÁS RECIENTE por createdAt), mapea el estatus 17TRACK → local y, si es nuevo,
     * agrega un ShipmentStatus al historial y actualiza `shipment.status`.
     * Si la sucursal tiene `generateDhlIncomeOnDelivery`, al detectar ENTREGADO
     * genera el ingreso (idempotente con el cierre de ruta).
     */
    async persistDhlTrackingResults(results: NormalizedTrackingResult[]) {
      const summary = {
        updated: [] as { trackingNumber: string; status: string; subsidiaryId?: string; rawStatus?: string; detail?: string }[],
        unchanged: [] as string[],
        notFound: [] as string[],
        skipped: [] as string[],
        errors: [] as { trackingNumber: string; reason: string }[],
      };

      for (const r of results || []) {
        const trackingNumber = r.trackingNumber;
        try {
          const mapped = mapWhereParcelStatusToLocal(r.currentStatus);
          if (!mapped) { summary.skipped.push(trackingNumber); continue; }

          // Variantes DHL: JJD↔JD + dhlUniqueId (mismo criterio que la búsqueda de detalle).
          const variants = [trackingNumber];
          if (trackingNumber.startsWith('JJD')) variants.push(trackingNumber.substring(1));
          else if (trackingNumber.startsWith('JD')) variants.push('J' + trackingNumber);
          const where = variants.flatMap((tn) => [{ trackingNumber: tn }, { dhlUniqueId: tn }]);

          const matches = await this.shipmentRepository.find({
            where,
            relations: ['statusHistory', 'subsidiary'], // subsidiary: para costo + flag de ingreso
            order: { createdAt: 'DESC' },
          });
          if (matches.length === 0) { summary.notFound.push(trackingNumber); continue; }
          const shipment = matches[0]; // el más reciente (dedup de guías recicladas)

          const parsed = r.latestEvent?.time ? new Date(r.latestEvent.time) : new Date();
          const eventDate = isNaN(parsed.getTime()) ? new Date() : parsed;

          shipment.statusHistory = shipment.statusHistory || [];
          const latest = shipment.statusHistory.length
            ? shipment.statusHistory.reduce((a, c) => (new Date(c.timestamp) > new Date(a.timestamp) ? c : a))
            : null;
          const isNewer = !latest || eventDate > new Date(latest.timestamp);
          const isDuplicate = shipment.statusHistory.some(
            (s) => s.status === mapped && isSameDay(s.timestamp, eventDate),
          );
          if (isDuplicate && !isNewer) { summary.unchanged.push(trackingNumber); continue; }

          const ns = new ShipmentStatus();
          ns.status = mapped;
          ns.timestamp = eventDate;
          ns.notes = `WhereParcel: ${r.currentStatus}${r.subStatus ? ` / ${r.subStatus}` : ''}${
            r.latestEvent?.description ? ` - ${r.latestEvent.description}` : ''
          }`.slice(0, 250);
          ns.shipment = shipment;

          await this.shipmentRepository.manager.transaction(async (tem) => {
            await tem.save(ShipmentStatus, ns);
            await tem
              .createQueryBuilder()
              .update(Shipment)
              .set({ status: mapped })
              .where('id = :id', { id: shipment.id })
              .execute();

            // Ingreso DHL al detectar ENTREGA (si la sucursal lo activa). Solo
            // entregado: es el único billable claro que da 17TRACK (los DEX se
            // cobran en cierre de ruta, donde sí se conoce el código). generateIncomes
            // es idempotente (dedup guía+tipo+semana) y el cierre de ruta también
            // checa "¿ya existe ingreso?", así que NO se duplica.
            if (mapped === ShipmentStatusType.ENTREGADO && (shipment.subsidiary as any)?.generateDhlIncomeOnDelivery) {
              shipment.status = mapped; // generateIncomes lee shipment.status
              await this.generateIncomes(shipment, eventDate, undefined, tem);
            }
          });

          summary.updated.push({
            trackingNumber,
            status: mapped,
            subsidiaryId: (shipment.subsidiary as any)?.id,
            rawStatus: r.currentStatus,
            detail: r.latestEvent?.description || undefined,
          });
        } catch (err: any) {
          this.logger.error(`Error persistiendo estatus DHL ${trackingNumber}: ${err?.message}`);
          summary.errors.push({ trackingNumber, reason: err?.message });
        }
      }

      this.logger.log(
        `DHL WhereParcel persistencia → actualizados:${summary.updated.length} sin_cambio:${summary.unchanged.length} ` +
          `no_encontrados:${summary.notFound.length} omitidos:${summary.skipped.length} errores:${summary.errors.length}`,
      );
      return summary;
    }

    /* ===================== Reciclaje de quota 17TRACK (DHL) ===================== */

    /** Fecha de corte: solo guías recientes (evita reciclados viejos). */
    private dhlTrackingCutoff(): Date {
      const d = new Date();
      d.setMonth(d.getMonth() - 6);
      return d;
    }

    /**
     * Guías DHL a CONSULTAR en WhereParcel: recientes (cutoff) y NO terminales.
     * Se trackea por `dhlUniqueId` (es ÚNICO; el trackingNumber puede repetirse),
     * por eso se devuelve el `dhlUniqueId` en el campo `trackingNumber` (lo que se
     * envía a WhereParcel) y solo se incluyen guías que SÍ tienen dhlUniqueId.
     * `persistDhlTrackingResults` hace match por dhlUniqueId. Se prioriza lo más
     * nuevo y se acota con `limit` (presupuesto de llamadas del ciclo).
     */
    async getDhlToPoll(limit: number): Promise<{ id: string; trackingNumber: string }[]> {
      if (limit <= 0) return [];
      const terminal = TERMINAL_SHIPMENT_STATUSES.map((s) => String(s).toLowerCase());
      return this.shipmentRepository
        .createQueryBuilder('s')
        .select(['s.id AS id', 's.dhlUniqueId AS trackingNumber'])
        .where('LOWER(s.shipmentType) = :type', { type: ShipmentType.DHL.toLowerCase() })
        .andWhere('s.dhlUniqueId IS NOT NULL')
        .andWhere("TRIM(s.dhlUniqueId) != ''")
        .andWhere('s.createdAt > :cutoff', { cutoff: this.dhlTrackingCutoff() })
        .andWhere('LOWER(s.status) NOT IN (:...terminal)', { terminal })
        .orderBy('s.createdAt', 'DESC')
        .limit(limit)
        .getRawMany();
    }

    /** Guías DHL ACTIVAS en 17TRACK (registradas y no liberadas) — para hacer polling. */
    async getActiveRegisteredDhl(): Promise<{ id: string; trackingNumber: string; status: ShipmentStatusType }[]> {
      const rows = await this.shipmentRepository
        .createQueryBuilder('s')
        .select(['s.id AS id', 's.trackingNumber AS trackingNumber', 's.status AS status'])
        .where('LOWER(s.shipmentType) = :type', { type: ShipmentType.DHL.toLowerCase() })
        .andWhere('s.seventeenRegisteredAt IS NOT NULL')
        .andWhere('s.seventeenReleasedAt IS NULL')
        .getRawMany();
      return rows;
    }

    /** Cuenta los slots de quota ocupados (activos en 17TRACK). */
    async countActiveRegisteredDhl(): Promise<number> {
      return this.shipmentRepository
        .createQueryBuilder('s')
        .where('LOWER(s.shipmentType) = :type', { type: ShipmentType.DHL.toLowerCase() })
        .andWhere('s.seventeenRegisteredAt IS NOT NULL')
        .andWhere('s.seventeenReleasedAt IS NULL')
        .getCount();
    }

    /** Guías DHL NO terminales aún sin registrar en 17TRACK (candidatas a alta). */
    async getUnregisteredDhl(limit: number): Promise<{ id: string; trackingNumber: string }[]> {
      if (limit <= 0) return [];
      const terminal = TERMINAL_SHIPMENT_STATUSES.map((s) => String(s).toLowerCase());
      const rows = await this.shipmentRepository
        .createQueryBuilder('s')
        .select(['s.id AS id', 's.trackingNumber AS trackingNumber'])
        .where('LOWER(s.shipmentType) = :type', { type: ShipmentType.DHL.toLowerCase() })
        .andWhere('s.seventeenRegisteredAt IS NULL')
        .andWhere('s.createdAt > :cutoff', { cutoff: this.dhlTrackingCutoff() })
        .andWhere('LOWER(s.status) NOT IN (:...terminal)', { terminal })
        .orderBy('s.createdAt', 'DESC')
        .limit(limit)
        .getRawMany();
      return rows;
    }

    /**
     * Guías DHL pendientes de REGISTRAR a webhook de WhereParcel: recientes, NO
     * terminales, con `dhlUniqueId`, y aún sin registrar (`seventeenRegisteredAt`
     * se reusa como "registrada a webhook"). Devuelve {id, trackingNumber=dhlUniqueId}.
     */
    async getDhlToRegisterForWebhook(limit: number): Promise<{ id: string; trackingNumber: string }[]> {
      if (limit <= 0) return [];
      const terminal = TERMINAL_SHIPMENT_STATUSES.map((s) => String(s).toLowerCase());
      return this.shipmentRepository
        .createQueryBuilder('s')
        .select(['s.id AS id', 's.dhlUniqueId AS trackingNumber'])
        .where('LOWER(s.shipmentType) = :type', { type: ShipmentType.DHL.toLowerCase() })
        .andWhere('s.dhlUniqueId IS NOT NULL')
        .andWhere("TRIM(s.dhlUniqueId) != ''")
        .andWhere('s.seventeenRegisteredAt IS NULL')
        .andWhere('s.createdAt > :cutoff', { cutoff: this.dhlTrackingCutoff() })
        .andWhere('LOWER(s.status) NOT IN (:...terminal)', { terminal })
        .orderBy('s.createdAt', 'DESC')
        .limit(limit)
        .getRawMany();
    }

    /** Marca guías como registradas a webhook (por id). Reusa `seventeenRegisteredAt`. */
    async markDhlWebhookRegistered(ids: string[]): Promise<void> {
      if (!ids?.length) return;
      await this.shipmentRepository
        .createQueryBuilder()
        .update(Shipment)
        .set({ seventeenRegisteredAt: () => 'CURRENT_TIMESTAMP' })
        .where('id IN (:...ids)', { ids })
        .andWhere('seventeenRegisteredAt IS NULL')
        .execute();
    }

    /** Guías DHL activas en 17TRACK que YA llegaron a terminal → liberar su slot. */
    async getActiveRegisteredDhlTerminal(): Promise<{ id: string; trackingNumber: string }[]> {
      const terminal = TERMINAL_SHIPMENT_STATUSES.map((s) => String(s).toLowerCase());
      const rows = await this.shipmentRepository
        .createQueryBuilder('s')
        .select(['s.id AS id', 's.trackingNumber AS trackingNumber'])
        .where('LOWER(s.shipmentType) = :type', { type: ShipmentType.DHL.toLowerCase() })
        .andWhere('s.seventeenRegisteredAt IS NOT NULL')
        .andWhere('s.seventeenReleasedAt IS NULL')
        .andWhere('LOWER(s.status) IN (:...terminal)', { terminal })
        .getRawMany();
      return rows;
    }

    /** Marca como registradas (consumió quota) las guías indicadas. */
    async markDhlRegistered(trackingNumbers: string[]): Promise<void> {
      if (!trackingNumbers?.length) return;
      await this.shipmentRepository
        .createQueryBuilder()
        .update(Shipment)
        .set({ seventeenRegisteredAt: () => 'CURRENT_TIMESTAMP' })
        .where('trackingNumber IN (:...nums)', { nums: trackingNumbers })
        .andWhere('LOWER(shipmentType) = :type', { type: ShipmentType.DHL.toLowerCase() })
        .andWhere('seventeenRegisteredAt IS NULL')
        .execute();
    }

    /** Marca como liberadas (slot de quota devuelto) las guías indicadas. */
    async markDhlReleased(ids: string[]): Promise<void> {
      if (!ids?.length) return;
      await this.shipmentRepository
        .createQueryBuilder()
        .update(Shipment)
        .set({ seventeenReleasedAt: () => 'CURRENT_TIMESTAMP' })
        .where('id IN (:...ids)', { ids })
        .execute();
    }

    async getShipmentDetailsByTrackingNumber(trackingNumber: string): Promise<SearchShipmentDto | null> {
      
      // 1. Generar tracking alternativo para casos de DHL (JJD vs JD)
      let alternateTrackingNumber: string | undefined;
      if (trackingNumber.startsWith('JJD')) {
          alternateTrackingNumber = trackingNumber.substring(1); // Se convierte en "JD..."
      } else if (trackingNumber.startsWith('JD')) {
          alternateTrackingNumber = 'J' + trackingNumber; // Se convierte en "JJD..."
      }

      // 2. Arreglo con los trackings que vamos a buscar
      const trackingNumbersToSearch = [trackingNumber];
      if (alternateTrackingNumber) {
          trackingNumbersToSearch.push(alternateTrackingNumber);
      }

      // 3. Construir condiciones para la búsqueda de envíos normales (Incluimos dhlUniqueId por consistencia)
      const shipmentWhereConditions = trackingNumbersToSearch.flatMap(tn => [
          { trackingNumber: tn },
          { dhlUniqueId: tn }
      ]);

      // Buscar todos los shipments con esos trackings y ordenar por fecha más reciente
      const shipments = await this.shipmentRepository.find({
          where: shipmentWhereConditions,
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

      // Buscar también los chargeShipments usando el operador IN para múltiples trackings
      const chargeShipments = await this.chargeShipmentRepository
          .createQueryBuilder('chargeShipment')
          .leftJoinAndSelect('chargeShipment.payment', 'payment')
          .leftJoinAndSelect('chargeShipment.packageDispatch', 'packageDispatch')
          .leftJoinAndSelect('packageDispatch.drivers', 'drivers')
          .leftJoinAndSelect('chargeShipment.unloading', 'unloading')
          .leftJoinAndSelect('unloading.subsidiary', 'unloadingSubsidiary')
          .leftJoinAndSelect('chargeShipment.charge', 'charge')
          .leftJoinAndSelect('chargeShipment.subsidiary', 'subsidiary')
          .where('chargeShipment.trackingNumber IN (:...trackings)', { trackings: trackingNumbersToSearch })
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
          console.log(`❌ No se encontró el envío con trackingNumber (ni sus variantes): ${trackingNumber}`);
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
      // Nota: Devolvemos el tracking original que se encontró en la BD (targetShipment.trackingNumber)
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
          status:  targetShipment.status,//packageDispatch ? 'En ruta' : 'En bodega',
          shipmentType: targetShipment.shipmentType,
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

    /**
     * Reporte "Recibidas de FedEx (con 67)": guías cuyo evento 67 (llegada a
     * estación FedEx) cayó en el rango dado. Equivale al correo de FedEx (puedes
     * ordenar/filtrar por "días desde el 67" para ver el bucket atorado).
     * Deduplica por trackingNumber (copia más reciente para los datos de display),
     * pero detecta el 67 en CUALQUIER copia (toma la fecha 67 más reciente en rango).
     */
    async getReceivedWith67BySubsidiary(subsidiaryId: string, start?: string, end?: string) {
      const s = start ? new Date(start) : new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const e = end ? new Date(end) : new Date();
      const now = Date.now();

      /**
       * 2 pasos (acotado, rápido con los índices idx_ss_excode_ts + idx_shipment_trackingNumber):
       *  Q1 agg: guía + fecha 67 más reciente EN RANGO (cualquier copia).
       *  Q2 disp: datos de la copia MÁS NUECA por guía (groupwise-max), acotado a las guías de Q1.
       */
      const run = async (table: 'shipment' | 'charge_shipment', fk: 'shipmentId' | 'chargeShipmentId') => {
        // Arranca desde shipment_status para aprovechar idx_ss_excode_ts (exceptionCode, timestamp).
        const agg: any[] = await this.shipmentRepository.query(
          `SELECT t2.trackingNumber AS tn, MAX(ss.timestamp) AS fecha67
           FROM shipment_status ss
           JOIN \`${table}\` t2 ON t2.id = ss.\`${fk}\`
           WHERE ss.exceptionCode = '67' AND ss.timestamp BETWEEN ? AND ? AND t2.subsidiaryId = ?
           GROUP BY t2.trackingNumber`,
          [s, e, subsidiaryId],
        );
        if (agg.length === 0) return [];
        const tns: string[] = agg.map((a) => a.tn);
        const ph = tns.map(() => '?').join(',');
        const disp: any[] = await this.shipmentRepository.query(
          `SELECT t.trackingNumber AS tn, t.status, t.recipientName, t.recipientAddress, t.recipientCity, t.recipientZip
           FROM \`${table}\` t
           JOIN (
             SELECT trackingNumber, SUBSTRING_INDEX(MAX(CONCAT(createdAt, '|', id)), '|', -1) AS nid
             FROM \`${table}\` WHERE subsidiaryId = ? AND trackingNumber IN (${ph}) GROUP BY trackingNumber
           ) nc ON t.id = nc.nid`,
          [subsidiaryId, ...tns],
        );
        const dispMap = new Map(disp.map((d) => [d.tn, d]));
        return agg.map((a) => {
          const d = dispMap.get(a.tn) || {};
          const dias = a.fecha67 ? Math.floor((now - new Date(a.fecha67).getTime()) / 86400000) : null;
          return {
            trackingNumber: a.tn, fecha67: a.fecha67, diasDesde67: dias,
            status: d.status, recipientName: d.recipientName, recipientAddress: d.recipientAddress,
            recipientCity: d.recipientCity, recipientZip: d.recipientZip,
          };
        });
      };

      try {
        const [shipments, charges] = await Promise.all([
          run('shipment', 'shipmentId'),
          run('charge_shipment', 'chargeShipmentId'),
        ]);
        const details = [
          ...shipments.map((r: any) => ({ ...r, isCharge: false })),
          ...charges.map((r: any) => ({ ...r, isCharge: true })),
        ].sort((a, b) => new Date(b.fecha67).getTime() - new Date(a.fecha67).getTime());

        return {
          summary: {
            Total: details.length,
            Envíos: shipments.length,
            Cargas: charges.length,
            Desde: s.toISOString().slice(0, 10),
            Hasta: e.toISOString().slice(0, 10),
          },
          details,
        };
      } catch (err: any) {
        this.logger.error(`getReceivedWith67BySubsidiary: ${err.message}`);
        return { summary: { Total: 0 }, details: [] };
      }
    }

    /**
     * Genera el Excel del reporte "Recibidas de FedEx (con 67)" (B7). Unificación: detrás de flag,
     * el backend genera el Excel por el Motor de Plantillas (`received_67_excel`). Si el motor no
     * entrega buffer (o falla), se conserva el armado inline exceljs original
     * (`exportReceived67ExcelLegacy`). Flag OFF => comportamiento actual intacto.
     */
    async exportReceived67Excel(rows: any[]): Promise<Buffer> {
      if (process.env.DOC_ENGINE_RECEIVED_67 === 'true') {
        try {
          const buf = await this.renderReceived67Excel(rows);
          if (buf) return buf;
        } catch (e: any) {
          this.logger.warn(`Motor received_67_excel falló; uso armado legacy: ${e?.message}`);
        }
      }
      return this.exportReceived67ExcelLegacy(rows);
    }

    /** Arma los datos vía data-provider y renderiza por el Motor. `undefined` si el motor no entrega buffer. */
    async renderReceived67Excel(rows: any[]): Promise<Buffer | undefined> {
      const data = buildReceived67Data({ rows });
      const result = await this.templateService.render('received_67_excel', data);
      return result.buffer;
    }

    /** Excel del reporte "Recibidas de FedEx (con 67)" (armado inline exceljs, legacy — retrocompat con Flag OFF). */
    async exportReceived67ExcelLegacy(rows: any[]): Promise<Buffer> {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Recibidas con 67');
      ws.columns = [
        { header: 'Guía', key: 'trackingNumber', width: 22 },
        { header: 'Fecha 67', key: 'fecha67', width: 20 },
        { header: 'Días desde 67', key: 'diasDesde67', width: 14 },
        { header: 'Estatus', key: 'status', width: 22 },
        { header: 'Destinatario', key: 'recipientName', width: 26 },
        { header: 'Dirección', key: 'recipientAddress', width: 34 },
        { header: 'Ciudad', key: 'recipientCity', width: 18 },
        { header: 'CP', key: 'recipientZip', width: 10 },
        { header: 'Tipo', key: 'tipo', width: 10 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const r of rows) {
        ws.addRow({
          ...r,
          fecha67: r.fecha67 ? new Date(r.fecha67).toLocaleString('es-MX') : '',
          tipo: r.isCharge ? 'Carga' : 'Envío',
        });
      }
      const arrayBuffer = await wb.xlsx.writeBuffer();
      return Buffer.from(arrayBuffer as ArrayBuffer);
    }

    /*** Validate Status Code 67 by Subsidiary **************************/
    /**
     * Reporte de VISIBILIDAD 67 (regla FedEx: cada paquete debe tener ≥1 código 67
     * por día, desde que se recibe hasta que se entrega). Lista los paquetes ACTIVOS
     * (pendiente / en bodega) y calcula, por GUÍA (agregando todas sus copias), la
     * fecha del último 67 y los DÍAS SIN 67. Categoriza:
     *   - 'hoy'   → ya tiene un 67 hoy (días = 0). OK.
     *   - 'sin67' → tiene 67 pero no de hoy (días ≥ 1). Perdió visibilidad.
     *   - 'nunca' → jamás registró un 67.
     * `thresholdDays` (default 1) marca a partir de cuántos días sin 67 se considera
     * "crítico" para el conteo del resumen. Devuelve TODOS los activos (la tabla
     * filtra/ordena por categoría o días desde 67).
     */
    async validateCode67BySubsidiary(subsidiaryId: string, thresholdDays = 1) {
      const targetStatuses = [ShipmentStatusType.PENDIENTE, ShipmentStatusType.EN_BODEGA];

      const [shipments, chargeShipments] = await Promise.all([
        this.shipmentRepository.find({
          where: { subsidiary: { id: subsidiaryId }, status: In(targetStatuses) },
          relations: ['statusHistory'],
        }),
        this.chargeShipmentRepository.find({
          where: { subsidiary: { id: subsidiaryId }, status: In(targetStatuses) },
          relations: ['statusHistory'],
        }),
      ]);

      const tagged = [
        ...shipments.map((s) => ({ s, isCharge: false })),
        ...chargeShipments.map((s) => ({ s, isCharge: true })),
      ];

      // Agregamos por GUÍA: una guía puede tener varias copias; el 67 puede estar en
      // cualquiera. Tomamos el 67 MÁS RECIENTE entre todas las copias y la copia más
      // nueva (createdAt) como representante para estatus/destinatario.
      const byGuide = new Map<string, { rep: any; isCharge: boolean; max67: Date | null; codes: Set<string>; firstStatus: Date | null; lastStatus: Date | null; historyCount: number; minCreatedAt: Date }>();

      const maxDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);

      for (const { s, isCharge } of tagged) {
        const history = s.statusHistory || [];
        let max67: Date | null = null;
        let firstStatus: Date | null = null;
        let lastStatus: Date | null = null;
        const codes = new Set<string>();
        for (const h of history) {
          if (h.exceptionCode) codes.add(h.exceptionCode);
          const t = h.timestamp ? new Date(h.timestamp) : null;
          if (t) {
            firstStatus = !firstStatus || t < firstStatus ? t : firstStatus;
            lastStatus = !lastStatus || t > lastStatus ? t : lastStatus;
            if (h.exceptionCode === '67') max67 = maxDate(max67, t);
          }
        }

        const createdAt = new Date(s.createdAt);
        const existing = byGuide.get(s.trackingNumber);
        if (!existing) {
          byGuide.set(s.trackingNumber, { rep: s, isCharge, max67, codes, firstStatus, lastStatus, historyCount: history.length, minCreatedAt: createdAt });
        } else {
          const repNewer = createdAt > new Date(existing.rep.createdAt);
          existing.rep = repNewer ? s : existing.rep;
          existing.isCharge = existing.isCharge || isCharge;
          existing.max67 = maxDate(existing.max67, max67);
          existing.firstStatus = existing.firstStatus && firstStatus ? (firstStatus < existing.firstStatus ? firstStatus : existing.firstStatus) : (existing.firstStatus || firstStatus);
          existing.lastStatus = maxDate(existing.lastStatus, lastStatus);
          existing.historyCount += history.length;
          if (createdAt < existing.minCreatedAt) existing.minCreatedAt = createdAt; // alta = la copia más antigua
          for (const c of codes) existing.codes.add(c);
        }
      }

      const now = new Date();
      const details = Array.from(byGuide.values()).map(({ rep, isCharge, max67, codes, firstStatus, lastStatus, historyCount, minCreatedAt }) => {
        const daysSinceLast67 = max67 ? differenceInCalendarDays(now, max67) : null;
        const category = max67 == null ? 'nunca' : daysSinceLast67 === 0 ? 'hoy' : 'sin67';
        return {
          trackingNumber: rep.trackingNumber,
          status: rep.status,
          currentStatus: rep.status, // alias para el Excel legacy
          recipientName: rep.recipientName,
          recipientAddress: rep.recipientAddress,
          recipientCity: rep.recipientCity,
          recipientZip: rep.recipientZip,
          shipmentType: rep.shipmentType,
          fedexUniqueId: rep.fedexUniqueId,
          isCharge,
          createdAt: minCreatedAt.toISOString(), // alta en el sistema (copia más antigua)
          last67Date: max67 ? max67.toISOString() : null,
          daysSinceLast67, // number | null (null = nunca)
          has67Today: category === 'hoy',
          category, // 'hoy' | 'sin67' | 'nunca'
          // Campos para el Excel legacy / diagnóstico:
          statusHistoryCount: historyCount,
          exceptionCodes: Array.from(codes),
          firstStatusDate: firstStatus ? firstStatus.toISOString() : null,
          lastStatusDate: lastStatus ? lastStatus.toISOString() : null,
          comment: category === 'nunca' ? 'Nunca registró 67' : category === 'sin67' ? `Sin 67 hace ${daysSinceLast67} día(s)` : 'Tiene 67 hoy',
        };
      });

      // Orden por defecto: por fecha de alta en el sistema, del MÁS VIEJO al más nuevo.
      // (En la tabla se puede reordenar por cualquier columna desde el encabezado.)
      details.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const con67Hoy = details.filter((d) => d.category === 'hoy').length;
      const nunca = details.filter((d) => d.category === 'nunca').length;
      const criticos = details.filter((d) => d.category === 'nunca' || (d.daysSinceLast67 ?? 0) >= thresholdDays).length;

      return {
        summary: {
          totalActivos: details.length,
          con67Hoy,
          sin67: details.length - con67Hoy, // todo lo que no tiene 67 de hoy
          nunca,
          criticos, // sin 67 >= thresholdDays (incluye 'nunca')
          thresholdDays,
        },
        details,
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

    /**
     * Genera el Excel de "Shipments sin código 67" (B6). Unificación: detrás de flag, el backend
     * genera el Excel por el Motor de Plantillas (`shipments_no67_excel`). Si el motor no entrega
     * buffer (o falla), se conserva el armado inline exceljs original
     * (`exportNo67ShipmentsLegacy`). Flag OFF => comportamiento actual intacto.
     */
    async exportNo67Shipments(shipments: any[], res: any) {
      if (process.env.DOC_ENGINE_SHIPMENTS_NO67 === 'true') {
        try {
          const buf = await this.renderShipmentsNo67Excel(shipments);
          if (buf) {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="shipments_sin_codigo_67_${this.formatDateForFilename(new Date())}.xlsx"`);
            res.end(buf);
            return res;
          }
        } catch (e: any) {
          this.logger.warn(`Motor shipments_no67_excel falló; uso armado legacy: ${e?.message}`);
        }
      }
      return this.exportNo67ShipmentsLegacy(shipments, res);
    }

    /** Arma los datos vía data-provider y renderiza por el Motor. `undefined` si el motor no entrega buffer. */
    async renderShipmentsNo67Excel(shipments: any[]): Promise<Buffer | undefined> {
      const data = buildShipmentsNo67Data({ shipments });
      const result = await this.templateService.render('shipments_no67_excel', data);
      return result.buffer;
    }

    /**
     * Genera reporte Excel de "Shipments sin código 67" (armado inline exceljs, legacy —
     * retrocompat con Flag OFF).
     */
    async exportNo67ShipmentsLegacy(shipments: any[], res: any) {
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
    async addShipment(dto: ShipmentToSaveDto, userId?: string): Promise<any> {
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
        const savedShipment = await this.processShipmentDirect(dto, subsidiary, userId);

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
      predefinedSubsidiary: Subsidiary,
      userId?: string,
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
        createdById: userId ?? null,
        subsidiary: predefinedSubsidiary,
        subsidiaryId: predefinedSubsidiary.id,
      });

      // -----------------------
      // CONSULTAR FEDEX
      // -----------------------
      let fedexShipmentData: FedExTrackingResponseDto;

      try {
        this.logger.log(`📬 Consultando FedEx para ${trackingNumber}`);
        fedexShipmentData = await this.fedexService.trackPackage(trackingNumber);
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


    /********************************* NUEVO METODO PARA VALIDAR A FEDEX */
      async checkStatusOnFedexBySubsidiaryRulesTesting(
        trackingNumbers: string[],
        shouldPersist = false
      ): Promise<TrackingProcessResultDto> {
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
            const shipmentInfo = await this.fedexService.trackPackage(trackingNumber);
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

    /**
     * Genera el Excel del reporte "Pendientes" (B8). Unificación: detrás de flag, el backend
     * genera el Excel por el Motor de Plantillas (`pending_shipments_excel`). Si el motor no
     * entrega buffer (o falla), se conserva el armado inline exceljs original
     * (`generatePendingShipmentsExcelLegacy`). Flag OFF => comportamiento actual intacto.
     */
    async generatePendingShipmentsExcel(shipments: Shipment[]): Promise<Buffer> {
      if (process.env.DOC_ENGINE_PENDING_SHIPMENTS === 'true') {
        try {
          const buf = await this.renderPendingShipmentsExcel(shipments);
          if (buf) return buf;
        } catch (e: any) {
          this.logger.warn(`Motor pending_shipments_excel falló; uso armado legacy: ${e?.message}`);
        }
      }
      return this.generatePendingShipmentsExcelLegacy(shipments);
    }

    /** Arma los datos vía data-provider y renderiza por el Motor. `undefined` si el motor no entrega buffer. */
    async renderPendingShipmentsExcel(shipments: Shipment[]): Promise<Buffer | undefined> {
      const data = buildPendingShipmentsData({ shipments: shipments as any });
      const result = await this.templateService.render('pending_shipments_excel', data);
      return result.buffer;
    }

    /** Excel del reporte "Pendientes" (armado inline exceljs, legacy — retrocompat con Flag OFF). */
    async generatePendingShipmentsExcelLegacy(
      shipments: Shipment[]
    ): Promise<Buffer> {

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Pendientes');

      /* ===================== Columnas ===================== */

      worksheet.columns = [
        { header: 'Tracking', key: 'trackingNumber', width: 18 },
        { header: 'Tipo', key: 'tipo', width: 10 },
        { header: 'Carga', key: 'carga', width: 10 },
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

      const tipoXls = (t?: string) => {
        const v = String(t || '').toLowerCase();
        return v === 'fedex' ? 'FedEx' : v === 'dhl' ? 'DHL' : (t ? String(t).toUpperCase() : 'Otro');
      };

      shipments.forEach((s: any) => {
        worksheet.addRow({
          trackingNumber: s.trackingNumber,
          tipo: tipoXls(s.shipmentType),
          carga: s.isCharge ? 'Carga' : 'Normal',
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
    ): Promise<{ count: number, shipments: any[] }> {
      /*const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);*/

      // SUBCONSULTA: id de la fila MÁS RECIENTE por trackingNumber.
      // OJO: el id es UUID (aleatorio), así que MAX(id) NO es el más nuevo. Usamos
      // el truco groupwise-max sobre createdAt: MAX(CONCAT(createdAt,'|',id)) y luego
      // extraemos el id. createdAt en formato 'YYYY-MM-DD HH:MM:SS' ordena cronológicamente.
      const subQuery = this.shipmentRepository
        .createQueryBuilder('s2')
        .select("SUBSTRING_INDEX(MAX(CONCAT(s2.createdAt, '|', s2.id)), '|', -1)", 'max_id')
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

      // --- CARGAS (F2) pendientes: mismo criterio que los envíos, marcadas isCharge ---
      const cSubQuery = this.chargeShipmentRepository
        .createQueryBuilder('c2')
        .select("SUBSTRING_INDEX(MAX(CONCAT(c2.createdAt, '|', c2.id)), '|', -1)", 'max_id')
        .addSelect('c2.trackingNumber', 'tracking_number')
        .where('c2.subsidiaryId = :subsidiaryId', { subsidiaryId })
        .groupBy('c2.trackingNumber')
        .getQuery();

      const cDeliveredSubQuery = this.chargeShipmentRepository
        .createQueryBuilder('c3')
        .select('DISTINCT c3.trackingNumber', 'tracking_number')
        .where('c3.subsidiaryId = :subsidiaryId', { subsidiaryId })
        .andWhere('c3.status IN (:...deliveredStatuses)', { deliveredStatuses: ['ENTREGADO', 'ENTREGADA'] })
        .getQuery();

      const charges = await this.chargeShipmentRepository
        .createQueryBuilder('c')
        .innerJoin(`(${cSubQuery})`, 'latest', 'c.trackingNumber = latest.tracking_number AND c.id = latest.max_id')
        .where('c.subsidiaryId = :subsidiaryId', { subsidiaryId })
        .andWhere(`c.trackingNumber NOT IN (${cDeliveredSubQuery})`)
        .andWhere('c.status IN (:...pendingStatuses)', {
          pendingStatuses: ['EN_RUTA', 'PENDIENTE', 'DESCONOCIDO', 'EN_BODEGA']
        })
        .setParameters({
          subsidiaryId,
          deliveredStatuses: ['ENTREGADO', 'ENTREGADA'],
          pendingStatuses: ['EN_RUTA', 'PENDIENTE', 'DESCONOCIDO', 'EN_BODEGA']
        })
        .orderBy('c.recipientZip', 'ASC')
        .getMany();

      // Unificamos: envíos normales + cargas; cada fila marcada con isCharge (y su shipmentType ya viene en la entidad).
      const rows: any[] = [
        ...shipments.map((s) => ({ ...s, isCharge: false })),
        ...charges.map((c) => ({ ...c, isCharge: true })),
      ];

      console.log(`📊 Pendientes únicos: ${shipments.length} envíos + ${charges.length} cargas`);

      return {
        count: rows.length,
        shipments: rows,
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

    /**
     * Estatus ACTUAL en FedEx (mapeado a estatus local) para un conjunto de guías,
     * SIN persistir nada. Alimenta la columna "Estatus FedEx" del reporte de
     * Pendientes (botón "Consultar FedEx" en lote). Reusa el MISMO prefetch por
     * lotes y el MISMO mapeo (mapFedexStatusToLocalStatus) que la actualización real,
     * para que el estatus mostrado sea comparable con la actualización efectiva.
     */
    /**
     * Confirmación con FedEx de la VISIBILIDAD 67: por guía cuenta los días
     * calendario CON un escaneo 67 (exceptionCode '67' = "tercero va en camino")
     * vs la ventana [alta en sistema (MIN createdAt) → entrega (scan DL) u hoy],
     * y lista los días que FALTARON. `includeSundays` controla si los domingos
     * exigen 67 (configurable, no hardcodeado). Solo lectura (no persiste).
     * Hermosillo = UTC-7 fijo (Sonora no usa horario de verano).
     */
    async getFedex67Visibility(
      items: { trackingNumber: string; fedexUniqueId?: string }[],
      includeSundays = true,
    ): Promise<Record<string, {
      windowStart: string | null; windowEnd: string | null; delivered: boolean;
      daysWith67: number; daysWithout67: number; missingDates: string[]; last67: string | null;
      events: { date: string; description: string; exceptionCode?: string }[];
      lastMovement: { date: string; description: string } | null;
      commitDateTime: string | null;
      fedexStatus: string; fedexRaw?: string; derivedCode?: string; exceptionCode?: string;
    }>> {
      const tns = [...new Set((items || []).map((i) => i.trackingNumber).filter(Boolean))];
      const out: Record<string, any> = {};
      if (tns.length === 0) return out;

      const HER = -7 * 3600 * 1000;
      const herDay = (x: any) => new Date(new Date(x).getTime() + HER).toISOString().slice(0, 10);
      const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay(); // 0 = domingo
      const addDay = (d: string) => new Date(new Date(d + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
      const enumerate = (start: string, end: string) => {
        const days: string[] = [];
        let d = start, guard = 0;
        while (d <= end && guard++ < 800) {
          if (includeSundays || dow(d) !== 0) days.push(d);
          d = addDay(d);
        }
        return days;
      };

      // Inicio de ventana = MIN(createdAt) por guía (alta en el sistema), envíos + cargas.
      const startMap = new Map<string, string>();
      const collectStarts = async (repo: Repository<any>, alias: string) => {
        const rows = await repo
          .createQueryBuilder(alias)
          .select(`${alias}.trackingNumber`, 'tn')
          .addSelect(`MIN(${alias}.createdAt)`, 'minCreated')
          .where(`${alias}.trackingNumber IN (:...tns)`, { tns })
          .groupBy(`${alias}.trackingNumber`)
          .getRawMany();
        for (const r of rows) {
          const day = herDay(r.minCreated);
          const cur = startMap.get(r.tn);
          if (!cur || day < cur) startMap.set(r.tn, day); // el más antiguo entre envío/carga
        }
      };
      await collectStarts(this.shipmentRepository, 's');
      await collectStarts(this.chargeShipmentRepository, 'cs');

      const { map } = await this.prefetchFedexBatch(tns, (items || []) as any, '[Visibilidad67-FedEx]');
      const today = herDay(new Date());

      for (const tn of tns) {
        const results = map.get(tn) || [];
        if (results.length > 1) {
          results.sort((a: any, b: any) => {
            const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
            const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
            return seqB - seqA;
          });
        }
        const top = results[0];
        const events: any[] = top?.scanEvents || [];

        const days67 = new Set<string>(
          events.filter((e) => e.exceptionCode === '67' && e.date).map((e) => herDay(e.date)),
        );
        const dl = events.find((e) => e.eventType === 'DL' && e.date);
        const delivered = !!dl;

        // Inicio: createdAt; si falta, el primer 67; si tampoco, hoy.
        const windowStart = startMap.get(tn) || (days67.size ? [...days67].sort()[0] : today);
        let windowEnd = dl ? herDay(dl.date) : today;
        if (windowEnd < windowStart) windowEnd = windowStart; // guardas contra datos raros

        const windowDays = enumerate(windowStart, windowEnd);
        // Solo contamos 67 dentro de la ventana.
        const days67InWindow = [...days67].filter((d) => d >= windowStart && d <= windowEnd);
        const set67 = new Set(days67InWindow);
        const missingDates = windowDays.filter((d) => !set67.has(d));

        // Estatus actual en FedEx (mapeado a local) — habilita el botón "Actualizar"
        // por fila (mismo criterio que getFedexComparisonStatuses).
        const lsd = top?.latestStatusDetail;
        const newestEvt = [...events].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
        const derivedCode = lsd?.derivedCode || lsd?.code || newestEvt?.derivedStatusCode || '';
        const exceptionCode = lsd?.ancillaryDetails?.[0]?.reason || newestEvt?.exceptionCode || '';
        const fedexRaw = lsd?.description || lsd?.statusByLocale || newestEvt?.eventDescription || derivedCode || '';
        const fedexStatus = derivedCode || exceptionCode || newestEvt ? mapFedexStatusToLocalStatus(derivedCode, exceptionCode) : 'SIN_DATOS';

        // Movimientos (historial de escaneos de FedEx), del más reciente al más antiguo.
        const sortedEvents = [...events].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const movements = sortedEvents
          .filter((e) => e.date)
          .map((e) => ({
            date: e.date,
            description: e.eventDescription || e.derivedStatusCode || e.eventType || '',
            ...(e.exceptionCode ? { exceptionCode: e.exceptionCode } : {}),
          }));

        // Fecha de entrega/compromiso VIGENTE en FedEx (para reprogramar en DEX17).
        const commitDateTime = (() => {
          const fromDT = top?.dateAndTimes?.find(
            (dt: any) => ['ESTIMATED_DELIVERY', 'COMMIT', 'APPOINTMENT_DELIVERY'].includes(dt?.type),
          )?.dateTime;
          const raw = fromDT || top?.estimatedDeliveryTimeWindow?.window?.ends || top?.standardTransitTimeWindow?.window?.ends;
          if (!raw) return null;
          const d = new Date(raw);
          return isNaN(d.getTime()) ? null : d.toISOString();
        })();

        out[tn] = {
          windowStart,
          windowEnd,
          delivered,
          daysWith67: set67.size,
          daysWithout67: missingDates.length,
          missingDates,
          last67: days67InWindow.length ? days67InWindow.sort().slice(-1)[0] : null,
          events: movements,
          lastMovement: movements.length ? { date: movements[0].date, description: movements[0].description } : null,
          commitDateTime,
          fedexStatus,
          fedexRaw,
          derivedCode,
          exceptionCode,
        };
      }

      return out;
    }

    /**
     * Igual que `getFedex67Visibility` pero para el código de excepción '44' (lo
     * usan las sucursales con `monitorFedexCode44 = true`, en vez de 67 — ver
     * `MonitoringService.getMonitorConfig`). Copia deliberada, no una
     * generalización del método de 67, para no arriesgar ese reporte en producción.
     */
    async getFedex44Visibility(
      items: { trackingNumber: string; fedexUniqueId?: string }[],
      includeSundays = true,
    ): Promise<Record<string, {
      windowStart: string | null; windowEnd: string | null; delivered: boolean;
      daysWith44: number; daysWithout44: number; missingDates: string[]; last44: string | null;
      events: { date: string; description: string; exceptionCode?: string }[];
      lastMovement: { date: string; description: string } | null;
      commitDateTime: string | null;
      fedexStatus: string; fedexRaw?: string; derivedCode?: string; exceptionCode?: string;
    }>> {
      const tns = [...new Set((items || []).map((i) => i.trackingNumber).filter(Boolean))];
      const out: Record<string, any> = {};
      if (tns.length === 0) return out;

      const HER = -7 * 3600 * 1000;
      const herDay = (x: any) => new Date(new Date(x).getTime() + HER).toISOString().slice(0, 10);
      const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();
      const addDay = (d: string) => new Date(new Date(d + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
      const enumerate = (start: string, end: string) => {
        const days: string[] = [];
        let d = start, guard = 0;
        while (d <= end && guard++ < 800) {
          if (includeSundays || dow(d) !== 0) days.push(d);
          d = addDay(d);
        }
        return days;
      };

      const startMap = new Map<string, string>();
      const collectStarts = async (repo: Repository<any>, alias: string) => {
        const rows = await repo
          .createQueryBuilder(alias)
          .select(`${alias}.trackingNumber`, 'tn')
          .addSelect(`MIN(${alias}.createdAt)`, 'minCreated')
          .where(`${alias}.trackingNumber IN (:...tns)`, { tns })
          .groupBy(`${alias}.trackingNumber`)
          .getRawMany();
        for (const r of rows) {
          const day = herDay(r.minCreated);
          const cur = startMap.get(r.tn);
          if (!cur || day < cur) startMap.set(r.tn, day);
        }
      };
      await collectStarts(this.shipmentRepository, 's');
      await collectStarts(this.chargeShipmentRepository, 'cs');

      const { map } = await this.prefetchFedexBatch(tns, (items || []) as any, '[Visibilidad44-FedEx]');
      const today = herDay(new Date());

      for (const tn of tns) {
        const results = map.get(tn) || [];
        if (results.length > 1) {
          results.sort((a: any, b: any) => {
            const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
            const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
            return seqB - seqA;
          });
        }
        const top = results[0];
        const events: any[] = top?.scanEvents || [];

        const days44 = new Set<string>(
          events.filter((e) => e.exceptionCode === '44' && e.date).map((e) => herDay(e.date)),
        );
        const dl = events.find((e) => e.eventType === 'DL' && e.date);
        const delivered = !!dl;

        const windowStart = startMap.get(tn) || (days44.size ? [...days44].sort()[0] : today);
        let windowEnd = dl ? herDay(dl.date) : today;
        if (windowEnd < windowStart) windowEnd = windowStart;

        const windowDays = enumerate(windowStart, windowEnd);
        const days44InWindow = [...days44].filter((d) => d >= windowStart && d <= windowEnd);
        const set44 = new Set(days44InWindow);
        const missingDates = windowDays.filter((d) => !set44.has(d));

        const lsd = top?.latestStatusDetail;
        const newestEvt = [...events].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
        const derivedCode = lsd?.derivedCode || lsd?.code || newestEvt?.derivedStatusCode || '';
        const exceptionCode = lsd?.ancillaryDetails?.[0]?.reason || newestEvt?.exceptionCode || '';
        const fedexRaw = lsd?.description || lsd?.statusByLocale || newestEvt?.eventDescription || derivedCode || '';
        const fedexStatus = derivedCode || exceptionCode || newestEvt ? mapFedexStatusToLocalStatus(derivedCode, exceptionCode) : 'SIN_DATOS';

        const sortedEvents = [...events].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const movements = sortedEvents
          .filter((e) => e.date)
          .map((e) => ({
            date: e.date,
            description: e.eventDescription || e.derivedStatusCode || e.eventType || '',
            ...(e.exceptionCode ? { exceptionCode: e.exceptionCode } : {}),
          }));

        const commitDateTime = (() => {
          const fromDT = top?.dateAndTimes?.find(
            (dt: any) => ['ESTIMATED_DELIVERY', 'COMMIT', 'APPOINTMENT_DELIVERY'].includes(dt?.type),
          )?.dateTime;
          const raw = fromDT || top?.estimatedDeliveryTimeWindow?.window?.ends || top?.standardTransitTimeWindow?.window?.ends;
          if (!raw) return null;
          const d = new Date(raw);
          return isNaN(d.getTime()) ? null : d.toISOString();
        })();

        out[tn] = {
          windowStart,
          windowEnd,
          delivered,
          daysWith44: set44.size,
          daysWithout44: missingDates.length,
          missingDates,
          last44: days44InWindow.length ? days44InWindow.sort().slice(-1)[0] : null,
          events: movements,
          lastMovement: movements.length ? { date: movements[0].date, description: movements[0].description } : null,
          commitDateTime,
          fedexStatus,
          fedexRaw,
          derivedCode,
          exceptionCode,
        };
      }

      return out;
    }

    /**
     * Reprograma el `commitDateTime` de una o varias guías (envío o carga) con la
     * nueva fecha de entrega que envió FedEx. Se usa en DEX17 (cambio de fecha).
     * Actualiza la copia MÁS RECIENTE por guía (misma regla que el dedup).
     */
    async updateCommitDates(
      items: { trackingNumber: string; isCharge?: boolean; commitDateTime: string }[],
    ): Promise<{ updated: number; details: { trackingNumber: string; commitDateTime: string }[] }> {
      let updated = 0;
      const details: { trackingNumber: string; commitDateTime: string }[] = [];
      for (const it of items || []) {
        if (!it?.trackingNumber || !it?.commitDateTime) continue;
        const d = new Date(it.commitDateTime);
        if (isNaN(d.getTime())) continue;
        const repo: Repository<any> = it.isCharge ? this.chargeShipmentRepository : this.shipmentRepository;
        const found = await repo.find({
          where: { trackingNumber: it.trackingNumber },
          order: { createdAt: 'DESC' },
          take: 1,
        });
        if (found[0]) {
          found[0].commitDateTime = d;
          await repo.save(found[0]);
          updated++;
          details.push({ trackingNumber: it.trackingNumber, commitDateTime: d.toISOString() });
        }
      }
      return { updated, details };
    }

    /**
     * `scanCode`: código de escaneo local a verificar para `hasScanToday` — 67 por
     * default, o 44 si así está configurada la sucursal (`monitorFedexCode44`).
     * No confundir con el resto de la comparación (fedexStatus/derivedCode/etc.),
     * que no depende de la sucursal.
     */
    async getFedexComparisonStatuses(
      items: { trackingNumber: string; fedexUniqueId?: string }[],
      scanCode: '67' | '44' = '67',
    ): Promise<Record<string, { fedexStatus: string; fedexRaw?: string; derivedCode?: string; exceptionCode?: string; reason?: string; lastEventAt?: string; hasScanToday?: boolean }>> {
      const tns = [...new Set((items || []).map((i) => i.trackingNumber).filter(Boolean))];
      if (tns.length === 0) return {};

      const { map, networkErrors } = await this.prefetchFedexBatch(tns, (items || []) as any, '[Pendientes-Compare]');
      const out: Record<string, { fedexStatus: string; fedexRaw?: string; derivedCode?: string; exceptionCode?: string; reason?: string; lastEventAt?: string; hasScanToday?: boolean }> = {};

      // Hermosillo NO tiene horario de verano (UTC-7 fijo todo el año) — mismo
      // criterio que getFedex67Visibility/getFedex44Visibility.
      const HER_OFFSET_MS = -7 * 3600 * 1000;
      const herDay = (x: any) => new Date(new Date(x).getTime() + HER_OFFSET_MS).toISOString().slice(0, 10);
      const todayHmo = herDay(new Date());

      // Diagnóstico agregado: para entender de dónde viene el "sin datos".
      let conDatos = 0, sinResultado = 0, conErrorFedex = 0, vacio = 0;
      const erroresPorCodigo: Record<string, number> = {};

      for (const tn of tns) {
        const results = map.get(tn) || [];
        if (results.length === 0) {
          // La guía NO vino en la respuesta de FedEx (lote con error de red, o no reconocida).
          sinResultado++;
          out[tn] = { fedexStatus: 'SIN_DATOS', reason: 'sin_resultado' };
          continue;
        }

        // Misma jerarquía que processMasterFedexUpdate: la generación con secuencia mayor.
        if (results.length > 1) {
          results.sort((a: any, b: any) => {
            const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
            const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
            return seqB - seqA;
          });
        }
        const top = results[0];
        const fxError = top.error; // FedEx devuelve un error POR guía (no encontrada / sin info).
        const lsd = top.latestStatusDetail;
        const newestEvent = [...(top.scanEvents || [])].sort(
          (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        )[0];

        // IMPORTANTE: preferimos derivedCode sobre code (igual que processMasterFedexUpdate
        // al calcular headerStatus). FedEx a veces deja `code` VACÍO pero llena `derivedCode`
        // (p.ej. "OW" = On the Way con 0 scanEvents) → si leyéramos `code` saldría "sin datos".
        // Además derivedCode refleja el desenlace real (ej. code=DE pero derived=RF=Rechazado).
        const derivedCode = lsd?.derivedCode || lsd?.code || newestEvent?.derivedStatusCode || '';
        const exceptionCode = lsd?.ancillaryDetails?.[0]?.reason || newestEvent?.exceptionCode || '';
        const fedexRaw =
          lsd?.description || lsd?.statusByLocale || newestEvent?.eventDescription || derivedCode || '';

        // Si FedEx no devolvió NADA útil (ni códigos ni eventos), es "sin datos".
        // Casi siempre trae un error EXPLÍCITO por guía (no encontrada/sin info) → lo exponemos.
        if (!derivedCode && !exceptionCode && !newestEvent) {
          if (fxError?.code) {
            conErrorFedex++;
            erroresPorCodigo[fxError.code] = (erroresPorCodigo[fxError.code] || 0) + 1;
          } else {
            vacio++;
          }
          out[tn] = {
            fedexStatus: 'SIN_DATOS',
            reason: fxError?.code || 'vacio',
            fedexRaw: fxError?.message || fedexRaw || undefined,
            derivedCode: fxError?.code || undefined,
          };
          continue;
        }

        conDatos++;
        const mapped = mapFedexStatusToLocalStatus(derivedCode, exceptionCode);
        // Fecha del evento MÁS RECIENTE, directo de FedEx (fresco, no lo que tengamos
        // guardado en BD) — para reconstruir el recorrido real con precisión (monitoreo
        // de rutas: el timestamp en BD puede venir de un import por lote y no ser exacto).
        const lastEventAt = newestEvent?.date && !isNaN(new Date(newestEvent.date).getTime())
          ? new Date(newestEvent.date).toISOString()
          : undefined;
        // ¿Tuvo el código de escaneo local (67 o 44, según la sucursal) HOY
        // (Hermosillo)? — directo del historial de escaneos fresco de FedEx.
        const hasScanToday = (top.scanEvents || []).some(
          (e: any) => e.exceptionCode === scanCode && e.date && herDay(e.date) === todayHmo,
        );
        // derivedCode/exceptionCode se exponen SIEMPRE para diagnosticar (y mapear) los DESCONOCIDO.
        out[tn] = { fedexStatus: mapped, fedexRaw, derivedCode, exceptionCode, lastEventAt, hasScanToday };
      }

      // Resumen para diagnosticar el "sin datos": distingue no-encontrada (error FedEx)
      // de problemas de red/auth (networkErrors / sinResultado).
      this.logger.log(
        `📊 [Pendientes-Compare] guías=${tns.length} conDatos=${conDatos} sinResultado=${sinResultado} ` +
        `errorFedex=${conErrorFedex} vacío=${vacio} networkErrors=${networkErrors} ` +
        `erroresPorCódigo=${JSON.stringify(erroresPorCodigo)}`,
      );
      return out;
    }

    /**
     * Actualiza UNA guía (envío o carga) reutilizando EXACTAMENTE el negocio de
     * actualización con ingresos: processMasterFedexUpdate / processChargeFedexUpdate.
     * Carga TODAS las copias de la guía en la sucursal (esos métodos agrupan por
     * trackingNumber) y devuelve el estatus de la copia más reciente.
     */
    async updateOnePending(
      subsidiaryId: string,
      trackingNumber: string,
      isCharge: boolean,
    ): Promise<{ trackingNumber: string; isCharge: boolean; status: string | null }> {
      if (!subsidiaryId || !trackingNumber) {
        throw new BadRequestException('subsidiaryId y trackingNumber son obligatorios');
      }

      if (isCharge) {
        const charges = await this.chargeShipmentRepository.find({
          where: { trackingNumber, subsidiary: { id: subsidiaryId } },
        });
        if (charges.length === 0) return { trackingNumber, isCharge, status: null };
        await this.processChargeFedexUpdate(charges);
      } else {
        const shipments = await this.shipmentRepository.find({
          where: { trackingNumber, subsidiary: { id: subsidiaryId } },
        });
        if (shipments.length === 0) return { trackingNumber, isCharge, status: null };
        await this.processMasterFedexUpdate(shipments);
      }

      // Estatus resultante = copia más reciente por createdAt.
      const repo: any = isCharge ? this.chargeShipmentRepository : this.shipmentRepository;
      const latest = await repo
        .createQueryBuilder('x')
        .where('x.trackingNumber = :trackingNumber', { trackingNumber })
        .andWhere('x.subsidiaryId = :subsidiaryId', { subsidiaryId })
        .orderBy('x.createdAt', 'DESC')
        .getOne();

      return { trackingNumber, isCharge, status: latest?.status ?? null };
    }


    /************************************** */


    /************ (ACTIVO) NUEVO METODO PARA CHECK STATUS ON FEDEX 20-01-2026*/
    
      private SUBSIDIARY_CONFIG = {
        'abf2fc38-cb42-41b6-9554-4b71c11b8916': { // Cabo San Lucas
          trackExternalDelivery: true,
          forceFedexStatus: true
        }
      };

      /** Divide un arreglo en lotes de tamaño fijo (para procesar en oleadas). */
      private chunkArray<T>(arr: T[], size: number): T[][] {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      }

      /**
       * Persiste (dead-letter) las guías que NO se pudieron actualizar tras agotar
       * reintentos, para tener visibilidad real y poder hacer un re-run dirigido.
       */
      private async writeFedexDeadLetter(
        kind: string,
        failed: { trackingNumber: string; reason: string }[]
      ): Promise<void> {
        if (!failed.length) return;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputPath = path.join(process.cwd(), 'logs', `fedex-failed-${kind}-${timestamp}.json`);
        try {
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, JSON.stringify(failed, null, 2), 'utf-8');
          this.logger.warn(`🪦 Dead-letter [${kind}]: ${failed.length} guías sin actualizar → ${outputPath}`);
        } catch (err) {
          this.logger.error(`❌ No se pudo escribir dead-letter [${kind}]: ${err.message}`);
        }
      }

      /**
       * Prefetch de FedEx por LOTES de 30 (la Track API lo soporta) en vez de 1
       * request por guía. Devuelve un Map<tracking, trackResults> + el conteo de
       * errores de RED (para el circuit breaker). Compartido por los procesadores
       * Master (envíos) y Charge (F2) para no duplicar la lógica de consulta.
       */
      private async prefetchFedexBatch(
        trackingNumbers: string[],
        source: Array<{ trackingNumber: string; fedexUniqueId?: string; carrierCode?: string }>,
        ctx: string,
      ): Promise<{ map: Map<string, any[]>; networkErrors: number }> {
        const map = new Map<string, any[]>();
        let networkErrors = 0;

        // Índice tracking -> {uniqueId, carrierCode} para no hacer find() N veces.
        const meta = new Map<string, { fedexUniqueId?: string; carrierCode?: string }>();
        for (const s of source) {
          if (!s?.trackingNumber) continue;
          const prev = meta.get(s.trackingNumber) || {};
          meta.set(s.trackingNumber, {
            fedexUniqueId: prev.fedexUniqueId || (s as any).fedexUniqueId || undefined,
            carrierCode: prev.carrierCode || (s as any).carrierCode || undefined,
          });
        }

        const chunks = this.chunkArray(trackingNumbers, FedexService.MAX_TRACKINGS_PER_REQUEST);
        const fetchLimit = pLimit(4); // hasta 4 requests batch en paralelo (~120 guías en vuelo)

        await Promise.all(
          chunks.map((chunk) =>
            fetchLimit(async () => {
              const items = chunk.map((tn) => ({ trackingNumber: tn, ...(meta.get(tn) || {}) }));
              try {
                const res = await this.fedexService.trackBatch(items, ctx);
                for (const [tn, trs] of res) map.set(tn, trs);
              } catch (error) {
                if (FedexService.isConnectivityError(error)) networkErrors += chunk.length;
                this.logger.error(`[${ctx}] Error en lote de ${chunk.length} guías: ${error.message}`);
              }
            }),
          ),
        );

        return { map, networkErrors };
      }

      async processMasterFedexUpdate(shipmentsToUpdate: Shipment[]) {
        this.logger.log(`💎 Master Update (Titanium - Shield & Income Edition): Procesando ${shipmentsToUpdate.length} guías...`);

        // 1. Agrupación por Tracking (Eficiencia Máxima)
        const shipmentsByTracking = shipmentsToUpdate.reduce((acc, s) => {
            if (!acc[s.trackingNumber]) acc[s.trackingNumber] = [];
            acc[s.trackingNumber].push(s.id);
            return acc;
        }, {} as Record<string, string[]>);

        const uniqueTrackingNumbers = Object.keys(shipmentsByTracking);
        const limit = pLimit(6); // Paralelismo controlado (reducido para bajar 429 de FedEx)
        const BATCH_SIZE = 250;
        const batches = this.chunkArray(uniqueTrackingNumbers, BATCH_SIZE);

        // Telemetría: distinguimos OK / sin datos / fallidas (dead-letter).
        const failed: { trackingNumber: string; reason: string }[] = [];
        let okCount = 0;
        let noDataCount = 0;
        // Circuit breaker: si FedEx es inalcanzable (DNS/red) y no hay ningún éxito,
        // abortamos la corrida en vez de marcar miles de guías como "error".
        let networkErrors = 0;
        let aborted = false;
        // Diagnóstico: tiempo de prefetch (batch), reintentos individuales (label-only/
        // miss del prefetch) y tiempo total. Si `retries` ≈ total → el prefetch no pega.
        const runStart = Date.now();
        let prefetchMs = 0;
        let retries = 0;

        for (let b = 0; b < batches.length; b++) {
          this.logger.log(`📦 [Master] Lote ${b + 1}/${batches.length} (${batches[b].length} guías)...`);

          // --- PREFETCH por lotes de 30 (1 request c/u en vez de 1 por guía) ---
          const tPre = Date.now();
          const { map: prefetched, networkErrors: batchNetErrors } =
            await this.prefetchFedexBatch(batches[b], shipmentsToUpdate as any, '[Master]');
          prefetchMs += Date.now() - tPre;
          networkErrors += batchNetErrors;
          this.logger.log(`   ⏱️ [Master] Prefetch lote ${b + 1}: ${prefetched.size}/${batches[b].length} guías con datos en ${((Date.now() - tPre) / 1000).toFixed(1)}s`);
          if (!aborted && okCount === 0 && networkErrors >= 12) {
            aborted = true;
            this.logger.error(`🔌 [Master] FedEx inalcanzable (${networkErrors} errores de red, 0 éxitos). Abortando corrida; se reintentará la próxima hora.`);
          }

          const tasks = batches[b].map((tn) => limit(async () => {
            if (aborted) return; // circuito abierto: no seguir intentando

            // --- 1. CONSULTA FEDEX (desde el prefetch por lotes de 30) ---
            let allTrackResults = prefetched.get(tn) || [];

            // 🚨 Reintento global si es Label Only o está vacío
            const isLabelOnly = allTrackResults.some(r => 
                r.latestStatusDetail?.code === 'OC' && (r.scanEvents?.length || 0) <= 1
            );

            if (isLabelOnly || allTrackResults.length === 0) {
                retries++;
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

            if (allTrackResults.length === 0) { noDataCount++; return; }

            // =================================================================================
            // 🛡️ SELECTOR DE GENERACIÓN (Jerarquía de UniqueID)
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
                const prevStatus = mainShipment.status; // para loguear solo si hay transición real
                const subId = mainShipment.subsidiary?.id?.toLowerCase() || '';
                // Config por sucursal: se LEE de la entidad (columnas reales); fallback al
                // SUBSIDIARY_CONFIG hardcodeado solo si la sucursal no está cargada.
                const matchedKey = Object.keys(this.SUBSIDIARY_CONFIG).find(key => key.toLowerCase() === subId);
                const hc: any = matchedKey ? this.SUBSIDIARY_CONFIG[matchedKey] : undefined;
                const sub: any = mainShipment.subsidiary;
                const subConfig = {
                  trackExternalDelivery: sub?.trackFedexExternalDelivery ?? hc?.trackExternalDelivery ?? false,
                  forceFedexStatus: sub?.forceFedexStatusOverride ?? hc?.forceFedexStatus ?? false,
                };

                // 🛡️ HUELLA DIGITAL (Evita Duplicados en DB)
                const existingHistory = await queryRunner.manager.query(
                    `SELECT status, timestamp, exceptionCode FROM shipment_status WHERE shipmentId = ?`,
                    [mainShipment.id]
                );

                // ⏱️ TIME SHIELD: Movido hacia arriba para poder filtrar el OD Fantasma
                const OPERATIONAL_STATUSES = [ShipmentStatusType.PENDIENTE, ShipmentStatusType.EN_BODEGA, ShipmentStatusType.EN_RUTA];
                // FIX (jul-2026): lastOpTime = la ÚLTIMA operación interna (MÁS RECIENTE).
                // El SELECT no trae ORDER BY, así que .find() devolvía el evento operativo
                // MÁS VIEJO → el Time Shield fallaba y un 67 viejo de FedEx pisaba el en_ruta
                // de la salida a ruta (lo regresaba a en_bodega sin escribir historial).
                const lastOpTime = existingHistory.reduce(
                  (max: number, h: any) => OPERATIONAL_STATUSES.includes(h.status)
                    ? Math.max(max, new Date(h.timestamp).getTime()) : max,
                  0,
                );

                const processedSignatures = new Set(existingHistory.map((h: any) => {
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
                
                // =================================================================================
                // --- 4. PROCESAMIENTO DE HISTORIA E INGRESOS (TU LÓGICA ORIGINAL) ---
                // =================================================================================
                const existing08Count = await queryRunner.manager.count(ShipmentStatus, {
                    where: { shipment: { id: mainShipment.id }, exceptionCode: '08' }
                });

                let current08Count = existing08Count;
                const paidWeeks = new Set<string>();

                // 🛡️ Pre-validación: Verificamos si en algún punto FedEx tomó el control, PERO ignoramos eventos viejos
                const hasODInHistory = subConfig.trackExternalDelivery && (
                    scanEvents.some(e => e.eventType === 'OD' && new Date(e.date).getTime() > lastOpTime) || 
                    lsdHeader?.code === 'OD'
                );

                for (const event of newEvents) {
                    const eventDate = new Date(event.date);
                    const dCode = event.derivedStatusCode || '';
                    const eCode = (event.exceptionCode || '').trim();
                    
                    let eventStatus: any = mapFedexStatusToLocalStatus(dCode, eCode);

                    // 🛡️ BLINDAJE ANTI-COBROS FALSOS
                    if (hasODInHistory && (event.eventType === 'DL' || dCode === 'DL' || eCode === '005')) {
                        eventStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    } else if (eCode === '005') {
                        eventStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    }
                    
                    if (!Object.values(ShipmentStatusType).includes(eventStatus)) eventStatus = ShipmentStatusType.DESCONOCIDO;

                    if (event.eventType === 'OD' || dCode === 'OD') {
                        if (subConfig.trackExternalDelivery) {
                            eventStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                        } else {
                            // Si la sucursal NO lo requiere (Hermosillo), trátalo como un EN_RUTA normal
                            // Esto evita que devuelva DESCONOCIDO y rompa los pesos/lógica.
                            eventStatus = ShipmentStatusType.EN_RUTA; 
                        }
                    }

                    // GUARDAR HISTORIA
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

                    // --- GARANTÍA DE INGRESOS ---
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
                // 🛡️ SECCIÓN 5: LÓGICA BASADA EN TIEMPO (CHRONOLOGICAL CONSENSUS)
                // =================================================================================
                
                // 1. Encontrar el evento más reciente de FedEx (Cronología estricta)
                const sortedScanEvents = [...scanEvents].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                const newestEvent = sortedScanEvents.length > 0 ? sortedScanEvents[0] : null;

                let newestEventStatus: any = ShipmentStatusType.DESCONOCIDO;
                let newestEventTime = 0;

                if (newestEvent) {
                    newestEventStatus = mapFedexStatusToLocalStatus(newestEvent.derivedStatusCode || '', newestEvent.exceptionCode || '');
                    newestEventTime = new Date(newestEvent.date).getTime();
                }

                // 2. Extraer el estatus de la propiedad latestStatusDetail (Header)
                const headerStatus = mapFedexStatusToLocalStatus(lsdHeader?.derivedCode || lsdHeader?.code || '', lsdHeader?.ancillaryDetails?.[0]?.reason);
                const isHeaderTerminal = ['DL', 'DE', 'SE'].includes(lsdHeader?.code || ''); // Códigos terminales de FedEx

                // 3. Decidir el Estatus Propuesto por FedEx
                let fedexProposedStatus = newestEventStatus;

                // FedEx a veces actualiza el 'latestStatusDetail' antes de inyectar el evento en 'scanEvents'.
                // Si el header marca un evento terminal, o si no hay eventos de escaneo, confiamos en el header.
                if (isHeaderTerminal || newestEventTime === 0) {
                    fedexProposedStatus = headerStatus;
                }

                // 4. Prioridad de Entrega Absoluta (Garantía)
                if (lsdHeader?.code === 'DL' || lsdHeader?.derivedCode === 'DL' || scanEvents.some(e => e.derivedStatusCode === 'DL' || e.eventType === 'DL')) {
                    fedexProposedStatus = ShipmentStatusType.ENTREGADO;
                }

                // 5. Blindaje de Tiempo (Time Shield contra Estatus Internos)
                let finalStatus = mainShipment.status; // Partimos del estatus actual en nuestra DB

                // Solo tomamos el estatus de FedEx si su evento más reciente es POSTERIOR a nuestra última operación interna (lastOpTime)
                // Excepción: Si FedEx dictamina que ya se entregó, eso sobreescribe cualquier cosa interna.
                if (newestEventTime > lastOpTime || fedexProposedStatus === ShipmentStatusType.ENTREGADO) {
                    finalStatus = fedexProposedStatus;
                }

                // 6. Aplicación de OD (Terceros / Subsidiarias)
                if (subConfig.trackExternalDelivery) {
                    if (hasODInHistory && finalStatus !== ShipmentStatusType.ENTREGADO && finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
                        finalStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                    } else if (finalStatus === ShipmentStatusType.ENTREGADO && hasODInHistory) {
                        finalStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    }
                }

                // =================================================================================
                // 🛡️ SECCIÓN 6: CANDADOS DE INTEGRIDAD (PROTECCIÓN EXCLUSIVA DE TERMINALES)
                // =================================================================================
                let isLocked = false;
                const terminalStatuses = [
                    ShipmentStatusType.ENTREGADO, 
                    ShipmentStatusType.ENTREGADO_POR_FEDEX,
                    ShipmentStatusType.DEVUELTO_A_FEDEX,
                    ShipmentStatusType.RETORNO_ABANDONO_FEDEX
                ];

                // Si ya está entregado o devuelto en DB, NO permitimos que regrese a un estatus operativo
                if (terminalStatuses.includes(mainShipment.status) && !terminalStatuses.includes(finalStatus as any)) {
                    this.logger.warn(`[${tn}] 🔒 Escudo Terminal: Bloqueado retroceso de ${mainShipment.status} a ${finalStatus}`);
                    isLocked = true;
                }

                // Válvula de Escape de OD (Retomar control)
                if (!isLocked && mainShipment.status !== finalStatus) {
                    const isFedexTakingBack = [ShipmentStatusType.EN_RUTA, ShipmentStatusType.EN_BODEGA, ShipmentStatusType.PENDIENTE].includes(mainShipment.status) && finalStatus === ShipmentStatusType.ACARGO_DE_FEDEX;
                    if (isFedexTakingBack) {
                        this.logger.warn(`[${tn}] 🔄 Válvula de Escape: FedEx retomó control (OD) desde ${mainShipment.status}.`);
                    }
                }

                // =================================================================================
                // GUARDADO EN CASCADA
                // =================================================================================
                if (!isLocked) {
                    const newUniqueId = trackResult.trackingNumberInfo?.trackingNumberUniqueId;
                    const newCarrierCode = trackResult.trackingNumberInfo?.carrierCode;
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
                        // Persistimos el carrierCode que devuelve FedEx para que la
                        // próxima corrida consulte ya desambiguada (estatus exacto).
                        if (newCarrierCode && ship.carrierCode !== newCarrierCode) {
                            ship.carrierCode = newCarrierCode;
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

                // Log por paquete SOLO cuando cambia el estatus (la señal que importa).
                if (!isLocked && prevStatus !== finalStatus) {
                    this.logger.log(`📦 [${tn}] ${prevStatus} → ${finalStatus}`);
                }

                await queryRunner.commitTransaction();
                okCount++;

            } catch (error) {
                this.logger.error(`[${tn}] Error Transacción: ${error.message}`);
                failed.push({ trackingNumber: tn, reason: `TX: ${error.message}` });
                if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
            } finally {
                await queryRunner.release();
            }
          }));

          await Promise.all(tasks);
          if (aborted) break;
        }

        this.logger.log(`📈 [Master] OK: ${okCount} | Sin datos: ${noDataCount} | Fallidas: ${failed.length} de ${uniqueTrackingNumbers.length}`);
        this.logger.log(`   ⏱️ [Master] Total ${((Date.now() - runStart) / 1000).toFixed(1)}s · prefetch ${(prefetchMs / 1000).toFixed(1)}s · reintentos individuales: ${retries}/${uniqueTrackingNumbers.length}${retries > uniqueTrackingNumbers.length * 0.5 ? ' ⚠️ (prefetch no está pegando — revisar key)' : ''}`);
        // Si fue una caída de conectividad, NO escribimos dead-letter (no son fallos por guía).
        if (aborted) {
          this.logger.error(`🔌 [Master] Corrida abortada por conectividad con FedEx. No se generó dead-letter.`);
        } else {
          await this.writeFedexDeadLetter('master', failed);
        }
        return {
          total: uniqueTrackingNumbers.length,
          ok: okCount,
          noData: noDataCount,
          failed: failed.length,
          aborted,
          failedTrackings: failed.map(f => f.trackingNumber),
        };
      }

      async processChargeFedexUpdate(chargeShipmentsToUpdate: ChargeShipment[]) {
        this.logger.log(`💎 Charge Update (Titanium - Shield Edition): Procesando ${chargeShipmentsToUpdate.length} cargas...`);

        // 1. Agrupación por Tracking (Eficiencia Máxima)
        const shipmentsByTracking = chargeShipmentsToUpdate.reduce((acc, s) => {
            if (!acc[s.trackingNumber]) acc[s.trackingNumber] = [];
            acc[s.trackingNumber].push(s.id);
            return acc;
        }, {} as Record<string, string[]>);

        const uniqueTrackingNumbers = Object.keys(shipmentsByTracking);
        const limit = pLimit(6); // Paralelismo controlado (reducido para bajar 429 de FedEx)
        const BATCH_SIZE = 250;
        const batches = this.chunkArray(uniqueTrackingNumbers, BATCH_SIZE);

        // Telemetría: distinguimos OK / sin datos / fallidas (dead-letter).
        const failed: { trackingNumber: string; reason: string }[] = [];
        let okCount = 0;
        let noDataCount = 0;
        // Circuit breaker: aborta si FedEx es inalcanzable (DNS/red) y no hay éxitos.
        let networkErrors = 0;
        let aborted = false;
        const runStart = Date.now();
        let prefetchMs = 0;
        let retries = 0;

        for (let b = 0; b < batches.length; b++) {
          this.logger.log(`📦 [F2] Lote ${b + 1}/${batches.length} (${batches[b].length} guías)...`);

          // --- PREFETCH por lotes de 30 (1 request c/u en vez de 1 por guía) ---
          const tPre = Date.now();
          const { map: prefetched, networkErrors: batchNetErrors } =
            await this.prefetchFedexBatch(batches[b], chargeShipmentsToUpdate as any, '[F2]');
          prefetchMs += Date.now() - tPre;
          networkErrors += batchNetErrors;
          this.logger.log(`   ⏱️ [F2] Prefetch lote ${b + 1}: ${prefetched.size}/${batches[b].length} guías con datos en ${((Date.now() - tPre) / 1000).toFixed(1)}s`);
          if (!aborted && okCount === 0 && networkErrors >= 12) {
            aborted = true;
            this.logger.error(`🔌 [F2] FedEx inalcanzable (${networkErrors} errores de red, 0 éxitos). Abortando corrida; se reintentará la próxima hora.`);
          }

          const tasks = batches[b].map((tn) => limit(async () => {
            if (aborted) return; // circuito abierto: no seguir intentando

            // --- 1. CONSULTA FEDEX (desde el prefetch por lotes de 30) ---
            let allTrackResults = prefetched.get(tn) || [];

            // 🚨 Reintento global si es Label Only o está vacío
            const isLabelOnly = allTrackResults.some((r: any) => 
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
                    this.logger.warn(`[C2 - ${tn}] Falló reintento global: ${e.message}`);
                }
            }

            if (allTrackResults.length === 0) { noDataCount++; return; }

            // =================================================================================
            // 🛡️ SELECTOR DE GENERACIÓN (Jerarquía de UniqueID)
            // =================================================================================
            if (allTrackResults.length > 1) {
                allTrackResults.sort((a: any, b: any) => {
                    const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
                    const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
                    if (seqA !== seqB) return seqB - seqA;

                    const timeA = new Date(a.scanEvents?.[0]?.date || 0).getTime();
                    const timeB = new Date(b.scanEvents?.[0]?.date || 0).getTime();
                    return timeB - timeA;
                });

                const winner = allTrackResults[0];
                this.logger.log(`[C2 - ${tn}] 🚀 Selector de Generación: Elegido ID ${winner.trackingNumberInfo?.trackingNumberUniqueId}`);
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
                const prevStatus = mainCharge.status; // para loguear solo si hay transición real
                const subId = mainCharge.subsidiary?.id?.toLowerCase() || '';
                const configKeys = Object.keys(this.SUBSIDIARY_CONFIG);
                const matchedKey = configKeys.find(key => key.toLowerCase() === subId);
                
                // ⚙️ SE AGREGA CONDICIONAL "generateIncomes" BASADO EN LA SUCURSAL
                const subConfig = matchedKey 
                    ? this.SUBSIDIARY_CONFIG[matchedKey] 
                    : { trackExternalDelivery: false, generateIncomes: false };

                // 🛡️ HUELLA DIGITAL (Evita Duplicados en DB adaptado a ChargeShipment)
                const existingHistory = await queryRunner.manager.query(
                    `SELECT status, timestamp, exceptionCode FROM shipment_status WHERE chargeShipmentId = ?`,
                    [mainCharge.id]
                );

                // ⏱️ TIME SHIELD
                const OPERATIONAL_STATUSES = [ShipmentStatusType.PENDIENTE, ShipmentStatusType.EN_BODEGA, ShipmentStatusType.EN_RUTA];
                // FIX (jul-2026): lastOpTime = la ÚLTIMA operación interna (MÁS RECIENTE).
                // El SELECT no trae ORDER BY, así que .find() devolvía el evento operativo
                // MÁS VIEJO → el Time Shield fallaba y un 67 viejo de FedEx pisaba el en_ruta
                // de la salida a ruta (lo regresaba a en_bodega sin escribir historial).
                const lastOpTime = existingHistory.reduce(
                  (max: number, h: any) => OPERATIONAL_STATUSES.includes(h.status)
                    ? Math.max(max, new Date(h.timestamp).getTime()) : max,
                  0,
                );

                const processedSignatures = new Set(existingHistory.map((h: any) => {
                    const t = new Date(h.timestamp).getTime();
                    const c = (h.exceptionCode || '').trim(); 
                    return `${t}_${c}`;
                }));

                const newEvents = scanEvents.filter((e: any) => {
                    const t = new Date(e.date).getTime();
                    const c = (e.exceptionCode || '').trim();
                    const signature = `${t}_${c}`;
                    return !processedSignatures.has(signature);
                });

                // Orden cronológico para procesar historia (y posibles ingresos)
                newEvents.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
                
                // =================================================================================
                // --- 4. PROCESAMIENTO DE HISTORIA (E INGRESOS CONDICIONALES) ---
                // =================================================================================
                let current08Count = 0;
                const paidWeeks = new Set<string>();

                // Solo consultamos el conteo de 08s si la sucursal genera ingresos
                if (subConfig.generateIncomes) {
                    const existing08Count = await queryRunner.manager.count(ShipmentStatus, {
                        where: { chargeShipment: { id: mainCharge.id }, exceptionCode: '08' }
                    });
                    current08Count = existing08Count;
                }

                const hasODInHistory = subConfig.trackExternalDelivery && (
                    scanEvents.some((e: any) => e.eventType === 'OD' && new Date(e.date).getTime() > lastOpTime) || 
                    lsdHeader?.code === 'OD'
                );

                for (const event of newEvents) {
                    const eventDate = new Date(event.date);
                    const dCode = event.derivedStatusCode || '';
                    const eCode = (event.exceptionCode || '').trim();
                    
                    let eventStatus: any = mapFedexStatusToLocalStatus(dCode, eCode);

                    // 🛡️ BLINDAJE ANTI-COBROS FALSOS
                    if (hasODInHistory && (event.eventType === 'DL' || dCode === 'DL' || eCode === '005')) {
                        eventStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    } else if (eCode === '005') {
                        eventStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    }
                    
                    if (!Object.values(ShipmentStatusType).includes(eventStatus)) eventStatus = ShipmentStatusType.DESCONOCIDO;

                    if (event.eventType === 'OD' || dCode === 'OD') {
                        eventStatus = subConfig.trackExternalDelivery ? ShipmentStatusType.ACARGO_DE_FEDEX : ShipmentStatusType.EN_RUTA;
                    }

                    // GUARDAR HISTORIA (Para ChargeShipments)
                    for (const charge of chargeList) {
                        const historyEntry = queryRunner.manager.create(ShipmentStatus, {
                            status: eventStatus,
                            exceptionCode: eCode,
                            timestamp: eventDate,
                            chargeShipment: charge, // Adaptado a carga
                            notes: event.eventDescription || 'FedEx Scan'
                        });
                        await queryRunner.manager.save(historyEntry);
                    }

                    // --- GARANTÍA DE INGRESOS (CONDICIONAL) ---
                    if (subConfig.generateIncomes) {
                        let isChargeable = false;
                        let chargeReason = '';

                        if (eventStatus === ShipmentStatusType.ENTREGADO || eventStatus === ShipmentStatusType.ENTREGADO_POR_FEDEX) {
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
                                const tempShipment = { ...mainCharge };
                                if (chargeReason.includes('3ra VISITA')) tempShipment.status = ShipmentStatusType.CLIENTE_NO_DISPONIBLE as any;
                                else tempShipment.status = eventStatus as any;
                                
                                await this.generateIncomes(tempShipment as any, eventDate, eCode, queryRunner.manager);
                                this.logger.log(`💰 Ingreso Generado (Carga) [${tn}]: ${chargeReason}`);
                                paidWeeks.add(weekKey);
                            } else {
                                paidWeeks.add(weekKey);
                            }
                        }
                    }
                }

                // 🚨 SAFETY NET: RESPALDO FINANCIERO CONDICIONADO A LA SUCURSAL
                if (subConfig.generateIncomes) {
                    const isDeliveredGlobal = (lsdHeader?.code === 'DL' || lsdHeader?.derivedCode === 'DL');
                    if (isDeliveredGlobal && !hasODInHistory) {
                        const actualDeliveryDateStr = trackResult.dateAndTimes?.find((d: any) => d.type === 'ACTUAL_DELIVERY')?.dateTime;
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
                                    const tempShipment = { ...mainCharge, status: ShipmentStatusType.ENTREGADO as any };
                                    await this.generateIncomes(tempShipment as any, deliveryDate, 'DL', queryRunner.manager);
                                    this.logger.log(`💰 Ingreso Generado (Backup Header Carga) [${tn}]: ENTREGADO (DL)`);
                                    paidWeeks.add(weekKey);
                                }
                            }
                        }
                    }
                }

                // =================================================================================
                // 🛡️ SECCIÓN 5: LÓGICA BASADA EN TIEMPO (CHRONOLOGICAL CONSENSUS)
                // =================================================================================
                
                const sortedScanEvents = [...scanEvents].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
                const newestEvent = sortedScanEvents.length > 0 ? sortedScanEvents[0] : null;

                let newestEventStatus: any = ShipmentStatusType.DESCONOCIDO;
                let newestEventTime = 0;

                if (newestEvent) {
                    newestEventStatus = mapFedexStatusToLocalStatus(newestEvent.derivedStatusCode || '', newestEvent.exceptionCode || '');
                    newestEventTime = new Date(newestEvent.date).getTime();
                }

                const headerStatus = mapFedexStatusToLocalStatus(lsdHeader?.derivedCode || lsdHeader?.code || '', lsdHeader?.ancillaryDetails?.[0]?.reason);
                const isHeaderTerminal = ['DL', 'DE', 'SE'].includes(lsdHeader?.code || ''); 

                let fedexProposedStatus = newestEventStatus;

                if (isHeaderTerminal || newestEventTime === 0) {
                    fedexProposedStatus = headerStatus;
                }

                // Prioridad de Entrega Absoluta
                if (lsdHeader?.code === 'DL' || lsdHeader?.derivedCode === 'DL' || scanEvents.some((e: any) => e.derivedStatusCode === 'DL' || e.eventType === 'DL')) {
                    fedexProposedStatus = ShipmentStatusType.ENTREGADO;
                }

                let finalStatus = mainCharge.status; 

                // Time Shield contra Estatus Internos
                if (newestEventTime > lastOpTime || fedexProposedStatus === ShipmentStatusType.ENTREGADO) {
                    finalStatus = fedexProposedStatus;
                }

                // Aplicación de OD
                if (subConfig.trackExternalDelivery) {
                    if (hasODInHistory && finalStatus !== ShipmentStatusType.ENTREGADO && finalStatus !== ShipmentStatusType.ENTREGADO_POR_FEDEX) {
                        finalStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                    } else if (finalStatus === ShipmentStatusType.ENTREGADO && hasODInHistory) {
                        finalStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                    }
                }

                // =================================================================================
                // 🛡️ SECCIÓN 6: CANDADOS DE INTEGRIDAD (PROTECCIÓN EXCLUSIVA DE TERMINALES)
                // =================================================================================
                let isLocked = false;
                const terminalStatuses = [
                    ShipmentStatusType.ENTREGADO, 
                    ShipmentStatusType.ENTREGADO_POR_FEDEX,
                    ShipmentStatusType.DEVUELTO_A_FEDEX,
                    ShipmentStatusType.RETORNO_ABANDONO_FEDEX
                ];

                if (terminalStatuses.includes(mainCharge.status) && !terminalStatuses.includes(finalStatus as any)) {
                    this.logger.warn(`[C2 - ${tn}] 🔒 Escudo Terminal: Bloqueado retroceso de ${mainCharge.status} a ${finalStatus}`);
                    isLocked = true;
                }

                if (!isLocked && mainCharge.status !== finalStatus) {
                    const isFedexTakingBack = [ShipmentStatusType.EN_RUTA, ShipmentStatusType.EN_BODEGA, ShipmentStatusType.PENDIENTE].includes(mainCharge.status) && finalStatus === ShipmentStatusType.ACARGO_DE_FEDEX;
                    if (isFedexTakingBack) {
                        this.logger.warn(`[C2 - ${tn}] 🔄 Válvula de Escape: FedEx retomó control (OD) desde ${mainCharge.status}.`);
                    }
                }

                // =================================================================================
                // GUARDADO EN CASCADA
                // =================================================================================
                if (!isLocked) {
                    const newUniqueId = trackResult.trackingNumberInfo?.trackingNumberUniqueId;
                    const newCarrierCode = trackResult.trackingNumberInfo?.carrierCode;
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
                        // Persistimos el carrierCode que devuelve FedEx (estatus exacto en la próxima corrida).
                        if (newCarrierCode && (charge as any).carrierCode !== newCarrierCode) {
                            (charge as any).carrierCode = newCarrierCode;
                            hasChanges = true;
                        }
                        if (newReceivedBy && (charge as any).receivedByName !== newReceivedBy) {
                            (charge as any).receivedByName = newReceivedBy;
                            hasChanges = true;
                        }

                        if (hasChanges) {
                            await queryRunner.manager.save(ChargeShipment, charge);
                        }
                    }
                }

                // Log por paquete SOLO cuando cambia el estatus (la señal que importa).
                if (!isLocked && prevStatus !== finalStatus) {
                    this.logger.log(`📦 [C2 - ${tn}] ${prevStatus} → ${finalStatus}`);
                }

                await queryRunner.commitTransaction();
                okCount++;

            } catch (error) {
                this.logger.error(`[C2 - ${tn}] 💥 Error Transacción: ${error.message}`);
                failed.push({ trackingNumber: tn, reason: `TX: ${error.message}` });
                if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
            } finally {
                await queryRunner.release();
            }
          }));

          await Promise.all(tasks);
          if (aborted) break;
        }

        this.logger.log(`📈 [F2] OK: ${okCount} | Sin datos: ${noDataCount} | Fallidas: ${failed.length} de ${uniqueTrackingNumbers.length}`);
        this.logger.log(`   ⏱️ [F2] Total ${((Date.now() - runStart) / 1000).toFixed(1)}s · prefetch ${(prefetchMs / 1000).toFixed(1)}s · reintentos individuales: ${retries}/${uniqueTrackingNumbers.length}${retries > uniqueTrackingNumbers.length * 0.5 ? ' ⚠️ (prefetch no está pegando — revisar key)' : ''}`);
        // Si fue una caída de conectividad, NO escribimos dead-letter (no son fallos por guía).
        if (aborted) {
          this.logger.error(`🔌 [F2] Corrida abortada por conectividad con FedEx. No se generó dead-letter.`);
        } else {
          await this.writeFedexDeadLetter('charge', failed);
        }
        return {
          total: uniqueTrackingNumbers.length,
          ok: okCount,
          noData: noDataCount,
          failed: failed.length,
          aborted,
          failedTrackings: failed.map(f => f.trackingNumber),
        };
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
          let chargeShipmentIds: string[] = []; // Nueva lista para recolectar cargas
          
          const inputList = (Array.isArray(idOrList) ? idOrList : [idOrList])
              .filter(val => val && val.trim() !== '');

          if (inputList.length === 0) {
              return { status: 'NO_DATA', message: 'No se proporcionaron datos válidos para auditar.' };
          }

          this.logger.log(`🔎 Audit By Entity [${type}]: Buscando referencias cruzadas para ${inputList.length} items...`);

          switch (type) {
              case 'trackings':
                  // Buscamos en Shipments
                  const sT = await this.shipmentRepository.find({
                      where: { trackingNumber: In(inputList) },
                      select: ['id']
                  });
                  shipmentIds = sT.map(s => s.id);

                  // Buscamos en ChargeShipments (Crucial para trackings que solo son carga)
                  const cT = await this.chargeShipmentRepository.find({
                      where: { trackingNumber: In(inputList) },
                      select: ['id']
                  });
                  chargeShipmentIds = cT.map(c => c.id);
                  break;

              case 'dispatch':
                  const sD = await this.shipmentRepository.find({
                      where: [
                          { packageDispatch: { id: In(inputList) } },
                          { packageDispatch: { trackingNumber: In(inputList) } }
                      ],
                      select: ['id']
                  });
                  shipmentIds = sD.map(s => s.id);

                  const cD = await this.chargeShipmentRepository.find({
                      where: [
                          { packageDispatch: { id: In(inputList) } },
                          { packageDispatch: { trackingNumber: In(inputList) } }
                      ],
                      select: ['id']
                  });
                  chargeShipmentIds = cD.map(c => c.id);

                  // Las cargas usualmente no están ligadas a despacho directamente, 
                  // pero si tuvieras la relación, se agregaría aquí.
                  break;

              case 'consolidated':
                  const sC = await this.shipmentRepository.find({
                      where: [
                          { consolidatedId: In(inputList) },
                          { consNumber: In(inputList) }
                      ],
                      select: ['id']
                  });
                  shipmentIds = sC.map(s => s.id);

                  // Buscar cargas por consolidado si aplica
                  const cC = await this.chargeShipmentRepository.find({
                      where: { consolidatedId: In(inputList) },
                      select: ['id']
                  });
                  chargeShipmentIds = cC.map(c => c.id);
                  break;

              case 'unloading':
                  const sU = await this.shipmentRepository.find({
                      where: [
                          { unloading: { id: In(inputList) } },
                          { unloading: { trackingNumber: In(inputList) } }
                      ],
                      select: ['id']
                  });
                  shipmentIds = sU.map(s => s.id);
                  break;
          }

          shipmentIds = [...new Set(shipmentIds)];
          chargeShipmentIds = [...new Set(chargeShipmentIds)];

          if (shipmentIds.length === 0 && chargeShipmentIds.length === 0) {
              return { 
                  status: 'NO_MATCH', 
                  message: `No se encontraron registros en ninguna tabla para ${type}.` 
              };
          }

          this.logger.log(`🚀 Iniciando Auditoría: ${shipmentIds.length} guías y ${chargeShipmentIds.length} cargas encontradas.`);

          return await this.auditAndFixFedexShipments(shipmentIds, chargeShipmentIds, applyFix);
      }

      async auditAndFixFedexShipments(
          shipmentIds: string[], 
          chargeShipmentIds: string[] = [], 
          applyFix: boolean = false
      ) {
          const limit = pLimit(5);
          const logDir = './logs';
          const logFile = `${logDir}/audit_forensic_${new Date().toISOString().replace(/:/g, '-')}.txt`;

          if (!fsSync.existsSync(logDir)) fsSync.mkdirSync(logDir, { recursive: true });

          // 1. UNIFICAR EL TRABAJO IDENTIFICANDO SU ORIGEN
          const allWork: {id: string, type: 'SHIPMENT' | 'CHARGE'}[] = [
              ...shipmentIds.map(id => ({ id, type: 'SHIPMENT' as const })),
              ...chargeShipmentIds.map(id => ({ id, type: 'CHARGE' as const }))
          ];

          const tasks = allWork.map((work) => limit(async () => {
              const queryRunner = this.dataSource.createQueryRunner();
              await queryRunner.connect();
              await queryRunner.startTransaction();

              const isShipment = work.type === 'SHIPMENT';
              const audit = {
                  id: work.id,
                  type: work.type,
                  tracking: 'PENDING',
                  status: 'PENDING',
                  analysis: [] as string[],
                  actions: [] as string[],
                  detected_incomes: 0,
                  recovered_incomes: 0
              };

              try {
                  // 2. OBTENER DATOS BD
                  let entity: any = null;
                  if (isShipment) {
                      entity = await queryRunner.manager.findOne(Shipment, { where: { id: work.id }, relations: ['subsidiary'] });
                  } else {
                      entity = await queryRunner.manager.findOne(ChargeShipment, { where: { id: work.id }, relations: ['subsidiary'] });
                  }

                  if (!entity) {
                      audit.status = 'NOT_FOUND_IN_DB';
                      await queryRunner.rollbackTransaction();
                      return audit;
                  }

                  const tn = entity.trackingNumber;
                  audit.tracking = tn;
                  const dbStatus = entity.status;

                  // 3. OBTENER DATOS FEDEX
                  let fedexInfo;
                  try {
                      fedexInfo = await this.fedexService.trackPackage(tn, entity.fedexUniqueId || undefined);
                  } catch (e) {
                      audit.status = 'FEDEX_API_ERROR';
                      audit.analysis.push(`Error API: ${e.message}`);
                      await queryRunner.rollbackTransaction();
                      return audit;
                  }

                  let allTrackResults = fedexInfo?.output?.completeTrackResults?.[0]?.trackResults || [];
                  
                  // REINTENTO GLOBAL
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
                      await queryRunner.rollbackTransaction();
                      return audit;
                  }

                  // SELECTOR DE GENERACIÓN
                  if (allTrackResults.length > 1) {
                      allTrackResults.sort((a, b) => {
                          const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
                          const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
                          if (seqA !== seqB) return seqB - seqA;
                          return new Date(b.scanEvents?.[0]?.date || 0).getTime() - new Date(a.scanEvents?.[0]?.date || 0).getTime();
                      });
                  }

                  const trackResult = allTrackResults[0]; 
                  const scanEvents = trackResult.scanEvents || [];
                  const lsd = trackResult.latestStatusDetail;
                  const chronologicalEvents = [...scanEvents].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                  // 🛡️ BÚSQUEDA DE BARRERAS (HISTORIAL)
                  const histCol = isShipment ? 'shipmentId' : 'chargeShipmentId';
                  const existingHistory = await queryRunner.manager.query(
                      `SELECT status, timestamp, exceptionCode FROM shipment_status WHERE ${histCol} = ? ORDER BY timestamp DESC`,
                      [work.id]
                  );

                  // ⏱️ TIME SHIELD & CREATION BARRIER
                  const initEvent = existingHistory.find((h: any) => h.exceptionCode === 'INIT');
                  const creationTime = initEvent ? new Date(initEvent.timestamp).getTime() : new Date((entity as any).createdAt || 0).getTime();
                  
                  const OPERATIONAL_STATUSES = [ShipmentStatusType.PENDIENTE, ShipmentStatusType.EN_BODEGA, ShipmentStatusType.EN_RUTA];
                  // FIX (jul-2026): la ÚLTIMA operación interna (MÁS RECIENTE), no la 1ª.
                  // .find() sin ORDER BY devolvía la más vieja → un 67 viejo de FedEx pisaba
                  // el en_ruta de la salida a ruta (lo regresaba a en_bodega sin historial).
                  const lastOpTime = existingHistory.reduce(
                    (max: number, h: any) => OPERATIONAL_STATUSES.includes(h.status)
                      ? Math.max(max, new Date(h.timestamp).getTime()) : max,
                    0,
                  );
                  const timeShieldLimit = Math.max(creationTime, lastOpTime);

                  const processedSignatures = new Set(existingHistory.map((h: any) => `${new Date(h.timestamp).getTime()}_${(h.exceptionCode || '').trim()}`));

                  // 4. ANÁLISIS FORENSE Y COBROS
                  let count08 = 0;
                  const paidWeeks = new Set<string>();
                  const subId = isShipment ? entity.subsidiary?.id?.toLowerCase() : null;
                  const matchedKey = subId ? Object.keys(this.SUBSIDIARY_CONFIG).find(key => key.toLowerCase() === subId) : null;
                  const subConfig = matchedKey ? this.SUBSIDIARY_CONFIG[matchedKey] : { trackExternalDelivery: false };

                  for (const event of chronologicalEvents) {
                      const evtTime = new Date(event.date).getTime();
                      // 🛑 Ignorar eventos previos a la creación del paquete (Anti-Reciclaje)
                      if (evtTime < creationTime) continue;

                      const evtCode = (event.exceptionCode || '').trim();
                      const evtDate = new Date(event.date);
                      let evtStatus: any = mapFedexStatusToLocalStatus(event.derivedStatusCode || '', evtCode);

                      if (evtCode === '005') evtStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                      if (isShipment && subConfig.trackExternalDelivery && event.eventType === 'OD' && evtTime > lastOpTime) {
                          evtStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                      }

                      // A. Recuperación de Historia
                      const signature = `${evtTime}_${evtCode}`;
                      if (!processedSignatures.has(signature)) {
                          if (applyFix) {
                              const historyPayload: any = { status: evtStatus, exceptionCode: evtCode, timestamp: evtDate, notes: event.eventDescription || 'FedEx Scan (Recovered)' };
                              if (isShipment) historyPayload.shipment = entity;
                              else historyPayload.chargeShipment = entity;

                              await queryRunner.manager.save(ShipmentStatus, historyPayload);
                              processedSignatures.add(signature);
                              audit.actions.push(`✅ Historia recuperada: [${evtCode}] -> ${evtStatus}`);
                          } else {
                              audit.analysis.push(`📜 Falta evento: ${evtCode} (${evtStatus})`);
                          }
                      }

                      // B. Cobros (Shipments)
                      if (isShipment) {
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
                                  where: { trackingNumber: tn, date: Between(mDate.startOf('isoWeek').toDate(), mDate.endOf('isoWeek').toDate()) }
                              });
                              if (!incomeExists) {
                                  if (applyFix) {
                                      const tempShipment = { ...entity, status: (chargeReason.includes('3ra') ? ShipmentStatusType.CLIENTE_NO_DISPONIBLE : evtStatus) };
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
                  }

                  // 5. ESTATUS FINAL Y PESOS (CONSENSO)
                  const getWeight = (status: any) => {
                      if (status === ShipmentStatusType.ENTREGADO || status === ShipmentStatusType.ENTREGADO_POR_FEDEX) return 10;
                      if ([ShipmentStatusType.RECHAZADO, ShipmentStatusType.DIRECCION_INCORRECTA, ShipmentStatusType.CLIENTE_NO_DISPONIBLE, ShipmentStatusType.RETORNO_ABANDONO_FEDEX, ShipmentStatusType.DEVUELTO_A_FEDEX, ShipmentStatusType.CAMBIO_FECHA_SOLICITADO, ShipmentStatusType.LLEGADO_DESPUES].includes(status)) return 9;
                      if (status === ShipmentStatusType.EN_RUTA) return 8;
                      if (status === ShipmentStatusType.EN_BODEGA) return 7;
                      if (status === ShipmentStatusType.PENDIENTE) return 6;
                      if (status === ShipmentStatusType.ACARGO_DE_FEDEX) return 5;
                      if (status === ShipmentStatusType.EN_TRANSITO || status === ShipmentStatusType.ESTACION_FEDEX) return 2;
                      return 0;
                  };

                  const headerStatus = mapFedexStatusToLocalStatus(lsd?.derivedCode || lsd?.code || '', lsd?.ancillaryDetails?.[0]?.reason);
                  let historyStatus = ShipmentStatusType.DESCONOCIDO;
                  let historyWeight = -1;

                  for (const event of scanEvents) {
                      const evtTime = new Date(event.date).getTime();
                      if (evtTime > timeShieldLimit) {
                          const s = mapFedexStatusToLocalStatus(event.derivedStatusCode || '', event.exceptionCode || '');
                          const w = getWeight(s);
                          if (w >= historyWeight) { historyStatus = s; historyWeight = w; }
                      }
                  }

                  let targetStatus: any = (historyWeight > getWeight(headerStatus)) ? historyStatus : headerStatus;
                  
                  // Prioridad Absoluta de Entrega
                  if (lsd?.code === 'DL' || lsd?.derivedCode === 'DL' || scanEvents.some(e => e.derivedStatusCode === 'DL')) {
                      targetStatus = ShipmentStatusType.ENTREGADO;
                  }

                  // Aplicación de OD (Solo Shipments)
                  const hasOD = subConfig.trackExternalDelivery && (lsd?.code === 'OD' || scanEvents.some(e => e.eventType === 'OD' && new Date(e.date).getTime() > lastOpTime));
                  if (isShipment && hasOD) {
                      if (targetStatus === ShipmentStatusType.ENTREGADO) targetStatus = ShipmentStatusType.ENTREGADO_POR_FEDEX;
                      else targetStatus = ShipmentStatusType.ACARGO_DE_FEDEX;
                  }

                  // Escudo de Oro (No degradar)
                  const dbWeight = getWeight(dbStatus);
                  if (dbStatus === ShipmentStatusType.ENTREGADO && targetStatus !== ShipmentStatusType.ENTREGADO) {
                      targetStatus = dbStatus;
                  } else if (dbWeight > getWeight(targetStatus) && targetStatus !== ShipmentStatusType.ENTREGADO) {
                      targetStatus = dbStatus;
                  }

                  // 6. APLICACIÓN DE CAMBIOS
                  if (dbStatus !== targetStatus || (trackResult.trackingNumberInfo?.trackingNumberUniqueId && entity.fedexUniqueId !== trackResult.trackingNumberInfo.trackingNumberUniqueId)) {
                      if (applyFix) {
                          entity.status = targetStatus;
                          entity.fedexUniqueId = trackResult.trackingNumberInfo?.trackingNumberUniqueId;
                          entity.receivedByName = trackResult.deliveryDetails?.receivedByName;
                          if (isShipment) {
                              await queryRunner.manager.save(Shipment, entity);
                              const charges = await queryRunner.manager.find(ChargeShipment, { where: { trackingNumber: tn } });
                              for (const c of charges) { c.status = targetStatus; await queryRunner.manager.save(ChargeShipment, c); }
                          } else {
                              await queryRunner.manager.save(ChargeShipment, entity);
                          }
                          audit.actions.push(`✅ Estatus sincronizado a ${targetStatus}`);
                      }
                  }

                  await queryRunner.commitTransaction();
                  audit.status = applyFix && audit.actions.length > 0 ? 'FIXED' : (audit.analysis.length > 0 ? 'ISSUES_FOUND' : 'HEALTHY');
                  return audit;
              } catch (e) {
                  if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
                  return { ...audit, status: 'ERROR', analysis: [e.message] };
              } finally {
                  await queryRunner.release();
              }
          }));

          const results = await Promise.all(tasks);
          return { summary: { total: results.length, healthy: results.filter(r => r.status === 'HEALTHY').length, fixed: results.filter(r => r.status === 'FIXED').length }, details: results.filter(r => r.status !== 'HEALTHY') };
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

      async check44ByTrackingNumbers(trackingNumbers: string[]): Promise<{ trackingNumber: string, has44: boolean }[]> { 
        // 1. Arreglo para ir guardando los resultados
        const results: { trackingNumber: string, has44: boolean }[] = [];
        
        // 2. Definir "hoy" y "ayer" normalizados a la medianoche para una comparación exacta
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        for (const tn of trackingNumbers) {

            // --- 1. CONSULTA FEDEX (Estrategia Proactiva) ---
            let fedexInfo;
            try {
                fedexInfo = await this.fedexService.trackPackage(tn);
            } catch (error) {
                this.logger.error(`[${tn}] Error API FedEx: ${error.message}`);
                results.push({ trackingNumber: tn, has44: false });
                continue; // 🚨 CORRECCIÓN: Usa 'continue' en vez de 'return'
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

            if (allTrackResults.length === 0) {
                results.push({ trackingNumber: tn, has44: false });
                continue; // 🚨 CORRECCIÓN: Usa 'continue'
            }

            // --- 2. BÚSQUEDA DEL ESTATUS 44 EN SCAN EVENTS ---
            let has44 = false;

            for (const trackResult of allTrackResults) {
                const scanEvents = trackResult.scanEvents || [];
                
                for (const event of scanEvents) {
                    // NOTA: Ajusta 'eventType' según la propiedad exacta de la API de FedEx donde venga el "44"
                    const isStatus44 = event.eventType === '44' || event.exceptionCode === '44'; 
                    
                    if (isStatus44 && event.date) {
                        // Convertimos la fecha del evento y la normalizamos a la medianoche
                        const eventDate = new Date(event.date);
                        eventDate.setHours(0, 0, 0, 0); 
                        
                        // Comparamos si la fecha del evento es igual a hoy o ayer
                        if (eventDate.getTime() === today.getTime() || eventDate.getTime() === yesterday.getTime()) {
                            has44 = true;
                            break; // Ya encontramos uno, podemos salir de este bucle (scanEvents)
                        }
                    }
                }
                
                if (has44) break; // Si ya se encontró, salimos también del bucle principal de resultados
            }

            // 3. Guardamos el resultado de este tracking number
            results.push({ trackingNumber: tn, has44 });
        }

        // Retornamos el arreglo completo al terminar el bucle
        return results;
      }

}



