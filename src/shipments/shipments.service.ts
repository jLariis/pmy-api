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
import * as fs from 'node:fs/promises';
import * as path from 'path';
import { Charge } from 'src/entities/charge.entity';
import { ChargeShipment } from 'src/entities/charge-shipment.entity';
import { ShipmentAndChargeDto } from './dto/shipment-and-charge.dto';
import { ChargeWithStatusDto } from './dto/charge-with-status.dto';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { GetShipmentKpisDto } from './dto/get-shipment-kpis.dto';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { ConsolidatedType } from 'src/common/enums/consolidated-type.enum';
import { toDate, toZonedTime } from 'date-fns-tz';
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
    @InjectRepository(ForPickUp)
    private forPickUpRepository: Repository<ForPickUp>,
    private readonly fedexService: FedexService,
    private readonly dhlService: DHLService,
    private readonly subsidiaryService: SubsidiariesService,
    @Inject(forwardRef(() => ConsolidatedService))
    private readonly consolidatedService: ConsolidatedService,
    private readonly mailService: MailService
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

  private generateNote(scanEvent: FedExScanEventDto, isInitialState: boolean) {
    //console.log("🚀 ~ ShipmentsService ~ generateNote ~ isInitialState:", isInitialState) 
    if(isInitialState) return 'Paquete recogido en sucursal.'

    switch(scanEvent.exceptionCode) {
      case '07':
      case '03':
      case '08':
      case '17': 
        return this.translateEventDescription(scanEvent.exceptionDescription);
      default:
        return 'Actualizado por sistema y validado con Fedex.'
    }
  }

  /** PUDIERA CAMBIARSE A USAR el code 07-08-17 o el string code DL etc */
  private translateEventDescription(event: string) {
    switch(event) {
      case 'A request was made to change this delivery date.':
      case 'A request was made to change this delivery date':
        console.log("🚀 ~ ShipmentsService ~ translate ~ entro  delivery date")
        return '17 - Se realizó una solicitud para cambiar esta fecha de entrega.'
      case 'Customer not available or business closed':
      case 'Customer not available or business closed.':
        console.log("🚀 ~ ShipmentsService ~ translate ~ entro busines closed")
        return '08 - Cliente no disponible o negocio cerrado.'
      case 'Delivery was refused by the recipient':
      case 'Delivery was refused by the recipient.':
        return '07 - La entrega fue rechazada por el cliente.'
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
  async getAllChargesWithStatus(): Promise<ChargeWithStatusDto[]> {
    const charges = await this.chargeRepository.find({
      relations: ['subsidiary'],
      order: {
        createdAt: 'DESC'
      }
    });

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

  /*** Procesar cargas cuando vienen los archivos separados SII SE USA*/

  async processFileF2(file: Express.Multer.File, subsidiaryId: string, consNumber: string, consDate?: Date) {
    console.log("Star working on new method")

    if (!file) throw new BadRequestException('No file uploaded');
    
    console.log('🔍 DEBUG: Start processing file:', file.originalname);
    console.log('🔍 DEBUG: File size:', file.size);
    console.log('🔍 DEBUG: Buffer length:', file.buffer.length);
    
    // USAR SOLO console.log POR AHORA - NO this.logger
    console.log('🔍 DEBUG: Before validation');

    const { buffer, originalname } = file;
    const notFoundTrackings: any[] = [];
    const errors: any[] = [];
    const migrated: ChargeShipment[] = [];

    try {
      // Validación de tipo de archivo
      if (!originalname.match(/\.(csv|xlsx?)$/i)) {
        throw new BadRequestException('Unsupported file type');
      }

      this.logger.log('📊 Reading Excel file...');

      // Leer archivo Excel con mejor manejo de errores
      let workbook;
      try {
        workbook = XLSX.read(buffer, { 
          type: 'buffer',
          cellDates: true,
          cellText: false
        });
      } catch (excelError) {
        this.logger.error(`❌ Error reading Excel file: ${excelError.message}`);
        throw new BadRequestException('Invalid Excel file format');
      }

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new BadRequestException('Excel file has no sheets');
      }

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      this.logger.log(`📋 Processing sheet: ${workbook.SheetNames[0]}`);

      // Parsear el archivo
      let shipmentsToUpdate;
      try {
        shipmentsToUpdate = parseDynamicFileF2(sheet);
        this.logger.log(`📦 Found ${shipmentsToUpdate.length} shipments in file`);
      } catch (parseError) {
        this.logger.error(`❌ Error parsing Excel data: ${parseError.message}`);
        throw new BadRequestException('Error parsing Excel data');
      }

      if (shipmentsToUpdate.length === 0) {
        this.logger.warn('⚠️ No shipments found in the file');
        return { message: 'No shipments found in the file.' };
      }

      this.logger.log('💾 Creating charge record...');

      // Crear charge
      const newCharge = this.chargeRepository.create({
        subsidiary: { id: subsidiaryId },
        chargeDate: consDate ? format(consDate, 'yyyy-MM-dd HH:mm:ss') : format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        numberOfPackages: shipmentsToUpdate.length,
        consNumber
      });

      const savedCharge = await this.chargeRepository.save(newCharge);
      this.logger.log(`✅ Charge created: ${savedCharge.id}`);

      const chargeSubsidiary = await this.subsidiaryRepository.findOne({ 
        where: { id: subsidiaryId } 
      });

      if (!chargeSubsidiary) {
        throw new BadRequestException('Subsidiary not found');
      }

      this.logger.log('🔄 Processing shipments...');

      // Procesar en lotes para mejor performance
      const BATCH_SIZE = 50;
      const batches = [];
      
      for (let i = 0; i < shipmentsToUpdate.length; i += BATCH_SIZE) {
        batches.push(shipmentsToUpdate.slice(i, i + BATCH_SIZE));
      }

      for (const [batchIndex, batch] of batches.entries()) {
        this.logger.log(`🔁 Processing batch ${batchIndex + 1}/${batches.length}`);
        
        const batchPromises = batch.map(async (shipment, index) => {
          const shipmentIndex = batchIndex * BATCH_SIZE + index + 1;
          
          try {
            this.logger.debug(`🔍 Validating shipment ${shipmentIndex}/${shipmentsToUpdate.length}: ${shipment.trackingNumber}`);

            const validation = await this.existShipmentByTrackSpecial(
              shipment.trackingNumber,
              shipment.recipientName,
              shipment.recipientAddress,
              shipment.recipientZip
            );

            if (!validation.exist) {
              this.logger.warn(`❓ Shipment not found: ${shipment.trackingNumber}`);
              notFoundTrackings.push(shipment);
              return;
            }

            // Resto del procesamiento...
            const original = await this.shipmentRepository.findOne({
              where: { id: validation.shipment.id },
              relations: ['subsidiary'],
            });

            if (!original) {
              notFoundTrackings.push(shipment);
              return;
            }

            await this.incomeRepository.delete({ trackingNumber: original.trackingNumber });

            const chargeShipment = this.chargeShipmentRepository.create({
              ...original,
              id: undefined,
              charge: savedCharge,
            });

            const savedChargeShipment = await this.chargeShipmentRepository.save(chargeShipment);
            await this.shipmentRepository.delete(original.id);

            this.logger.log(`✅ Migrated shipment: ${original.trackingNumber}`);
            migrated.push(savedChargeShipment);

          } catch (err) {
            this.logger.error(`❌ Error with shipment ${shipment.trackingNumber}: ${err.message}`);
            errors.push({ 
              tracking: shipment.trackingNumber, 
              reason: err.message,
              error: err.stack 
            });
          }
        });

        await Promise.allSettled(batchPromises);
      }

      // ✅ Crear el ingreso relacionado al charge solo si hubo migraciones exitosas
      if (migrated.length > 0 && chargeSubsidiary) {
        const newIncome = this.incomeRepository.create({
          subsidiary: chargeSubsidiary,
          shipmentType: ShipmentType.FEDEX,
          incomeType: IncomeStatus.ENTREGADO,
          cost: chargeSubsidiary.chargeCost,
          isGrouped: true,
          sourceType: IncomeSourceType.CHARGE,
          charge: { id: savedCharge.id },
          date: consDate ? consDate : new Date(),
        });

        await this.incomeRepository.save(newIncome);
      }

      this.logger.log(`🎉 Process completed. Migrated: ${migrated.length}, Not found: ${notFoundTrackings.length}, Errors: ${errors.length}`);

      return {
        migrated: migrated.length,
        notFound: notFoundTrackings.length,
        errors: errors.length,
        details: {
          migratedTrackings: migrated.map(m => m.trackingNumber),
          notFoundTrackings: notFoundTrackings.map(n => n.trackingNumber),
          errorDetails: errors
        }
      };

    } catch (error) {
      this.logger.error(`💥 Critical error in processFileF2: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Error processing file: ${error.message}`);
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
          this.logger.log(`✅ Incluido income para ENTREGADO con excepción 16 usando el primer evento: ${trackingNumber}`);
          return { isValid: true, timestamp: firstEntregado.timestamp };
        } else {
          const reason = `❌ Excluido de income: ENTREGADO con excepción 16 sin eventos ENTREGADO válidos (${trackingNumber})`;
          this.logger.warn(reason);
          this.logBuffer.push(reason);
          return { isValid: false, timestamp: eventDate, reason };
        }
      }

      const timestamp = firstEntregado ? firstEntregado.timestamp : eventDate;
      this.logger.log(`✅ Income permitido para ENTREGADO (prioridad máxima): ${trackingNumber}`);
      return { isValid: true, timestamp };
    }

    // 2. Allow NO_ENTREGADO with exception 07
    if (mappedStatus === ShipmentStatusType.NO_ENTREGADO && exceptionCodes.includes('07')) {
      this.logger.log(`✅ Income permitido para NO_ENTREGADO con excepción 07: ${trackingNumber}`);
      return { isValid: true, timestamp: eventDate };
    }

    // 3. NO_ENTREGADO with exception 03
    if (mappedStatus === ShipmentStatusType.NO_ENTREGADO && exceptionCodes.includes('03')) {
      const reason = `❌ Excluido de income: NO_ENTREGADO con excepción 03 (${trackingNumber})`;
      this.logger.warn(reason);
      this.logBuffer.push(reason);
      return { isValid: false, timestamp: eventDate, reason };
    }

    // 17. NO_ENTREGADO with exception 17
    if (mappedStatus === ShipmentStatusType.NO_ENTREGADO && exceptionCodes.includes('17')) {
      const reason = `❌ Excluido de income: NO_ENTREGADO con excepción 17 (${trackingNumber})`;
      this.logger.warn(reason);
      this.logBuffer.push(reason);
      return { isValid: false, timestamp: eventDate, reason };
    }

    // 4. Exception OD (global)
    if (exceptionCodes.includes('OD')) {
      const reason = `📦 Shipment con excepción "OD" excluido del income y marcado para procesamiento especial: ${trackingNumber}`;
      this.logger.warn(reason);
      this.logBuffer.push(reason);
      return { isValid: false, timestamp: eventDate, reason, isOD: true };
    }

    // 5. Subsidiary-specific rules for exceptionCode 08
    if (exceptionCodes.includes('08')) {
      const subsidiaryId = shipment.subsidiary?.id || 'DEFAULT';
      const subsidiaryRules = {
        'mexico-city': { minEvents08: 3 },
        'guadalajara': { minEvents08: 2 },
        'DEFAULT': { minEvents08: 3 },
      };

      const rule = subsidiaryRules[subsidiaryId] || subsidiaryRules['DEFAULT'];
      const eventos08 = histories.filter((h) => h.exceptionCode === '08');

      if (eventos08.length < rule.minEvents08) {
        const reason = `❌ Excluido de income: excepción 08 con menos de ${rule.minEvents08} eventos para sucursal ${subsidiaryId} (${trackingNumber})`;
        this.logger.warn(reason);
        this.logBuffer.push(reason);
        return { isValid: false, timestamp: eventDate, reason };
      }
  }

  // 6. Default case
  this.logger.log(`✅ Income permitido para ${trackingNumber} con status=${mappedStatus}`);
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
    this.logger.log(`🔍 Iniciando processScanEventsToStatuses para ${shipment.trackingNumber} con ${scanEvents.length} eventos`);
    const { statuses, hasException, hasDelivered } = scanEvents
      .sort((a, b) => {
        const dateA = toZonedTime(parse(a.date, "yyyy-MM-dd'T'HH:mm:ssXXX", new Date()), 'UTC', { timeZone: 'America/Mexico_City' });
        const dateB = toZonedTime(parse(b.date, "yyyy-MM-dd'T'HH:mm:ssXXX", new Date()), 'UTC', { timeZone: 'America/Mexico_City' });
        return dateA.getTime() - dateB.getTime();
      })
      .reduce<{
        statuses: ShipmentStatus[];
        hasException: boolean;
        hasDelivered: boolean;
      }>(
        (acc, event, index) => {
          this.logger.log(`📌 Procesando evento ${index + 1}/${scanEvents.length} para ${shipment.trackingNumber}`);
          const mappedStatus = mapFedexStatusToLocalStatus(event.derivedStatusCode, event.exceptionCode);
          if (mappedStatus === ShipmentStatusType.DESCONOCIDO) {
            this.logger.warn(`⚠️ Estado desconocido para evento: ${event.derivedStatusCode}`);
            return acc;
          }

          const timestamp = toZonedTime(parse(event.date, "yyyy-MM-dd'T'HH:mm:ssXXX", new Date()), 'UTC', { timeZone: 'America/Mexico_City' });
          if (isNaN(timestamp.getTime())) {
            this.logger.warn(`⚠️ Fecha inválida para evento: ${event.date}`);
            return acc;
          }

          const statusEntry = Object.assign(new ShipmentStatus(), {
            shipment,
            status: mappedStatus,
            exceptionCode: event.exceptionCode || undefined,
            notes: event.exceptionCode
              ? `${event.exceptionCode} - ${event.exceptionDescription}`
              : `${event.eventType} - ${event.eventDescription}`,
            timestamp,
          });

          acc.statuses.push(statusEntry);
          acc.hasException ||= mappedStatus === ShipmentStatusType.NO_ENTREGADO;
          acc.hasDelivered ||= mappedStatus === ShipmentStatusType.ENTREGADO;

          const logLine = `📝 [${shipment.trackingNumber}] Registrado status: ${statusEntry.status} - ${statusEntry.notes}`;
          this.logger.log(logLine);
          this.logBuffer.push(`${logLine} at ${statusEntry.timestamp.toISOString()}`);

          return acc;
        },
        { statuses: [], hasException: false, hasDelivered: false }
      );

    if (hasException && hasDelivered) {
      const msg = `📦 [${shipment.trackingNumber}] Excepciones previas pero entrega exitosa. Conservando todos los estados.`;
      this.logger.log(msg);
      this.logBuffer.push(msg);
      return statuses;
    }

    if (!hasDelivered && hasException) {
      const lastNoEntIndex = statuses.reduce(
        (last, s, i) => (s.status === ShipmentStatusType.NO_ENTREGADO ? i : last),
        -1
      );

      if (lastNoEntIndex >= 0 && lastNoEntIndex < statuses.length - 1) {
        // Separar los eventos posteriores al último NO_ENTREGADO
        const eventsAfterNoEnt = statuses.splice(lastNoEntIndex + 1);
        
        // Filtrar solo los eventos EN_RUTA que NO tienen exceptionCode 67
        const removed = eventsAfterNoEnt.filter(
          (s) => s.status === ShipmentStatusType.EN_RUTA && s.exceptionCode !== '67'
        );
        
        // Reincorporar los eventos que no deben ser eliminados
        const keptEvents = eventsAfterNoEnt.filter(
          (s) => s.status !== ShipmentStatusType.EN_RUTA || s.exceptionCode === '67'
        );
        
        statuses.push(...keptEvents);
        
        // Loggear los eventos conservados con exceptionCode 67
        keptEvents
          .filter(s => s.exceptionCode === '67')
          .forEach(s => {
            const info = `✅ [${shipment.trackingNumber}] Conservando EN_RUTA con exceptionCode 67: ${s.notes}`;
            this.logger.log(info);
            this.logBuffer.push(info);
          });
        
        // Loggear los eventos eliminados
        for (const rem of removed) {
          const warn = `🗑️ [${shipment.trackingNumber}] Eliminado EN_RUTA posterior a NO_ENTREGADO: ${rem.notes}`;
          this.logger.warn(warn);
          this.logBuffer.push(warn);
        }
      }
    }

    this.logger.log(`✅ Finalizado processScanEventsToStatuses para ${shipment.trackingNumber} con ${statuses.length} estados`);
    return statuses;
  }

  /** por si algo falta con la solución circular a shipment en Hillo / Hillo Ext */
  async addConsMasterBySubsidiaryResp(
    file: Express.Multer.File,
    subsidiaryId: string,
    consNumber: string,
    consDate?: Date,
    isAereo?: boolean
  ): Promise<{
    saved: number;
    failed: number;
    duplicated: number;
    duplicatedTrackings: ParsedShipmentDto[];
    failedTrackings: { trackingNumber: string; reason: string }[];
    errors: { trackingNumber: string; reason: string }[];
  }> {
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

    this.logger.log(`🔍 Validando subsidiaria con ID: ${subsidiaryId}`);
    const predefinedSubsidiary = await this.subsidiaryService.findById(subsidiaryId);

    if (!predefinedSubsidiary) {
      const reason = `Subsidiaria con ID '${subsidiaryId}' no encontrada`;
      this.logger.error(`❌ ${reason}`);
      this.logBuffer.push(reason);
      throw new BadRequestException(reason);
    }

    this.logger.log(`📄 Leyendo archivo Excel: ${file.originalname}`);
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const shipmentsToSave = parseDynamicSheet(workbook, { fileName: file.originalname })
    
    //console.log("🚀 ~ ShipmentsService ~ addConsMasterBySubsidiary ~ shipmentsToSave:", shipmentsToSave)
    
    this.logger.log(`📄 Total de envíos procesados desde archivo: ${shipmentsToSave.length}`);

    // Crear Consolidated
    this.logger.log(`📦 Creando consolidado para ${shipmentsToSave.length} envíos`);
    const consolidated = Object.assign(new Consolidated(), {
      date: consDate || new Date(),
      type: isAereo ? ConsolidatedType.AEREO : ConsolidatedType.ORDINARIA,
      numberOfPackages: shipmentsToSave.length,
      subsidiary: predefinedSubsidiary,
      subsidiaryId: predefinedSubsidiary.id,
      consNumber,
      isCompleted: false,
      efficiency: 0,
      commitDateTime: new Date(),
    });

    try {
      const savedConsolidated = await this.consolidatedService.create(consolidated);
      if (!savedConsolidated?.id) {
        const reason = `Error: Consolidated no retornó un ID válido tras guardar`;
        this.logger.error(`❌ ${reason}`);
        this.logBuffer.push(reason);
        throw new Error(reason);
      }
      consolidated.id = savedConsolidated.id;
      this.logger.log(`📦 Consolidado creado con ID: ${consolidated.id}`);
      this.logBuffer.push(`📦 Consolidado creado con ID: ${consolidated.id}`);
    } catch (err) {
      const reason = `Error al crear consolidado: ${err.message}`;
      this.logger.error(`❌ ${reason}`);
      this.logBuffer.push(reason);
      throw new BadRequestException(reason);
    }

    const result = {
      saved: 0,
      failed: 0,
      duplicated: 0,
      duplicatedTrackings: [] as ParsedShipmentDto[],
      failedTrackings: [] as { trackingNumber: string; reason: string }[],
    };

    const shipmentsWithError = {
      duplicated: [] as { trackingNumber: string; reason: string }[],
      fedexError: [] as { trackingNumber: string; reason: string }[],
      saveError: [] as { trackingNumber: string; reason: string }[],
    };

    const processedTrackingNumbers = new Set<string>();
    const shipmentsToGenerateIncomes: { shipment: Shipment; timestamp: Date; exceptionCode: string | undefined }[] = [];
    const batches = Array.from(
      { length: Math.ceil(shipmentsToSave.length / this.BATCH_SIZE) },
      (_, i) => shipmentsToSave.slice(i * this.BATCH_SIZE, (i + 1) * this.BATCH_SIZE)
    );
    this.logger.log(`📦 Procesando ${batches.length} lotes de ${this.BATCH_SIZE} envíos cada uno`);

    // Start transaction
    await this.shipmentRepository.manager.transaction(async (transactionalEntityManager) => {
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        this.logger.log(`📦 Iniciando lote ${i + 1}/${batches.length} con ${batch.length} envíos`);
        this.shipmentBatch = []; // Reset batch for each loop

        // Process shipments and collect valid ones
        await Promise.all(
          batch.map((shipment, index) =>
            this.processShipment(
              shipment,
              predefinedSubsidiary,
              consolidated,
              result,
              shipmentsWithError,
              i + 1,
              index + 1,
              processedTrackingNumbers,
              shipmentsToGenerateIncomes, 
              consolidated.id
            )
          )
        );

        // Save batch of shipments
        if (this.shipmentBatch.length) {
          try {
            const savedShipments = await transactionalEntityManager.save(Shipment, this.shipmentBatch, { chunk: 50 });
            this.logger.log(`💾 Guardados ${this.shipmentBatch.length} envíos en lote ${i + 1}`);
            this.logBuffer.push(`💾 Guardados ${this.shipmentBatch.length} envíos en lote ${i + 1}`);

            // Assign IDs to shipments for income generation
            this.shipmentBatch.forEach((shipment, idx) => {
              shipment.id = savedShipments[idx]?.id;
              if (!shipment.id) {
                const reason = `Error: No se asignó ID al envío ${shipment.trackingNumber} tras guardar lote ${i + 1}`;
                this.logger.error(`❌ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.saveError.push({ trackingNumber: shipment.trackingNumber, reason });
                result.failed++;
                result.saved--;
              }
            });

            // Generate incomes for eligible shipments
            for (const { shipment, timestamp, exceptionCode } of shipmentsToGenerateIncomes) {
              if (!shipment.id) {
                const reason = `Error: No se puede generar income para ${shipment.trackingNumber} porque falta shipment.id`;
                this.logger.error(`❌ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.saveError.push({ trackingNumber: shipment.trackingNumber, reason });
                result.failed++;
                result.saved--;
                continue;
              }
              try {
                await this.generateIncomes(shipment, timestamp, exceptionCode, transactionalEntityManager);
                this.logger.log(`✅ Income generado para ${shipment.trackingNumber}`);
              } catch (err) {
                const reason = `Error en generateIncomes para ${shipment.trackingNumber}: ${err.message}`;
                this.logger.error(`❌ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.saveError.push({ trackingNumber: shipment.trackingNumber, reason });
                result.failed++;
                result.saved--;
              }
            }

            this.shipmentBatch = [];
            shipmentsToGenerateIncomes.length = 0; // Clear incomes for next batch
          } catch (err) {
            const reason = `Error al guardar lote de envíos ${i + 1}: ${err.message}`;
            this.logger.error(`❌ ${reason}`);
            this.logBuffer.push(reason);
            shipmentsWithError.saveError.push({ trackingNumber: `LOTE_${i + 1}`, reason });
            result.failed += this.shipmentBatch.length;
            result.saved -= this.shipmentBatch.length;
            this.shipmentBatch = [];
            shipmentsToGenerateIncomes.length = 0;
          }
        }
        this.logger.log(`✅ Finalizado lote ${i + 1}/${batches.length}`);
      }
    });

    // Evitar Consolidated innecesario si todos son duplicados
    if (result.duplicated === shipmentsToSave.length) {
      await this.consolidatedService.remove(consolidated.id);
      this.logger.warn(`⚠️ Todos los envíos son duplicados. Consolidado ${consolidated.id} eliminado.`);
      this.logBuffer.push(`⚠️ Todos los envíos son duplicados. Consolidado ${consolidated.id} eliminado.`);
    } else {
      // Actualizar consolidado
      this.logger.log(`📊 Actualizando consolidado ${consolidated.id}`);
      consolidated.isCompleted = true;
      consolidated.efficiency = shipmentsToSave.length
        ? (result.saved / shipmentsToSave.length) * 100
        : 0;
      consolidated.commitDateTime = new Date();
      try {
        await this.consolidatedService.create(consolidated);
        this.logger.log(`📊 Consolidado ${consolidated.id} actualizado: efficiency ${consolidated.efficiency}%`);
        this.logBuffer.push(`📊 Consolidado ${consolidated.id} actualizado: efficiency ${consolidated.efficiency}%`);
      } catch (err) {
        const reason = `Error al actualizar consolidado ${consolidated.id}: ${err.message}`;
        this.logger.error(`❌ ${reason}`);
        this.logBuffer.push(reason);
      }
    }

    await this.flushLogBuffer();
    await this.logErrors(shipmentsWithError);

    const durationMin = ((Date.now() - startTime) / 60000).toFixed(2);
    this.logger.log(`⏱️ Tiempo total de procesamiento: ${durationMin} minutos`);
    this.logger.log(
      `✅ Proceso finalizado: ${result.saved} guardados, ${result.duplicated} duplicados, ${result.failed} fallidos`
    );

    return {
      ...result,
      errors: [
        ...shipmentsWithError.duplicated,
        ...shipmentsWithError.fedexError,
        ...shipmentsWithError.saveError,
      ],
    };
  }

  private async processFedexScanEventsToStatuses(
    scanEvents: FedExScanEventDto[],
    shipment: Shipment
  ): Promise<ShipmentStatus[]> {
    this.logger.log(`🔍 Iniciando processScanEventsToStatuses para ${shipment.trackingNumber} con ${scanEvents.length} eventos`);
    const { statuses, hasException, hasDelivered } = scanEvents
      .sort((a, b) => {
        const dateA = toZonedTime(parse(a.date, "yyyy-MM-dd'T'HH:mm:ssXXX", new Date()), 'UTC', { timeZone: 'America/Mexico_City' });
        const dateB = toZonedTime(parse(b.date, "yyyy-MM-dd'T'HH:mm:ssXXX", new Date()), 'UTC', { timeZone: 'America/Mexico_City' });
        return dateA.getTime() - dateB.getTime();
      })
      .reduce<{
        statuses: ShipmentStatus[];
        hasException: boolean;
        hasDelivered: boolean;
      }>(
        (acc, event, index) => {
          this.logger.log(`📌 Procesando evento ${index + 1}/${scanEvents.length} para ${shipment.trackingNumber}`);
          const mappedStatus = mapFedexStatusToLocalStatus(event.derivedStatusCode, event.exceptionCode);
          if (mappedStatus === ShipmentStatusType.DESCONOCIDO) {
            this.logger.warn(`⚠️ Estado desconocido para evento: ${event.derivedStatusCode}`);
            return acc;
          }

          const timestamp = toZonedTime(parse(event.date, "yyyy-MM-dd'T'HH:mm:ssXXX", new Date()), 'UTC', { timeZone: 'America/Mexico_City' });
          if (isNaN(timestamp.getTime())) {
            this.logger.warn(`⚠️ Fecha inválida para evento: ${event.date}`);
            return acc;
          }

          // 🔥 CORRECCIÓN: NO asignar la relación shipment aquí para evitar referencias circulares
          const statusEntry = Object.assign(new ShipmentStatus(), {
            // shipment, // ← NO asignar la relación aquí
            status: mappedStatus,
            exceptionCode: event.exceptionCode || undefined,
            notes: event.exceptionCode
              ? `${event.exceptionCode} - ${event.exceptionDescription}`
              : `${event.eventType} - ${event.eventDescription}`,
            timestamp,
          });

          acc.statuses.push(statusEntry);
          acc.hasException ||= mappedStatus === ShipmentStatusType.NO_ENTREGADO;
          acc.hasDelivered ||= mappedStatus === ShipmentStatusType.ENTREGADO;

          const logLine = `📝 [${shipment.trackingNumber}] Registrado status: ${statusEntry.status} - ${statusEntry.notes}`;
          this.logger.log(logLine);
          this.logBuffer.push(`${logLine} at ${statusEntry.timestamp.toISOString()}`);

          return acc;
        },
        { statuses: [], hasException: false, hasDelivered: false }
      );

    if (hasException && hasDelivered) {
      const msg = `📦 [${shipment.trackingNumber}] Excepciones previas pero entrega exitosa. Conservando todos los estados.`;
      this.logger.log(msg);
      this.logBuffer.push(msg);
      return statuses;
    }

    if (!hasDelivered && hasException) {
      const lastNoEntIndex = statuses.reduce(
        (last, s, i) => (s.status === ShipmentStatusType.NO_ENTREGADO ? i : last),
        -1
      );

      if (lastNoEntIndex >= 0 && lastNoEntIndex < statuses.length - 1) {
        // Separar los eventos posteriores al último NO_ENTREGADO
        const eventsAfterNoEnt = statuses.splice(lastNoEntIndex + 1);
        
        // Filtrar solo los eventos EN_RUTA que NO tienen exceptionCode 67
        const removed = eventsAfterNoEnt.filter(
          (s) => s.status === ShipmentStatusType.EN_RUTA && s.exceptionCode !== '67'
        );
        
        // Reincorporar los eventos que no deben ser eliminados
        const keptEvents = eventsAfterNoEnt.filter(
          (s) => s.status !== ShipmentStatusType.EN_RUTA || s.exceptionCode === '67'
        );
        
        statuses.push(...keptEvents);
        
        // Loggear los eventos conservados con exceptionCode 67
        keptEvents
          .filter(s => s.exceptionCode === '67')
          .forEach(s => {
            const info = `✅ [${shipment.trackingNumber}] Conservando EN_RUTA con exceptionCode 67: ${s.notes}`;
            this.logger.log(info);
            this.logBuffer.push(info);
          });
        
        // Loggear los eventos eliminados
        for (const rem of removed) {
          const warn = `🗑️ [${shipment.trackingNumber}] Eliminado EN_RUTA posterior a NO_ENTREGADO: ${rem.notes}`;
          this.logger.warn(warn);
          this.logBuffer.push(warn);
        }
      }
    }

    this.logger.log(`✅ Finalizado processScanEventsToStatuses para ${shipment.trackingNumber} con ${statuses.length} estados`);
    return statuses;
  }

 /*** TESTING ARCHIVOS HILLO !!*/
  async addConsMasterBySubsidiaryBuenoFuncional(
    file: Express.Multer.File,
    subsidiaryId: string,
    consNumber: string,
    consDate?: Date,
    isAereo?: boolean
  ): Promise<{
    saved: number;
    failed: number;
    duplicated: number;
    duplicatedTrackings: ParsedShipmentDto[];
    failedTrackings: { trackingNumber: string; reason: string }[];
    errors: { trackingNumber: string; reason: string }[];
  }> {
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

    this.logger.log(`🔍 Validando subsidiaria con ID: ${subsidiaryId}`);
    const predefinedSubsidiary = await this.subsidiaryService.findById(subsidiaryId);

    if (!predefinedSubsidiary) {
      const reason = `Subsidiaria con ID '${subsidiaryId}' no encontrada`;
      this.logger.error(`❌ ${reason}`);
      this.logBuffer.push(reason);
      throw new BadRequestException(reason);
    }

    this.logger.log(`📄 Leyendo archivo Excel: ${file.originalname}`);
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const shipmentsToSave = parseDynamicSheet(workbook, { fileName: file.originalname })
    
    this.logger.log(`📄 Total de envíos procesados desde archivo: ${shipmentsToSave.length}`);

    // Crear Consolidated
    this.logger.log(`📦 Creando consolidado para ${shipmentsToSave.length} envíos`);
    const consolidated = Object.assign(new Consolidated(), {
      date: consDate || new Date(),
      type: isAereo ? ConsolidatedType.AEREO : ConsolidatedType.ORDINARIA,
      numberOfPackages: shipmentsToSave.length,
      subsidiary: predefinedSubsidiary,
      subsidiaryId: predefinedSubsidiary.id,
      consNumber,
      isCompleted: false,
      efficiency: 0,
      commitDateTime: new Date(),
    });

    try {
      const savedConsolidated = await this.consolidatedService.create(consolidated);
      if (!savedConsolidated?.id) {
        const reason = `Error: Consolidated no retornó un ID válido tras guardar`;
        this.logger.error(`❌ ${reason}`);
        this.logBuffer.push(reason);
        throw new Error(reason);
      }
      consolidated.id = savedConsolidated.id;
      this.logger.log(`📦 Consolidado creado con ID: ${consolidated.id}`);
      this.logBuffer.push(`📦 Consolidado creado con ID: ${consolidated.id}`);
    } catch (err) {
      const reason = `Error al crear consolidado: ${err.message}`;
      this.logger.error(`❌ ${reason}`);
      this.logBuffer.push(reason);
      throw new BadRequestException(reason);
    }

    const result = {
      saved: 0,
      failed: 0,
      duplicated: 0,
      duplicatedTrackings: [] as ParsedShipmentDto[],
      failedTrackings: [] as { trackingNumber: string; reason: string }[],
    };

    const shipmentsWithError = {
      duplicated: [] as { trackingNumber: string; reason: string }[],
      fedexError: [] as { trackingNumber: string; reason: string }[],
      saveError: [] as { trackingNumber: string; reason: string }[],
    };

    const processedTrackingNumbers = new Set<string>();
    const shipmentsToGenerateIncomes: { shipment: Shipment; timestamp: Date; exceptionCode: string | undefined }[] = [];
    const batches = Array.from(
      { length: Math.ceil(shipmentsToSave.length / this.BATCH_SIZE) },
      (_, i) => shipmentsToSave.slice(i * this.BATCH_SIZE, (i + 1) * this.BATCH_SIZE)
    );
    this.logger.log(`📦 Procesando ${batches.length} lotes de ${this.BATCH_SIZE} envíos cada uno`);

    // Start transaction
    await this.shipmentRepository.manager.transaction(async (transactionalEntityManager) => {
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        this.logger.log(`📦 Iniciando lote ${i + 1}/${batches.length} con ${batch.length} envíos`);
        this.shipmentBatch = []; // Reset batch for each loop

        // Process shipments and collect valid ones
        await Promise.all(
          batch.map((shipment, index) =>
            this.processShipment(
              shipment,
              predefinedSubsidiary,
              consolidated,
              result,
              shipmentsWithError,
              i + 1,
              index + 1,
              processedTrackingNumbers,
              shipmentsToGenerateIncomes, 
              consolidated.id
            )
          )
        );

        // Save batch of shipments
        if (this.shipmentBatch.length) {
          try {
            this.logger.debug(`💾 Intentando guardar lote ${i + 1} con ${this.shipmentBatch.length} envíos`);
            
            // 🔥🔥🔥 PRE-LIMPIEZA COMPLETA: Extraer y limpiar todas las relaciones circulares
            const statusHistoryMap = new Map<string, ShipmentStatus[]>(); // trackingNumber -> statusHistory[]
            const paymentMap = new Map<string, Payment>(); // trackingNumber -> Payment
            
            this.shipmentBatch.forEach((shipment, index) => {
              this.logger.debug(`🔍 Preparando shipment ${index + 1}/${this.shipmentBatch.length}: ${shipment.trackingNumber}`);
              
              // 1. Extraer y limpiar statusHistory
              if (shipment.statusHistory && Array.isArray(shipment.statusHistory)) {
                this.logger.debug(`🔍 Extrayendo ${shipment.statusHistory.length} statusHistory entries para ${shipment.trackingNumber}`);
                
                // Guardar una copia limpia en el mapa
                const cleanStatusHistory = shipment.statusHistory.map(status => {
                  const cleanStatus = Object.assign(new ShipmentStatus(), {
                    status: status.status,
                    timestamp: status.timestamp,
                    exceptionCode: status.exceptionCode,
                    notes: status.notes,
                    // 🔥 NO incluir shipment o id - se asignarán después
                  });
                  return cleanStatus;
                });
                
                statusHistoryMap.set(shipment.trackingNumber, cleanStatusHistory);
                
                // Limpiar el array original temporalmente para evitar referencias circulares
                shipment.statusHistory.length = 0;
              }
              
              // 2. Extraer y limpiar Payment
              if (shipment.payment && typeof shipment.payment === 'object') {
                this.logger.debug(`🔍 Extrayendo payment para ${shipment.trackingNumber}`);
                
                // Guardar una copia limpia en el mapa
                const cleanPayment = Object.assign(new Payment(), {
                  amount: shipment.payment.amount,
                  type: shipment.payment.type,
                  status: shipment.payment.status,
                  // 🔥 NO incluir relaciones circulares
                });
                
                paymentMap.set(shipment.trackingNumber, cleanPayment);
                
                // Limpiar el payment original
                shipment.payment = undefined;
              }
              
              // 3. Limpiar otras relaciones para evitar ciclos
              if (shipment.subsidiary && typeof shipment.subsidiary === 'object') {
                shipment.subsidiary = { id: shipment.subsidiary.id } as Subsidiary;
              }
              
              // 4. Verificar que no queden referencias circulares
              try {
                JSON.stringify(shipment);
                this.logger.debug(`✅ Shipment ${shipment.trackingNumber} se serializa correctamente después de la limpieza`);
              } catch (jsonError) {
                this.logger.error(`❌ ERROR: Shipment ${shipment.trackingNumber} aún tiene referencias circulares: ${jsonError.message}`);
                // Forzar limpieza más agresiva
                shipment.statusHistory = [];
                shipment.payment = undefined;
                shipment.subsidiary = { id: predefinedSubsidiary.id } as Subsidiary;
              }
            });

            // 🔥 GUARDAR SHIPMENTS PRINCIPALES (sin relaciones circulares)
            this.logger.debug(`🔍 Guardando ${this.shipmentBatch.length} shipments principales`);
            const savedShipments = await transactionalEntityManager.save(Shipment, this.shipmentBatch, { chunk: 50 });
            this.logger.log(`💾 Guardados ${this.shipmentBatch.length} envíos en lote ${i + 1}`);
            this.logBuffer.push(`💾 Guardados ${this.shipmentBatch.length} envíos en lote ${i + 1}`);

            // Assign IDs to shipments
            this.shipmentBatch.forEach((shipment, idx) => {
              shipment.id = savedShipments[idx]?.id;
              if (!shipment.id) {
                const reason = `Error: No se asignó ID al envío ${shipment.trackingNumber} tras guardar lote ${i + 1}`;
                this.logger.error(`❌ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.saveError.push({ trackingNumber: shipment.trackingNumber, reason });
                result.failed++;
                result.saved--;
              } else {
                this.logger.debug(`✅ Shipment ${shipment.trackingNumber} guardado con ID: ${shipment.id}`);
              }
            });

            // 🔥 GUARDAR PAYMENTS CON LAS RELACIONES CORRECTAS
            const allPaymentsToSave: Payment[] = [];

            paymentMap.forEach((payment, trackingNumber) => {
              const correspondingShipment = savedShipments.find(s => s.trackingNumber === trackingNumber);
              if (correspondingShipment?.id) {
                // Asignar la relación correcta al payment
                payment.shipment = { id: correspondingShipment.id } as Shipment;
                allPaymentsToSave.push(payment);
                this.logger.debug(`🔍 Asignada relación de payment para ${trackingNumber}`);
              } else {
                this.logger.warn(`⚠️ No se encontró shipment para payment de ${trackingNumber}`);
              }
            });

            if (allPaymentsToSave.length > 0) {
              try {
                const savedPayments = await transactionalEntityManager.save(Payment, allPaymentsToSave, { chunk: 50 });
                this.logger.log(`💾 Guardados ${savedPayments.length} payments para lote ${i + 1}`);
                
                // 🔥 RESTAURAR PAYMENTS EN LOS OBJETOS SHIPMENT
                this.shipmentBatch.forEach(shipment => {
                  if (shipment.id) {
                    const shipmentPayment = allPaymentsToSave.find(
                      payment => payment.shipment?.id === shipment.id
                    );
                    if (shipmentPayment) {
                      shipment.payment = shipmentPayment;
                      this.logger.debug(`🔍 Restaurado payment para ${shipment.trackingNumber}`);
                    }
                  }
                });
              } catch (paymentError) {
                this.logger.error(`❌ Error guardando payments para lote ${i + 1}: ${paymentError.message}`);
              }
            }

            // 🔥 GUARDAR STATUS HISTORY CON LAS RELACIONES CORRECTAS
            const allStatusHistoryToSave: ShipmentStatus[] = [];

            statusHistoryMap.forEach((statusHistory, trackingNumber) => {
              const correspondingShipment = savedShipments.find(s => s.trackingNumber === trackingNumber);
              if (correspondingShipment?.id) {
                // Asignar la relación correcta a cada statusHistory
                statusHistory.forEach(status => {
                  status.shipment = { id: correspondingShipment.id } as Shipment;
                  allStatusHistoryToSave.push(status);
                });
                this.logger.debug(`🔍 Asignadas ${statusHistory.length} relaciones de statusHistory para ${trackingNumber}`);
              } else {
                this.logger.warn(`⚠️ No se encontró shipment para statusHistory de ${trackingNumber}`);
              }
            });

            if (allStatusHistoryToSave.length > 0) {
              try {
                const savedStatusHistory = await transactionalEntityManager.save(ShipmentStatus, allStatusHistoryToSave, { chunk: 50 });
                this.logger.log(`💾 Guardados ${savedStatusHistory.length} statusHistory entries para lote ${i + 1}`);
                
                // 🔥 RESTAURAR STATUS HISTORY EN LOS OBJETOS SHIPMENT
                this.shipmentBatch.forEach(shipment => {
                  if (shipment.id) {
                    const shipmentStatusHistory = allStatusHistoryToSave.filter(
                      status => status.shipment?.id === shipment.id
                    );
                    if (shipmentStatusHistory.length > 0) {
                      shipment.statusHistory = shipmentStatusHistory;
                      this.logger.debug(`🔍 Restaurados ${shipmentStatusHistory.length} statusHistory entries para ${shipment.trackingNumber}`);
                    }
                  }
                });
              } catch (statusError) {
                this.logger.error(`❌ Error guardando statusHistory para lote ${i + 1}: ${statusError.message}`);
              }
            }

            // 🔥 GENERAR INCOMES (ahora los shipments tienen todas las relaciones correctas)
            this.logger.debug(`🔍 Generando incomes para ${shipmentsToGenerateIncomes.length} shipments`);
            const incomesToProcess = [...shipmentsToGenerateIncomes];
            
            for (const { shipment, timestamp, exceptionCode } of incomesToProcess) {
              if (!shipment.id) {
                const reason = `Error: No se puede generar income para ${shipment.trackingNumber} porque falta shipment.id`;
                this.logger.error(`❌ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.saveError.push({ trackingNumber: shipment.trackingNumber, reason });
                result.failed++;
                result.saved--;
                continue;
              }
              try {
                this.logger.debug(`💰 Generando income para shipment ${shipment.trackingNumber} (ID: ${shipment.id})`);
                await this.generateIncomes(shipment, timestamp, exceptionCode, transactionalEntityManager);
                this.logger.log(`✅ Income generado para ${shipment.trackingNumber}`);
                
                // Remover de la lista una vez procesado
                const index = shipmentsToGenerateIncomes.findIndex(item => item.shipment.trackingNumber === shipment.trackingNumber);
                if (index !== -1) {
                  shipmentsToGenerateIncomes.splice(index, 1);
                }
              } catch (err) {
                const reason = `Error en generateIncomes para ${shipment.trackingNumber}: ${err.message}`;
                this.logger.error(`❌ ${reason}`);
                this.logBuffer.push(reason);
                shipmentsWithError.saveError.push({ trackingNumber: shipment.trackingNumber, reason });
                result.failed++;
                result.saved--;
              }
            }

            this.shipmentBatch = [];
            this.logger.debug(`🔍 Lote ${i + 1}: Limpiados arrays temporales`);
            
          } catch (err) {
            const reason = `Error al guardar lote de envíos ${i + 1}: ${err.message}`;
            this.logger.error(`❌ ${reason}`);
            this.logBuffer.push(reason);
            
            // DEBUG DETALLADO del error
            this.logger.error(`🔍 DEBUG Error en lote ${i + 1}:`, {
              message: err.message,
              stack: err.stack,
              batchSize: this.shipmentBatch.length,
              firstTracking: this.shipmentBatch[0]?.trackingNumber,
              errorDetails: JSON.stringify(err, Object.getOwnPropertyNames(err))
            });

            // Verificar si es el error de dependencia cíclica
            if (err.message.includes('Cyclic dependency') || err.message.includes('circular reference') || err.message.includes('cyclic')) {
              this.logger.error(`🔄 ERROR DE DEPENDENCIA CÍCLICA DETECTADO EN LOTE ${i + 1}`);
              
              // Analizar las relaciones del primer shipment para debug
              if (this.shipmentBatch.length > 0) {
                const problemShipment = this.shipmentBatch[0];
                this.logger.error(`🔍 Analizando shipment problemático: ${problemShipment.trackingNumber}`, {
                  shipment: {
                    trackingNumber: problemShipment.trackingNumber,
                    consolidatedId: problemShipment.consolidatedId,
                    subsidiary: problemShipment.subsidiary ? {
                      id: problemShipment.subsidiary.id,
                      name: problemShipment.subsidiary.name,
                    } : 'null',
                    statusHistoryCount: problemShipment.statusHistory?.length || 0,
                    hasPayment: !!problemShipment.payment
                  }
                });

                // Intentar detectar ciclos manualmente
                this.detectCircularReferences(problemShipment);
              }
            }

            shipmentsWithError.saveError.push({ trackingNumber: `LOTE_${i + 1}`, reason });
            result.failed += this.shipmentBatch.length;
            // No restamos de saved porque estos shipments nunca se contaron como guardados
            this.shipmentBatch = [];
          }
        }
        this.logger.log(`✅ Finalizado lote ${i + 1}/${batches.length}`);
      }
    });

    // Evitar Consolidated innecesario si todos son duplicados
    if (result.duplicated === shipmentsToSave.length) {
      await this.consolidatedService.remove(consolidated.id);
      this.logger.warn(`⚠️ Todos los envíos son duplicados. Consolidado ${consolidated.id} eliminado.`);
      this.logBuffer.push(`⚠️ Todos los envíos son duplicados. Consolidado ${consolidated.id} eliminado.`);
    } else {
      // Actualizar consolidado
      this.logger.log(`📊 Actualizando consolidado ${consolidated.id}`);
      consolidated.isCompleted = true;
      consolidated.efficiency = shipmentsToSave.length
        ? (result.saved / shipmentsToSave.length) * 100
        : 0;
      consolidated.commitDateTime = new Date();
      try {
        await this.consolidatedService.create(consolidated);
        this.logger.log(`📊 Consolidado ${consolidated.id} actualizado: efficiency ${consolidated.efficiency}%`);
        this.logBuffer.push(`📊 Consolidado ${consolidated.id} actualizado: efficiency ${consolidated.efficiency}%`);
      } catch (err) {
        const reason = `Error al actualizar consolidado ${consolidated.id}: ${err.message}`;
        this.logger.error(`❌ ${reason}`);
        this.logBuffer.push(reason);
      }
    }

    await this.flushLogBuffer();
    await this.logErrors(shipmentsWithError);

    const durationMin = ((Date.now() - startTime) / 60000).toFixed(2);
    this.logger.log(`⏱️ Tiempo total de procesamiento: ${durationMin} minutos`);
    this.logger.log(
      `✅ Proceso finalizado: ${result.saved} guardados, ${result.duplicated} duplicados, ${result.failed} fallidos`
    );

    return {
      ...result,
      errors: [
        ...shipmentsWithError.duplicated,
        ...shipmentsWithError.fedexError,
        ...shipmentsWithError.saveError,
      ],
    };
  }

  async addConsMasterBySubsidiary(
    file: Express.Multer.File,
    subsidiaryId: string,
    consNumber: string,
    consDate?: Date,
    isAereo?: boolean
  ): Promise<{
    saved: number;
    failed: number;
    duplicated: number;
    duplicatedTrackings: ParsedShipmentDto[];
    failedTrackings: { trackingNumber: string; reason: string }[];
    errors: { trackingNumber: string; reason: string }[];
  }> {
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

    this.logger.log(`🔍 Validando subsidiaria con ID: ${subsidiaryId}`);
    const predefinedSubsidiary = await this.subsidiaryService.findById(subsidiaryId);

    if (!predefinedSubsidiary) {
      const reason = `Subsidiaria con ID '${subsidiaryId}' no encontrada`;
      this.logger.error(`❌ ${reason}`);
      this.logBuffer.push(reason);
      throw new BadRequestException(reason);
    }

    this.logger.log(`📄 Leyendo archivo Excel: ${file.originalname}`);
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const shipmentsToSave = parseDynamicSheet(workbook, { fileName: file.originalname })
    
    this.logger.log(`📄 Total de envíos procesados desde archivo: ${shipmentsToSave.length}`);

    // Crear Consolidated
    this.logger.log(`📦 Creando consolidado para ${shipmentsToSave.length} envíos`);
    const consolidated = Object.assign(new Consolidated(), {
      date: consDate || new Date(),
      type: isAereo ? ConsolidatedType.AEREO : ConsolidatedType.ORDINARIA,
      numberOfPackages: shipmentsToSave.length,
      subsidiary: predefinedSubsidiary,
      subsidiaryId: predefinedSubsidiary.id,
      consNumber,
      isCompleted: false,
      efficiency: 0,
      commitDateTime: new Date(),
    });

    try {
      const savedConsolidated = await this.consolidatedService.create(consolidated);
      if (!savedConsolidated?.id) {
        const reason = `Error: Consolidated no retornó un ID válido tras guardar`;
        this.logger.error(`❌ ${reason}`);
        this.logBuffer.push(reason);
        throw new Error(reason);
      }
      consolidated.id = savedConsolidated.id;
      this.logger.log(`📦 Consolidado creado con ID: ${consolidated.id}`);
      this.logBuffer.push(`📦 Consolidado creado con ID: ${consolidated.id}`);
    } catch (err) {
      const reason = `Error al crear consolidado: ${err.message}`;
      this.logger.error(`❌ ${reason}`);
      this.logBuffer.push(reason);
      throw new BadRequestException(reason);
    }

    const result = {
      saved: 0,
      failed: 0,
      duplicated: 0,
      duplicatedTrackings: [] as ParsedShipmentDto[],
      failedTrackings: [] as { trackingNumber: string; reason: string }[],
    };

    const shipmentsWithError = {
      duplicated: [] as { trackingNumber: string; reason: string }[],
      fedexError: [] as { trackingNumber: string; reason: string }[],
      saveError: [] as { trackingNumber: string; reason: string }[],
    };

    const processedTrackingNumbers = new Set<string>();
    const shipmentsToGenerateIncomes: { shipment: Shipment; timestamp: Date; exceptionCode: string | undefined }[] = [];
    const batches = Array.from(
      { length: Math.ceil(shipmentsToSave.length / this.BATCH_SIZE) },
      (_, i) => shipmentsToSave.slice(i * this.BATCH_SIZE, (i + 1) * this.BATCH_SIZE)
    );
    this.logger.log(`📦 Procesando ${batches.length} lotes de ${this.BATCH_SIZE} envíos cada uno`);

    // Start transaction
    await this.shipmentRepository.manager.transaction(async (transactionalEntityManager) => {
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        this.logger.log(`📦 Iniciando lote ${i + 1}/${batches.length} con ${batch.length} envíos`);
        this.shipmentBatch = []; // Reset batch for each loop

        // Process shipments and collect valid ones
        await Promise.all(
          batch.map((shipment, index) =>
            this.processShipment(
              shipment,
              predefinedSubsidiary,
              consolidated,
              result,
              shipmentsWithError,
              i + 1,
              index + 1,
              processedTrackingNumbers,
              shipmentsToGenerateIncomes, 
              consolidated.id
            )
          )
        );

        // Save batch of shipments
        if (this.shipmentBatch.length) {
          try {
            this.logger.debug(`💾 Intentando guardar lote ${i + 1} con ${this.shipmentBatch.length} envíos`);
            
            // PRE-LIMPIEZA: Extraer y limpiar todas las relaciones circulares
            const statusHistoryMap = new Map<string, ShipmentStatus[]>(); 
            const paymentMap = new Map<string, Payment>(); 
            
            this.shipmentBatch.forEach((shipment, index) => {
              this.logger.debug(`🔍 Preparando shipment ${index + 1}/${this.shipmentBatch.length}: ${shipment.trackingNumber} (Status: ${shipment.status})`);
              
              // 1. Extraer y limpiar statusHistory
              if (shipment.statusHistory && Array.isArray(shipment.statusHistory)) {
                this.logger.debug(`🔍 Extrayendo ${shipment.statusHistory.length} statusHistory entries para ${shipment.trackingNumber}`);
                
                const cleanStatusHistory = shipment.statusHistory.map(status => {
                  const cleanStatus = Object.assign(new ShipmentStatus(), {
                    status: status.status,
                    timestamp: status.timestamp,
                    exceptionCode: status.exceptionCode,
                    notes: status.notes,
                  });
                  return cleanStatus;
                });
                
                statusHistoryMap.set(shipment.trackingNumber, cleanStatusHistory);
                shipment.statusHistory.length = 0;
              }
              
              // 2. Extraer y limpiar Payment
              if (shipment.payment && typeof shipment.payment === 'object') {
                this.logger.debug(`🔍 Extrayendo payment para ${shipment.trackingNumber}: $${shipment.payment.amount} - ${shipment.payment.status}`);
                
                const cleanPayment = Object.assign(new Payment(), {
                  amount: shipment.payment.amount,
                  type: shipment.payment.type,
                  status: shipment.payment.status,
                });
                
                paymentMap.set(shipment.trackingNumber, cleanPayment);
                shipment.payment = undefined;
              }
              
              // 3. Limpiar otras relaciones para evitar ciclos
              if (shipment.subsidiary && typeof shipment.subsidiary === 'object') {
                shipment.subsidiary = { id: shipment.subsidiary.id } as Subsidiary;
              }
            });

            // GUARDAR SHIPMENTS PRINCIPALES
            this.logger.debug(`🔍 Guardando ${this.shipmentBatch.length} shipments principales`);
            const savedShipments = await transactionalEntityManager.save(Shipment, this.shipmentBatch, { chunk: 50 });
            this.logger.log(`💾 Guardados ${this.shipmentBatch.length} envíos en lote ${i + 1}`);

            // Assign IDs to shipments y registrar SOLO fallidos reales
            const failedShipmentsInBatch: { trackingNumber: string; reason: string }[] = [];
            
            this.shipmentBatch.forEach((shipment, idx) => {
              shipment.id = savedShipments[idx]?.id;
              if (!shipment.id) {
                const reason = `Error: No se asignó ID al envío ${shipment.trackingNumber} tras guardar`;
                this.logger.error(`❌ ${reason}`);
                failedShipmentsInBatch.push({ trackingNumber: shipment.trackingNumber, reason });
                shipmentsWithError.saveError.push({ trackingNumber: shipment.trackingNumber, reason });
                result.failed++;
                result.saved--;
              } else {
                this.logger.debug(`✅ Shipment ${shipment.trackingNumber} guardado con ID: ${shipment.id} (Status: ${shipment.status})`);
              }
            });

            // REGISTRAR FALLIDOS DEL BATCH (solo errores reales de guardado)
            if (failedShipmentsInBatch.length > 0) {
              this.logger.error(`❌ ${failedShipmentsInBatch.length} envíos fallaron en el GUARDADO:`);
              failedShipmentsInBatch.forEach(failed => {
                this.logger.error(`   - ${failed.trackingNumber}: ${failed.reason}`);
                result.failedTrackings.push(failed);
              });
            }

            // GUARDAR PAYMENTS
            const allPaymentsToSave: Payment[] = [];

            paymentMap.forEach((payment, trackingNumber) => {
              const correspondingShipment = savedShipments.find(s => s.trackingNumber === trackingNumber && s.id);
              if (correspondingShipment?.id) {
                payment.shipment = { id: correspondingShipment.id } as Shipment;
                allPaymentsToSave.push(payment);
              }
            });

            if (allPaymentsToSave.length > 0) {
              try {
                await transactionalEntityManager.save(Payment, allPaymentsToSave, { chunk: 50 });
                this.logger.log(`💾 Guardados ${allPaymentsToSave.length} payments`);
                
                // RESTAURAR PAYMENTS
                this.shipmentBatch.forEach(shipment => {
                  if (shipment.id) {
                    const shipmentPayment = allPaymentsToSave.find(
                      payment => payment.shipment?.id === shipment.id
                    );
                    if (shipmentPayment) {
                      shipment.payment = shipmentPayment;
                    }
                  }
                });
              } catch (paymentError) {
                this.logger.error(`❌ Error guardando payments: ${paymentError.message}`);
              }
            }

            // GUARDAR STATUS HISTORY
            const allStatusHistoryToSave: ShipmentStatus[] = [];

            statusHistoryMap.forEach((statusHistory, trackingNumber) => {
              const correspondingShipment = savedShipments.find(s => s.trackingNumber === trackingNumber && s.id);
              if (correspondingShipment?.id) {
                statusHistory.forEach(status => {
                  status.shipment = { id: correspondingShipment.id } as Shipment;
                  allStatusHistoryToSave.push(status);
                });
              }
            });

            if (allStatusHistoryToSave.length > 0) {
              try {
                await transactionalEntityManager.save(ShipmentStatus, allStatusHistoryToSave, { chunk: 50 });
                this.logger.log(`💾 Guardados ${allStatusHistoryToSave.length} statusHistory entries`);
                
                // RESTAURAR STATUS HISTORY
                this.shipmentBatch.forEach(shipment => {
                  if (shipment.id) {
                    const shipmentStatusHistory = allStatusHistoryToSave.filter(
                      status => status.shipment?.id === shipment.id
                    );
                    if (shipmentStatusHistory.length > 0) {
                      shipment.statusHistory = shipmentStatusHistory;
                    }
                  }
                });
              } catch (statusError) {
                this.logger.error(`❌ Error guardando statusHistory: ${statusError.message}`);
              }
            }

            // 🔥 CORRECCIÓN: GENERAR INCOMES - NO contar como fallidos los "no_entregados"
            this.logger.debug(`🔍 Procesando incomes para ${shipmentsToGenerateIncomes.length} shipments`);
            const incomesToProcess = [...shipmentsToGenerateIncomes];
            const skippedIncomes: { trackingNumber: string; reason: string }[] = [];
            
            for (const { shipment, timestamp, exceptionCode } of incomesToProcess) {
              if (!shipment.id) {
                // Este ya se contó como fallido anteriormente, solo registrar
                const reason = `No se puede generar income - shipment no guardado: ${shipment.trackingNumber}`;
                this.logger.warn(`⚠️ ${reason}`);
                continue;
              }

              try {
                this.logger.debug(`💰 Generando income para ${shipment.trackingNumber} (Status: ${shipment.status})`);
                await this.generateIncomes(shipment, timestamp, exceptionCode, transactionalEntityManager);
                this.logger.log(`✅ Income generado para ${shipment.trackingNumber}`);
                
                // Remover de la lista
                const index = shipmentsToGenerateIncomes.findIndex(item => item.shipment.trackingNumber === shipment.trackingNumber);
                if (index !== -1) {
                  shipmentsToGenerateIncomes.splice(index, 1);
                }
              } catch (err) {
                // 🔥 CORRECCIÓN IMPORTANTE: NO contar como fallido, solo registrar como skipped
                const reason = `No se generó income para ${shipment.trackingNumber}: ${err.message}`;
                this.logger.warn(`⚠️ ${reason}`);
                skippedIncomes.push({ trackingNumber: shipment.trackingNumber, reason });
                shipmentsWithError.saveError.push({ trackingNumber: shipment.trackingNumber, reason });
                // 🔥 NO incrementar result.failed aquí - el shipment SÍ se guardó exitosamente
              }
            }

            // REGISTRAR INCOMES SKIPPEADOS (no fallidos)
            if (skippedIncomes.length > 0) {
              this.logger.warn(`⚠️ ${skippedIncomes.length} incomes no se generaron (pero shipments se guardaron):`);
              skippedIncomes.forEach(skipped => {
                this.logger.warn(`   - ${skipped.trackingNumber}: ${skipped.reason}`);
              });
            }

            this.shipmentBatch = [];
            
          } catch (err) {
            const reason = `Error al guardar lote de envíos ${i + 1}: ${err.message}`;
            this.logger.error(`❌ ${reason}`);
            
            // REGISTRAR TODOS LOS SHIPMENTS DEL BATCH COMO FALLIDOS (solo en error crítico)
            this.shipmentBatch.forEach(shipment => {
              const failedReason = `Error crítico en lote: ${err.message}`;
              shipmentsWithError.saveError.push({ trackingNumber: shipment.trackingNumber, reason: failedReason });
              result.failedTrackings.push({ trackingNumber: shipment.trackingNumber, reason: failedReason });
              result.failed++;
              result.saved--;
            });

            this.logger.error(`❌ ERROR CRÍTICO: ${this.shipmentBatch.length} envíos fallaron:`);
            this.shipmentBatch.forEach(shipment => {
              this.logger.error(`   - ${shipment.trackingNumber}`);
            });

            this.shipmentBatch = [];
          }
        }
        this.logger.log(`✅ Finalizado lote ${i + 1}/${batches.length}`);
      }
    });

    // 🔥 CORRECCIÓN: CALCULAR ESTADÍSTICAS FINALES CORRECTAS
    const totalProcessed = shipmentsToSave.length;
    const totalSaved = result.saved;
    const totalDuplicated = result.duplicated;
    const totalFailed = result.failed; // Solo errores reales de guardado
    
    // Identificar shipments con status "no_entregado" que fueron guardados exitosamente
    const savedButNotDelivered = totalSaved - result.failedTrackings.length;

    // 🔥 RESUMEN FINAL CORREGIDO
    this.logger.log(`📊 RESUMEN FINAL CORREGIDO:`);
    this.logger.log(`   📄 Total procesado desde archivo: ${totalProcessed}`);
    this.logger.log(`   ✅ Guardados exitosos: ${totalSaved} (incluyendo ${savedButNotDelivered} con status NO_ENTREGADO)`);
    this.logger.log(`   🔁 Duplicados: ${totalDuplicated}`);
    this.logger.log(`   ❌ Fallidos por ERROR: ${totalFailed}`);
    
    if (result.failedTrackings.length > 0) {
      this.logger.log(`   📋 ENVÍOS FALLIDOS POR ERROR (${result.failedTrackings.length}):`);
      result.failedTrackings.forEach((failed, index) => {
        this.logger.log(`      ${index + 1}. ${failed.trackingNumber}: ${failed.reason}`);
      });
    } else {
      this.logger.log(`   🎉 No hay envíos fallidos por error`);
    }

    if (result.duplicatedTrackings.length > 0) {
      this.logger.log(`   🔁 ENVÍOS DUPLICADOS (${result.duplicatedTrackings.length}):`);
      result.duplicatedTrackings.forEach((dup, index) => {
        this.logger.log(`      ${index + 1}. ${dup.trackingNumber}`);
      });
    }

    // Evitar Consolidated innecesario si todos son duplicados
    if (result.duplicated === shipmentsToSave.length) {
      await this.consolidatedService.remove(consolidated.id);
      this.logger.warn(`⚠️ Todos los envíos son duplicados. Consolidado ${consolidated.id} eliminado.`);
    } else {
      // Actualizar consolidado
      this.logger.log(`📊 Actualizando consolidado ${consolidated.id}`);
      consolidated.isCompleted = true;
      consolidated.efficiency = shipmentsToSave.length
        ? (totalSaved / shipmentsToSave.length) * 100
        : 0;
      consolidated.commitDateTime = new Date();
      try {
        await this.consolidatedService.create(consolidated);
        this.logger.log(`📊 Consolidado ${consolidated.id} actualizado: efficiency ${consolidated.efficiency.toFixed(2)}%`);
      } catch (err) {
        this.logger.error(`❌ Error al actualizar consolidado: ${err.message}`);
      }
    }

    await this.flushLogBuffer();
    await this.logErrors(shipmentsWithError);

    const durationMin = ((Date.now() - startTime) / 60000).toFixed(2);
    this.logger.log(`⏱️ Tiempo total de procesamiento: ${durationMin} minutos`);
    this.logger.log(
      `✅ Proceso finalizado: ${totalSaved} guardados, ${totalDuplicated} duplicados, ${totalFailed} fallidos`
    );

    return {
      saved: totalSaved,
      failed: totalFailed,
      duplicated: totalDuplicated,
      duplicatedTrackings: result.duplicatedTrackings,
      failedTrackings: result.failedTrackings, // Solo errores reales de guardado
      errors: [
        ...shipmentsWithError.duplicated,
        ...shipmentsWithError.fedexError,
        ...shipmentsWithError.saveError,
      ],
    };
  }

  // Métodos auxiliares para detectar referencias circulares
  private detectCircularReferences(shipment: Shipment) {
    try {
      this.logger.debug(`🔍 Intentando serializar shipment ${shipment.trackingNumber}`);
      JSON.stringify(shipment);
      this.logger.debug(`✅ Shipment ${shipment.trackingNumber} se serializa correctamente`);
    } catch (jsonError) {
      this.logger.error(`🔍 Error al serializar shipment: ${jsonError.message}`);
      this.analyzeProblematicProperties(shipment);
    }
  }

  private analyzeProblematicProperties(obj: any, path = 'root', visited = new Set()) {
    if (visited.has(obj)) {
      this.logger.error(`🔄 Referencia circular detectada en: ${path}`);
      return;
    }
    visited.add(obj);

    if (obj && typeof obj === 'object') {
      for (const key in obj) {
        if (obj[key] && typeof obj[key] === 'object') {
          this.analyzeProblematicProperties(obj[key], `${path}.${key}`, new Set(visited));
        }
      }
    }
  }

 /*** */ 

  /** por si algo falta con la solución circular a shipment en Hillo / Hillo Ext */
  private async processShipmentResp(
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
    const trackingNumber = shipment.trackingNumber;
    this.logger.log(`📦 Procesando envío ${shipmentIndex}/${this.BATCH_SIZE} del lote ${batchNumber}: ${trackingNumber}`);
    this.logger.log(`📅 commitDate desde archivo: ${shipment.commitDate}, commitTime desde archivo: ${shipment.commitTime}`);

    if (!consolidated.id) {
      const reason = `Error: consolidated.id no está definido para ${trackingNumber}`;
      this.logger.error(`❌ ${reason}`);
      result.failed++;
      result.failedTrackings.push({ trackingNumber, reason });
      shipmentsWithError.saveError.push({ trackingNumber, reason });
      this.logBuffer.push(reason);
      return;
    }

    // Check in-memory duplicates
    if (processedTrackingNumbers.has(trackingNumber)) {
      const reason = `Envío duplicado en el lote actual: ${trackingNumber}`;
      this.logger.warn(`🔁 ${reason}`);
      result.duplicated++;
      result.duplicatedTrackings.push(shipment);
      shipmentsWithError.duplicated.push({ trackingNumber, reason });
      this.logBuffer.push(reason);
      return;
    }

    // Check database duplicates
    if (await this.existShipment(trackingNumber, consolidatedId)) {
      const reason = `Envío duplicado en la base de datos: ${trackingNumber}`;
      this.logger.warn(`🔁 ${reason}`);
      result.duplicated++;
      result.duplicatedTrackings.push(shipment);
      shipmentsWithError.duplicated.push({ trackingNumber, reason });
      this.logBuffer.push(reason);
      return;
    }

    processedTrackingNumbers.add(trackingNumber);

    // Validate and format commitDate and commitTime from Excel
    let commitDate: string | undefined;
    let commitTime: string | undefined;
    let commitDateTime: Date | undefined;
    let dateSource = '';

    //Formatear a utc los commit que vienen normal
    if (shipment.commitDate && shipment.commitTime) {
      try {
        const timeZone = 'America/Hermosillo';
        const parsedDate = parse(shipment.commitDate, 'yyyy-MM-dd', new Date());
        const parsedTime = parse(shipment.commitTime, 'HH:mm:ss', new Date());

        if (!isNaN(parsedDate.getTime()) && !isNaN(parsedTime.getTime())) {
          commitDate = format(parsedDate, 'yyyy-MM-dd');
          commitTime = format(parsedTime, 'HH:mm:ss');

          // Fecha local como string
          const localDateTime = `${commitDate}T${commitTime}`;

          // ⬇️ Aquí está el truco: usar toDate con timeZone
          // Esto interpreta localDateTime como si fuera Hermosillo y devuelve UTC
          commitDateTime = toDate(localDateTime, { timeZone });

          dateSource = 'Excel';
          this.logger.log(
            `📅 commitDateTime (UTC) asignado desde Excel para ${trackingNumber}: ${commitDateTime.toISOString()} (commitDate=${commitDate}, commitTime=${commitTime}, TZ=${timeZone})`,
          );
        } else {
          this.logger.log(
            `⚠️ Formato inválido en Excel para ${trackingNumber}: commitDate=${shipment.commitDate}, commitTime=${shipment.commitTime}`,
          );
        }
      } catch (err) {
        this.logger.log(
          `⚠️ Error al parsear datos de Excel para ${trackingNumber}: ${err.message}`,
        );
      }
    }

    const newShipment = Object.assign(new Shipment(), {
      trackingNumber,
      shipmentType: ShipmentType.FEDEX,
      recipientName: shipment.recipientName || '',
      recipientAddress: shipment.recipientAddress || '',
      recipientCity: shipment.recipientCity || predefinedSubsidiary.name,
      recipientZip: shipment.recipientZip || '',
      commitDate: commitDate || undefined,
      commitTime: commitTime || undefined,
      commitDateTime: commitDateTime || undefined,
      recipientPhone: shipment.recipientPhone || '',
      status: ShipmentStatusType.PENDIENTE,
      priority: Priority.BAJA,
      consNumber: consolidated.consNumber || '',
      receivedByName: '',
      subsidiary: predefinedSubsidiary,
      subsidiaryId: predefinedSubsidiary.id,
      consolidatedId: consolidated.id,
    });

    let fedexShipmentData: FedExTrackingResponseDto;

    try {
      this.logger.log(`📬 Consultando FedEx para ${trackingNumber}`);
      fedexShipmentData = await this.trackPackageWithRetry(trackingNumber);
      this.logger.log(`📬 Datos FedEx recibidos para: ${trackingNumber}`);
    } catch (err) {
      const reason = `Error FedEx (${trackingNumber}): ${err.message}`;
      this.logger.error(`❌ ${reason}`);
      result.failed++;
      result.failedTrackings.push({ trackingNumber, reason });
      shipmentsWithError.fedexError.push({ trackingNumber, reason });
      this.logBuffer.push(reason);
      return;
    }

    try {
      const trackResults = fedexShipmentData.output.completeTrackResults[0].trackResults;
      const histories = await this.processFedexScanEventsToStatuses(
        trackResults.flatMap((result) => result.scanEvents || []),
        newShipment
      );
      const trackResult = trackResults.find((r) => r.latestStatusDetail?.derivedCode === 'DL') || trackResults.sort((a, b) => {
        const dateA = a.scanEvents[0]?.date ? new Date(a.scanEvents[0].date).getTime() : 0;
        const dateB = b.scanEvents[0]?.date ? new Date(b.scanEvents[0].date).getTime() : 0;
        return dateB - dateA;
      })[0];
      this.logger.log(
        `📜 Historial generado para ${trackingNumber}: ${histories.map((h) => h.status).join(', ')}`
      );

      // Set commitDateTime from FedEx if Excel date is invalid
      if (!commitDateTime) {
        const rawDate = trackResult?.standardTransitTimeWindow?.window?.ends;
        console.log("🚀 ~ ShipmentsService ~ processShipment ~ rawDate:", rawDate)
        if (rawDate) {
          try {
            const parsedFedexDate = parse(rawDate, "yyyy-MM-dd'T'HH:mm:ssXXX", new Date());
            if (!isNaN(parsedFedexDate.getTime())) {
              commitDate = format(parsedFedexDate, 'yyyy-MM-dd');
              commitTime = format(parsedFedexDate, 'HH:mm:ss');
              commitDateTime = parsedFedexDate;
              dateSource = 'FedEx';
              this.logger.log(`📅 commitDateTime asignado desde FedEx para ${trackingNumber}: ${commitDateTime.toISOString()} (commitDate=${commitDate}, commitTime=${commitTime})`);
            } else {
              this.logger.log(`⚠️ Formato de fecha inválido en FedEx para ${trackingNumber}: ${rawDate}`);
            }
          } catch (err) {
            this.logger.log(`⚠️ Error al parsear fecha de FedEx para ${trackingNumber}: ${err.message}`);
          }
        }
      }

      // Use default date as last resort
      if (!commitDateTime) {
        // Crear directamente la fecha UTC equivalente a 18:00 UTC-7
        const now = new Date();
        const utcDate = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          18 + 7, // 18:00 UTC-7 = 01:00 UTC (día siguiente)
          0,
          0
        ));
        
        commitDateTime = utcDate;
        dateSource = 'Default';
        this.logger.log(`⚠️ commitDateTime asignado por defecto: ${commitDateTime.toISOString()}`);
      }
      // Update shipment with final date values
      newShipment.commitDate = commitDate;
      newShipment.commitTime = commitTime;
      newShipment.commitDateTime = commitDateTime;
      newShipment.priority = getPriority(commitDateTime);

      this.logger.log(`📅 Fecha final asignada para ${trackingNumber} desde ${dateSource}: commitDateTime=${commitDateTime.toISOString()}`);

      Object.assign(newShipment, {
        statusHistory: histories,
        status: histories[histories.length - 1]?.status || ShipmentStatusType.PENDIENTE,
        receivedByName: trackResult?.deliveryDetails?.receivedByName || '',
        shipmentType: ShipmentType.FEDEX,
      });

      if (shipment.payment) {
        const typeMatch =  shipment.payment.match(/^(COD|FTC|ROD)/);
        const amountMatch =  shipment.payment.match(/([0-9]+(?:\.[0-9]+)?)/);

        if (amountMatch) {
          const paymentType = typeMatch ? typeMatch[1] as PaymentTypeEnum : null;
          const paymentAmount = amountMatch ? parseFloat(amountMatch[1]) : null;
                         
          if (!isNaN(paymentAmount) && paymentAmount > 0) {
            newShipment.payment = Object.assign(new Payment(), {
              amount: paymentAmount,
              type: paymentType,
              status: histories.some((h) => h.status === ShipmentStatusType.ENTREGADO)
                ? PaymentStatus.PAID
                : PaymentStatus.PENDING,
            });
            this.logger.log(
              `💰 Monto de pago: $${paymentAmount} - Estatus: ${newShipment.payment.status}`
            );
          }
        }
      }

      // Add to batch for saving later
      this.shipmentBatch.push(newShipment);
      result.saved++;

      // Validación para income con reglas extendidas
      if ([ShipmentStatusType.ENTREGADO, ShipmentStatusType.NO_ENTREGADO].includes(newShipment.status)) {
        const matchedHistory = histories
          .filter((h) => h.status === newShipment.status)
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
        const exceptionCodes = histories.map((h) => h.exceptionCode).filter(Boolean);

        const validationResult = await this.applyIncomeValidationRules(
          newShipment,
          newShipment.status,
          exceptionCodes,
          histories,
          trackingNumber,
          matchedHistory?.timestamp || new Date()
        );

        if (validationResult.isValid && matchedHistory) {
          shipmentsToGenerateIncomes.push({
            shipment: newShipment,
            timestamp: validationResult.timestamp,
            exceptionCode: matchedHistory.exceptionCode,
          });
          this.logger.log(`✅ Incluido income para ${newShipment.status}: ${trackingNumber}`);
        } else {
          const reason = validationResult.reason || `❌ No se encontró matchedHistory válido para income: ${trackingNumber}`;
          this.logger.log(reason);
          this.logBuffer.push(reason);
          result.failed++;
          result.saved--;
          result.failedTrackings.push({ trackingNumber, reason });
          shipmentsWithError.saveError.push({ trackingNumber, reason });
          return;
        }
      }
    } catch (err) {
      const reason = `Error al procesar shipment ${trackingNumber}: ${err.message}`;
      this.logger.error(`❌ ${reason}`);
      result.failed++;
      result.saved--;
      result.failedTrackings.push({ trackingNumber, reason });
      shipmentsWithError.saveError.push({ trackingNumber, reason });
      this.logBuffer.push(reason);
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
    const trackingNumber = shipment.trackingNumber;
    this.logger.log(`📦 Procesando envío ${shipmentIndex}/${this.BATCH_SIZE} del lote ${batchNumber}: ${trackingNumber}`);
    this.logger.log(`📅 commitDate desde archivo: ${shipment.commitDate}, commitTime desde archivo: ${shipment.commitTime}`);

    if (!consolidated.id) {
      const reason = `Error: consolidated.id no está definido para ${trackingNumber}`;
      this.logger.error(`❌ ${reason}`);
      result.failed++;
      result.failedTrackings.push({ trackingNumber, reason });
      shipmentsWithError.saveError.push({ trackingNumber, reason });
      this.logBuffer.push(reason);
      return;
    }

    // Check in-memory duplicates
    if (processedTrackingNumbers.has(trackingNumber)) {
      const reason = `Envío duplicado en el lote actual: ${trackingNumber}`;
      this.logger.warn(`🔁 ${reason}`);
      result.duplicated++;
      result.duplicatedTrackings.push(shipment);
      shipmentsWithError.duplicated.push({ trackingNumber, reason });
      this.logBuffer.push(reason);
      return;
    }

    // Check database duplicates
    if (await this.existShipment(trackingNumber, consolidatedId)) {
      const reason = `Envío duplicado en la base de datos: ${trackingNumber}`;
      this.logger.warn(`🔁 ${reason}`);
      result.duplicated++;
      result.duplicatedTrackings.push(shipment);
      shipmentsWithError.duplicated.push({ trackingNumber, reason });
      this.logBuffer.push(reason);
      return;
    }

    processedTrackingNumbers.add(trackingNumber);

    // Validate and format commitDate and commitTime from Excel
    let commitDate: string | undefined;
    let commitTime: string | undefined;
    let commitDateTime: Date | undefined;
    let dateSource = '';

    //Formatear a utc los commit que vienen normal
    if (shipment.commitDate && shipment.commitTime) {
      try {
        const timeZone = 'America/Hermosillo';
        const parsedDate = parse(shipment.commitDate, 'yyyy-MM-dd', new Date());
        const parsedTime = parse(shipment.commitTime, 'HH:mm:ss', new Date());

        if (!isNaN(parsedDate.getTime()) && !isNaN(parsedTime.getTime())) {
          commitDate = format(parsedDate, 'yyyy-MM-dd');
          commitTime = format(parsedTime, 'HH:mm:ss');

          // Fecha local como string
          const localDateTime = `${commitDate}T${commitTime}`;

          // ⬇️ Aquí está el truco: usar toDate con timeZone
          // Esto interpreta localDateTime como si fuera Hermosillo y devuelve UTC
          commitDateTime = toDate(localDateTime, { timeZone });

          dateSource = 'Excel';
          this.logger.log(
            `📅 commitDateTime (UTC) asignado desde Excel para ${trackingNumber}: ${commitDateTime.toISOString()} (commitDate=${commitDate}, commitTime=${commitTime}, TZ=${timeZone})`,
          );
        } else {
          this.logger.log(
            `⚠️ Formato inválido en Excel para ${trackingNumber}: commitDate=${shipment.commitDate}, commitTime=${shipment.commitTime}`,
          );
        }
      } catch (err) {
        this.logger.log(
          `⚠️ Error al parsear datos de Excel para ${trackingNumber}: ${err.message}`,
        );
      }
    }

    const newShipment = Object.assign(new Shipment(), {
      trackingNumber,
      shipmentType: ShipmentType.FEDEX,
      recipientName: shipment.recipientName || '',
      recipientAddress: shipment.recipientAddress || '',
      recipientCity: shipment.recipientCity || predefinedSubsidiary.name,
      recipientZip: shipment.recipientZip || '',
      commitDate: commitDate || undefined,
      commitTime: commitTime || undefined,
      commitDateTime: commitDateTime || undefined,
      recipientPhone: shipment.recipientPhone || '',
      status: ShipmentStatusType.PENDIENTE,
      priority: Priority.BAJA,
      consNumber: consolidated.consNumber || '',
      receivedByName: '',
      subsidiary: predefinedSubsidiary,
      subsidiaryId: predefinedSubsidiary.id,
      consolidatedId: consolidated.id,
    });

    let fedexShipmentData: FedExTrackingResponseDto;

    try {
      this.logger.log(`📬 Consultando FedEx para ${trackingNumber}`);
      fedexShipmentData = await this.trackPackageWithRetry(trackingNumber);
      this.logger.log(`📬 Datos FedEx recibidos para: ${trackingNumber}`);
    } catch (err) {
      const reason = `Error FedEx (${trackingNumber}): ${err.message}`;
      this.logger.error(`❌ ${reason}`);
      result.failed++;
      result.failedTrackings.push({ trackingNumber, reason });
      shipmentsWithError.fedexError.push({ trackingNumber, reason });
      this.logBuffer.push(reason);
      return;
    }

    try {
      const trackResults = fedexShipmentData.output.completeTrackResults[0].trackResults;
      
      // 🔥 CORRECCIÓN: Crear un objeto shipment mínimo para evitar referencias circulares
      const shipmentReference = Object.assign(new Shipment(), {
        trackingNumber: trackingNumber,
        // Solo incluir propiedades necesarias, NO incluir relaciones bidireccionales
      });

      const histories = await this.processFedexScanEventsToStatusesResp(
        trackResults.flatMap((result) => result.scanEvents || []),
        shipmentReference
      );

      // 🔥 LIMPIAR REFERENCIAS CIRCULARES INMEDIATAMENTE
      if (histories && Array.isArray(histories)) {
        histories.forEach(status => {
          // Eliminar cualquier referencia circular que se haya creado
          status.shipment = undefined;
          status.id = undefined; // Los IDs se generarán al guardar
        });
      }

      this.logger.log(
        `📜 Historial generado para ${trackingNumber}: ${histories.map((h) => h.status).join(', ')}`
      );

      const trackResult = trackResults.find((r) => r.latestStatusDetail?.derivedCode === 'DL') || trackResults.sort((a, b) => {
        const dateA = a.scanEvents[0]?.date ? new Date(a.scanEvents[0].date).getTime() : 0;
        const dateB = b.scanEvents[0]?.date ? new Date(b.scanEvents[0].date).getTime() : 0;
        return dateB - dateA;
      })[0];

      // Set commitDateTime from FedEx if Excel date is invalid
      if (!commitDateTime) {
        const rawDate = trackResult?.standardTransitTimeWindow?.window?.ends;
        console.log("🚀 ~ ShipmentsService ~ processShipment ~ rawDate:", rawDate)
        if (rawDate) {
          try {
            const parsedFedexDate = parse(rawDate, "yyyy-MM-dd'T'HH:mm:ssXXX", new Date());
            if (!isNaN(parsedFedexDate.getTime())) {
              commitDate = format(parsedFedexDate, 'yyyy-MM-dd');
              commitTime = format(parsedFedexDate, 'HH:mm:ss');
              commitDateTime = parsedFedexDate;
              dateSource = 'FedEx';
              this.logger.log(`📅 commitDateTime asignado desde FedEx para ${trackingNumber}: ${commitDateTime.toISOString()} (commitDate=${commitDate}, commitTime=${commitTime})`);
            } else {
              this.logger.log(`⚠️ Formato de fecha inválido en FedEx para ${trackingNumber}: ${rawDate}`);
            }
          } catch (err) {
            this.logger.log(`⚠️ Error al parsear fecha de FedEx para ${trackingNumber}: ${err.message}`);
          }
        }
      }

      // Use default date as last resort
      if (!commitDateTime) {
        // Crear directamente la fecha UTC equivalente a 18:00 UTC-7
        const now = new Date();
        const utcDate = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          18 + 7, // 18:00 UTC-7 = 01:00 UTC (día siguiente)
          0,
          0
        ));
        
        commitDateTime = utcDate;
        dateSource = 'Default';
        this.logger.log(`⚠️ commitDateTime asignado por defecto: ${commitDateTime.toISOString()}`);
      }

      // Update shipment with final date values
      newShipment.commitDate = commitDate;
      newShipment.commitTime = commitTime;
      newShipment.commitDateTime = commitDateTime;
      newShipment.priority = getPriority(commitDateTime);

      this.logger.log(`📅 Fecha final asignada para ${trackingNumber} desde ${dateSource}: commitDateTime=${commitDateTime.toISOString()}`);

      Object.assign(newShipment, {
        statusHistory: histories,
        status: histories[histories.length - 1]?.status || ShipmentStatusType.PENDIENTE,
        receivedByName: trackResult?.deliveryDetails?.receivedByName || '',
        shipmentType: ShipmentType.FEDEX,
      });

      if (shipment.payment) {
        const typeMatch =  shipment.payment.match(/^(COD|FTC|ROD)/);
        const amountMatch =  shipment.payment.match(/([0-9]+(?:\.[0-9]+)?)/);

        if (amountMatch) {
          const paymentType = typeMatch ? typeMatch[1] as PaymentTypeEnum : null;
          const paymentAmount = amountMatch ? parseFloat(amountMatch[1]) : null;
                         
          if (!isNaN(paymentAmount) && paymentAmount > 0) {
            newShipment.payment = Object.assign(new Payment(), {
              amount: paymentAmount,
              type: paymentType,
              status: histories.some((h) => h.status === ShipmentStatusType.ENTREGADO)
                ? PaymentStatus.PAID
                : PaymentStatus.PENDING,
            });
            this.logger.log(
              `💰 Monto de pago: $${paymentAmount} - Estatus: ${newShipment.payment.status}`
            );
          }
        }
      }

      // Add to batch for saving later
      this.shipmentBatch.push(newShipment);
      result.saved++;

      // Validación para income con reglas extendidas
      if ([ShipmentStatusType.ENTREGADO, ShipmentStatusType.NO_ENTREGADO].includes(newShipment.status)) {
        const matchedHistory = histories
          .filter((h) => h.status === newShipment.status)
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
        const exceptionCodes = histories.map((h) => h.exceptionCode).filter(Boolean);

        const validationResult = await this.applyIncomeValidationRules(
          newShipment,
          newShipment.status,
          exceptionCodes,
          histories,
          trackingNumber,
          matchedHistory?.timestamp || new Date()
        );

        if (validationResult.isValid && matchedHistory) {
          shipmentsToGenerateIncomes.push({
            shipment: newShipment,
            timestamp: validationResult.timestamp,
            exceptionCode: matchedHistory.exceptionCode,
          });
          this.logger.log(`✅ Incluido income para ${newShipment.status}: ${trackingNumber}`);
        } else {
          const reason = validationResult.reason || `❌ No se encontró matchedHistory válido para income: ${trackingNumber}`;
          this.logger.log(reason);
          this.logBuffer.push(reason);
          result.failed++;
          result.saved--;
          result.failedTrackings.push({ trackingNumber, reason });
          shipmentsWithError.saveError.push({ trackingNumber, reason });
          return;
        }
      }
    } catch (err) {
      const reason = `Error al procesar shipment ${trackingNumber}: ${err.message}`;
      this.logger.error(`❌ ${reason}`);
      result.failed++;
      result.saved--;
      result.failedTrackings.push({ trackingNumber, reason });
      shipmentsWithError.saveError.push({ trackingNumber, reason });
      this.logBuffer.push(reason);
    }
  }

  private async generateIncomes(
    shipment: Shipment,
    timestamp: Date,
    exceptionCode: string | undefined,
    transactionalEntityManager: EntityManager
  ): Promise<void> {
    this.logger.log(`🧾 Generando income para ${shipment.trackingNumber}`);
    const incomeStartTime = Date.now();

    // Validate required fields with defaults
    if (!shipment.trackingNumber) {
      this.logger.error(`🚀 Tracking number faltante para generar income`);
      throw new Error(`Datos incompletos: trackingNumber es requerido`);
    }
    if (!timestamp) {
      this.logger.warn(`🚀 Timestamp faltante para ${shipment.trackingNumber}, usando fecha actual`);
      timestamp = new Date();
    }
    if (!shipment.subsidiary) {
      this.logger.error(`🚀 Subsidiary faltante para ${shipment.trackingNumber}`);
      throw new Error(`Datos incompletos: subsidiary es requerido`);
    }
    if (!shipment.id) {
      this.logger.error(`🚀 Shipment ID faltante para ${shipment.trackingNumber}`);
      throw new Error(`Datos incompletos: shipment.id es requerido`);
    }
    if (!shipment.subsidiary.id) {
      this.logger.error(`🚀 Subsidiary ID faltante para ${shipment.trackingNumber}`);
      throw new Error(`Datos incompletos: subsidiary.id es requerido`);
    }

    let incomeType: IncomeStatus;
    let incomeSubType = '';

    switch (shipment.status) {
      case ShipmentStatusType.ENTREGADO:
        incomeType = IncomeStatus.ENTREGADO;
        break;
      case ShipmentStatusType.NO_ENTREGADO:
        incomeType = IncomeStatus.NO_ENTREGADO;
        incomeSubType = exceptionCode ?? '';
        break;
      default:
        const reason = `Unhandled shipment status: ${shipment.status}`;
        this.logger.error(`❌ ${reason}`);
        throw new Error(reason);
    }

    try {
      const newIncome = this.incomeRepository.create({
        trackingNumber: shipment.trackingNumber,
        shipment: { id: shipment.id },
        subsidiary: shipment.subsidiary,
        shipmentType: shipment.shipmentType || ShipmentType.FEDEX,
        cost: shipment.subsidiary.fedexCostPackage || 0,
        incomeType,
        nonDeliveryStatus: incomeSubType,
        isGrouped: false,
        sourceType: IncomeSourceType.SHIPMENT,
        date: timestamp,
        createdAt: new Date(),
      });

      await transactionalEntityManager.save(newIncome);
      const incomeDuration = ((Date.now() - incomeStartTime) / 1000).toFixed(2);
      this.logger.log(`✅ Income guardado para ${shipment.trackingNumber} en ${incomeDuration}s`);
    } catch (err) {
      const reason = `Fallo al guardar income para ${shipment.trackingNumber}: ${err.message}`;
      this.logger.error(`❌ ${reason}`);
      throw new Error(reason);
    }
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
    async getShipmentsToValidate(): Promise<Shipment[]> {
      this.logger.log(`🔍 Iniciando getShipmentsToValidate`);
      try {
        // Verificar nuevamente shipmentRepository
        if (!this.shipmentRepository || !this.shipmentRepository.createQueryBuilder) {
          const reason = 'shipmentRepository no está inicializado correctamente en getShipmentsToValidate';
          this.logger.error(`❌ ${reason}`);
          this.logBuffer.push(reason);
          return [];
        }

        this.logger.log(`📋 Construyendo consultas para shipmentRepository`);
        const baseQuery = this.shipmentRepository
          .createQueryBuilder('shipment')
          .leftJoinAndSelect('shipment.payment', 'payment')
          .leftJoinAndSelect('shipment.statusHistory', 'statusHistory')
          .leftJoinAndSelect('shipment.subsidiary', 'subsidiary')
          .where('shipment.shipmentType = :shipmentType', { shipmentType: ShipmentType.FEDEX });

        this.logger.log(`📋 Construyendo group1`);
        const group1 = baseQuery
          .clone()
          .andWhere('shipment.status IN (:...statuses)', {
            statuses: [
              ShipmentStatusType.PENDIENTE,
              ShipmentStatusType.RECOLECCION,
              ShipmentStatusType.EN_RUTA,
            ],
          });

        this.logger.log(`📋 Construyendo group2`);
        const group2 = this.shipmentRepository
          .createQueryBuilder('shipment')
          .leftJoinAndSelect('shipment.payment', 'payment')
          .leftJoinAndSelect('shipment.statusHistory', 'statusHistory')
          .leftJoinAndSelect('shipment.subsidiary', 'subsidiary')
          .where('shipment.shipmentType = :shipmentType', {
            shipmentType: ShipmentType.FEDEX,
          })
          .andWhere('shipment.status = :status', {
            status: ShipmentStatusType.NO_ENTREGADO,
          })
          .andWhere(qb => {
            const subQuery = qb
              .subQuery()
              .select('COUNT(DISTINCT DATE(status.timestamp))')
              .from('shipment_status', 'status')
              .where('status.shipmentId = shipment.id')
              .andWhere('status.exceptionCode = :code')
              .getQuery();
            return `${subQuery} <= 3`;
          })
          .setParameter('code', '08');

        this.logger.log(`📋 Construyendo group3`);
        const group3 = this.shipmentRepository
          .createQueryBuilder('shipment')
          .leftJoinAndSelect('shipment.payment', 'payment')
          .leftJoinAndSelect('shipment.statusHistory', 'statusHistory')
          .leftJoinAndSelect('shipment.subsidiary', 'subsidiary')
          .where('shipment.shipmentType = :shipmentType', {
            shipmentType: ShipmentType.FEDEX,
          })
          .andWhere('shipment.status = :status', {
            status: ShipmentStatusType.NO_ENTREGADO,
          })
          .andWhere('statusHistory.exceptionCode IN (:...codes)', { codes: ['03', '17'] });

        this.logger.log(`📋 Ejecutando consultas group1, group2, group3`);
        const [g1, g2, g3] = await Promise.all([
          group1.getMany().catch(err => {
            this.logger.error(`❌ Error en group1: ${err.message}`);
            this.logBuffer.push(`❌ Error en group1: ${err.message}`);
            return [];
          }),
          group2.getMany().catch(err => {
            this.logger.error(`❌ Error en group2: ${err.message}`);
            this.logBuffer.push(`❌ Error en group2: ${err.message}`);
            return [];
          }),
          group3.getMany().catch(err => {
            this.logger.error(`❌ Error en group3: ${err.message}`);
            this.logBuffer.push(`❌ Error en group3: ${err.message}`);
            return [];
          }),
        ]);

        this.logger.log(`📋 Combinando resultados: g1=${g1?.length || 0}, g2=${g2?.length || 0}, g3=${g3?.length || 0}`);
        const map = new Map<string, Shipment>();
        [...(g1 || []), ...(g2 || []), ...(g3 || [])].forEach((s) => map.set(s.id, s));
        const shipments = Array.from(map.values());
        this.logger.log(`📦 ${shipments.length} envíos obtenidos para validar en FedEx`);
        this.logger.log(`📋 Resultado de getShipmentsToValidate: ${JSON.stringify(shipments.map(s => s.trackingNumber))}`);
        return shipments;
      } catch (err) {
        const reason = `Error en getShipmentsToValidate: ${err.message}`;
        this.logger.error(`❌ ${reason}`);
        this.logBuffer.push(reason);
        return [];
      }
    }

    async getSimpleChargeShipments(): Promise<ChargeShipment[]> {
      this.logger.log('🔍 Obteniendo charge shipments básicos');
      
      if (!this.chargeShipmentRepository) {
        this.logger.error('❌ chargeShipmentRepository no está disponible');
        return [];
      }

      try {
        // Consulta única con todos los criterios combinados
        const query = this.chargeShipmentRepository
          .createQueryBuilder('cs')
          .select(['cs.id', 'cs.trackingNumber', 'cs.status'])
          .where('cs.shipmentType = :shipmentType', { shipmentType: ShipmentType.FEDEX })
          .andWhere(new Brackets(qb => {
            qb.where('cs.status IN (:...statuses)', {
                statuses: [
                  ShipmentStatusType.PENDIENTE,
                  ShipmentStatusType.RECOLECCION,
                  ShipmentStatusType.DESCONOCIDO,
                  ShipmentStatusType.EN_RUTA,
                ],
              })
              .orWhere('cs.status = :noEntregado', { noEntregado: ShipmentStatusType.NO_ENTREGADO })
          }));

        const results = await query.getMany();
        this.logger.log(`📦 Obtenidos ${results.length} charge shipments`);
        
        return results;
      } catch (error) {
        this.logger.error(`❌ Error al obtener charge shipments: ${error.message}`);
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

    private isSameDay(date1: Date, date2: Date): boolean {
      return date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate();
    }

    /*** Ya funciona para actualizar los 08 que eran pendiente y funciona con reglas de la sucursal */
    async checkStatusOnFedexBySubsidiaryRulesTesting(
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
        const history = shipment.statusHistory.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        const lastStatus = history[history.length - 1];
        const firstOnTheWay = history.find(h => h.status === ShipmentStatusType.EN_RUTA);

        if (!firstOnTheWay) {
          // Si nunca tuvo estado EN_RUTA, lo saltamos o agregamos con null
          results.push({
            trackingNumber: shipment.trackingNumber,
            lastStatus: lastStatus.status,
            daysWithoutEnRuta: null,
            comment: 'Nunca tuvo EN_RUTA',
          });
          continue;
        }

        const fromDate = new Date(firstOnTheWay.timestamp);
        const totalDays = differenceInDays(today, fromDate);

        let daysWithoutEnRuta = 0;

        for (let i = 0; i <= totalDays; i++) {
          const currentDay = addDays(fromDate, i);

          const hasEnRutaThatDay = history.some(
            (h) =>
              h.status === ShipmentStatusType.EN_RUTA &&
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
      }

      return results;
    }

    async getShipmentsWithStatus03(subdiaryId: string) {
      const todayUTC = new Date();
      todayUTC.setUTCHours(0, 0, 0, 0);
      console.log("🚀 ~ ConsolidatedService ~ todayUTC:", todayUTC);

      const tomorrowUTC = new Date(todayUTC);
      tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);
      console.log("🚀 ~ ConsolidatedService ~ tomorrowUTC:", tomorrowUTC);

      const subsidiary = await this.subsidiaryRepository.findOneBy({ id: subdiaryId });

      const shipments = await this.shipmentRepository
        .createQueryBuilder("shipment")
        .leftJoin("shipment.statusHistory", "statusHistory")
        .leftJoin("shipment.packageDispatch", "packageDispatch")
        .where("shipment.subsidiaryId = :subdiaryId", { subdiaryId })
        .andWhere("shipment.status = :status", { status: ShipmentStatusType.NO_ENTREGADO })
        .andWhere("statusHistory.exceptionCode = :exceptionCode", { exceptionCode: "03" })
        .andWhere("statusHistory.timestamp BETWEEN :todayUTC AND :tomorrowUTC", { todayUTC, tomorrowUTC })
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
        .distinct(true)
        .getRawMany<ShipmentStatusForReportDto>();

      if (shipments.length > 0) {
        const sendEmail = await this.mailService.sendHighPriorityShipmentWithStatus03(
          subsidiary,
          shipments,
        );
        console.log("🚀 ~ ShipmentsService ~ getShipmentsWithStatus03 ~ sendEmail:", sendEmail);
      } else {
        console.log("🚀 ~ ShipmentsService ~ getShipmentsWithStatus03: No shipments found, no email sent");
      }

      return shipments;
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

    async getShipmentHistoryFromFedex(id: string) {
      const shipment = await this.shipmentRepository.findOne({ where: { id } });

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



    /************************************************* */


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
}


