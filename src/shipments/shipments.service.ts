import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import * as XLSX from 'xlsx';
import { FedexService } from './fedex.service';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { getPriority, parseDynamicFileF2, parseDynamicSheet, parseDynamicSheetCharge, parseDynamicSheetDHL } from 'src/utils/file-upload.utils';
import { scanEventsFilter } from 'src/utils/scan-events-filter';
import { ParsedShipmentDto } from './dto/parsed-shipment.dto';
import { mapFedexStatusToLocalStatus } from 'src/utils/fedex.utils';
import { endOfToday, format, parse, startOfToday } from 'date-fns';
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
import { first, map, catchError } from 'rxjs/operators';
import { retry } from 'rxjs/operators';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { ConsolidatedType } from 'src/common/enums/consolidated-type.enum';

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);
  private PRECIO_ENTREGADO = 59.51;

  /*** Temporal */
  private citiesNotClasified = [];

  private logBuffer: string[] = [];
  private shipmentBatch: Shipment[] = [];
  private readonly logFilePath = path.join(__dirname, '../../logs/shipment-logs.log');
  private readonly BATCH_SIZE = 10;

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
    private readonly fedexService: FedexService,
    private readonly dhlService: DHLService,
    private readonly subsidiaryService: SubsidiariesService,
    private readonly consolidatedService: ConsolidatedService
  ) { }

  async appendLogToFile(message: string) {
    const logFilePath = path.resolve(__dirname, '../../logs/shipment-process-errors.log');
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
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
        commitDate: "ASC",
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

  /***** Just for testing ONE tracking */
    async validateDataforTracking(file: Express.Multer.File) {
      if (!file) throw new BadRequestException('No file uploaded');

      const { buffer, originalname } = file;
      const duplicatedTrackings: any[] = [];
      const newShipments: Shipment[] = [];

      if (!originalname.match(/\.(csv|xlsx?)$/i)) {
        throw new BadRequestException('Unsupported file type');
      }

      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      
      const shipmentsToSave: ParsedShipmentDto[] = parseDynamicSheet(sheet, {fileName: originalname});
      //console.log("🚀 ~ ShipmentsService ~ validateDataforTracking ~ shipmentsToSave:", shipmentsToSave)

      for (const shipment of shipmentsToSave) { 
        const shipmentInfo: FedExTrackingResponseDto = await this.fedexService.trackPackage(shipment.trackingNumber)
        const scanEvents = scanEventsFilter(shipmentInfo.output.completeTrackResults[0].trackResults[0].scanEvents, "A trusted third-party vendor is on the way with your package");
        let shipmentStatus: ShipmentStatus[] = [];
        
        const payment: Payment = null;
        const newShipment = this.shipmentRepository.create({...shipment, payment});
      
        //console.log("🚀 ~ ShipmentsService ~ validateDataforTracking ~ newShipment:", newShipment)
        const filteredScanEvents: FedExScanEventDto[] = [];

        if(scanEvents.length === 0) {
          filteredScanEvents.push(...scanEventsFilter(shipmentInfo.output.completeTrackResults[0].trackResults[0].scanEvents, "At local FedEx facility"));
        } else {
          filteredScanEvents.push(...scanEvents);
        }

        if(filteredScanEvents.length === 0) {
          filteredScanEvents.push(...scanEventsFilter(shipmentInfo.output.completeTrackResults[0].trackResults[0].scanEvents, "On FedEx vehicle for delivery"))
        }

        for (const scanEvent of filteredScanEvents) {
            const isInicialState = scanEvent.date === filteredScanEvents[filteredScanEvents.length - 1].date;
        
            const newShipmentStatus = new ShipmentStatus();
            const rawDate = scanEvent.date; // '2025-06-05T10:57:00-07:00'
            const eventDate = new Date(rawDate);
            
            console.log(`Fecha original (${scanEvent.date}):`, rawDate); 
            console.log('Fecha convertida (UTC):', eventDate.toISOString());

            newShipmentStatus.status = isInicialState
              ? ShipmentStatusType.RECOLECCION
              : mapFedexStatusToLocalStatus(scanEvent.eventDescription);        
            newShipmentStatus.timestamp = eventDate;
            newShipmentStatus.notes = this.generateNote(scanEvent, isInicialState);

            // ✅ Aquí asignas el shipment relacionado
            newShipmentStatus.shipment = newShipment;
            shipmentStatus.push(newShipmentStatus);
        }

        if (!shipment.commitDate) {
          const rawDate = shipmentInfo.output.completeTrackResults[0].trackResults[0].standardTransitTimeWindow.window.ends; // Ej: '2025-06-05T10:57:00-07:00'
          
          if(!rawDate){
            console.log("🚀 ~ ShipmentsService ~ validateDataforTracking ~ rawDate ~ sin rawDate")
            const defaultDay = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
            console.log("🚀 ~ ShipmentsService ~ validateDataforTracking ~ defaultDay:", defaultDay)
            const [fecha] = defaultDay.split(' ');
            newShipment.commitDate = fecha;
            console.log("🚀 ~ ShipmentsService ~ validateDataforTracking ~  newShipment.commitDate:",  newShipment.commitDate)
            newShipment.commitTime = '18:00:00'
          } else {
            const formattedDateTime = format(
              new Date(rawDate.replace(/([-+]\d{2}:\d{2})$/, '')), 
              'yyyy-MM-dd HH:mm:ss'
            );
            
            const [fecha, hora] = formattedDateTime.split(' ');
            newShipment.commitDate = fecha
            newShipment.commitTime = hora
          }
        }

        newShipment.priority = getPriority(new Date(newShipment.commitDate))
        newShipment.subsidiary = await this.cityClasification(shipment.recipientCity)
        newShipment.statusHistory = shipmentStatus;
        newShipment.status = shipmentStatus[0].status;
        newShipment.receivedByName = shipmentInfo.output.completeTrackResults[0].trackResults[0].deliveryDetails.receivedByName;
        newShipment.shipmentType = ShipmentType.FEDEX;    

        if(shipment.payment){
          const newPayment: Payment = new Payment();
          const match = shipment.payment.match(/([0-9]+(?:\.[0-9]+)?)/);
          const isPaymentClomplete = shipmentStatus.findIndex(history => history.status === ShipmentStatusType.ENTREGADO);

          if(match) {
            const amount = parseFloat(match[1]);
            if(!isNaN(amount)) {
              newPayment.amount = amount;
              newPayment.status =  isPaymentClomplete ? PaymentStatus.PAID : PaymentStatus.PENDING
            }
          }

          newShipment.payment = newPayment;
        }
        
        newShipments.push(newShipment);
      }


      const outputShipments = newShipments.map(shipment => ({
        ...shipment,
        statusHistory: shipment.statusHistory.map(status => ({
          status: status.status,
          timestamp: status.timestamp,
          notes: status.notes,
        }))
      }));


      const datoToResponse = {
        saved: outputShipments,
      
      }

      //this.logger.log(`🚀 ~ ShipmentsService ~ processExcelFile ~ datoToResponse: ${JSON.stringify(datoToResponse)}`)

      return datoToResponse;
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
        .select("AVG(DATEDIFF(shipment.commitDate, shipment.createdAt))", "prom")
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
          ? parseFloat(s.subsidiary?.fedexCostPackage || '0')
          : parseFloat(s.subsidiary?.dhlCostPackage || '0')
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
  
  async findAllShipmentsAndCharges(): Promise<ShipmentAndChargeDto[]> {
    const shipments = await this.shipmentRepository.find({
      relations: ['statusHistory', 'payment', 'subsidiary'],
      order: { commitDate: 'ASC' },
    });

    const charges = await this.chargeShipmentRepository.find({
      relations: ['statusHistory', 'payment', 'charge', 'subsidiary'],
      order: { commitDate: 'ASC' },
    });

    const chargeDtos: ShipmentAndChargeDto[] = charges.map(charge => ({
      ...charge,
      isChargePackage: true,
    }));

    const allShipments: ShipmentAndChargeDto[] = [...shipments, ...chargeDtos];

    // ✅ Ordenar todo el resultado combinado por commitDate
    allShipments.sort((a, b) => {
      const dateA = new Date(a.commitDate).getTime();
      const dateB = new Date(b.commitDate).getTime();
      return dateA - dateB;
    });

    return allShipments;
  }

  /*** Método para obtener las cargas con sus envios */
  async getAllChargesWithStatus(): Promise<ChargeWithStatusDto[]> {
    const charges = await this.chargeRepository.find({
      relations: ['subsidiary'],
    });

    const chargeShipments = await this.chargeShipmentRepository.find({
      relations: ['charge', 'subsidiary'],
    });

    const chargeMap = new Map<string, ChargeShipment[]>();

    // Agrupa los chargeShipments por chargeId
    for (const shipment of chargeShipments) {
      if (!shipment.chargeId) continue;
      if (!chargeMap.has(shipment.chargeId)) {
        chargeMap.set(shipment.chargeId, []);
      }
      chargeMap.get(shipment.chargeId)!.push(shipment);
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

  /*** Procesar cargas cuando vienen los archivos separados */
  async processFileF2(file: Express.Multer.File, subsidiaryId: string, consNumber: string, consDate?: Date) {
    if (!file) throw new BadRequestException('No file uploaded');
    this.logger.log(`📂 Start processing file: ${file.originalname}`);

    const { buffer, originalname } = file;
    const notFoundTrackings: any[] = [];
    const errors: any[] = [];
    const migrated: ChargeShipment[] = [];

    if (!originalname.match(/\.(csv|xlsx?)$/i)) {
      throw new BadRequestException('Unsupported file type');
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const shipmentsToUpdate = parseDynamicFileF2(sheet);

    if (shipmentsToUpdate.length === 0) {
      return { message: 'No shipments found in the file.' };
    }

    const newCharge = this.chargeRepository.create({
      subsidiaryId,
      chargeDate: consDate ? format(consDate, 'yyyy-MM-dd HH:mm:ss') : format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
      numberOfPackages: shipmentsToUpdate.length,
      consNumber
    });

    const savedCharge = await this.chargeRepository.save(newCharge);

    const chargeSubsidiary = await this.subsidiaryRepository.findOne({ where: { id: subsidiaryId } });

    const processPromises = shipmentsToUpdate.map(async (shipment) => {
      const validation = await this.existShipmentByTrackSpecial(
        shipment.trackingNumber,
        shipment.recipientName,
        shipment.recipientAddress,
        shipment.recipientZip
      );

      if (!validation.exist) {
        notFoundTrackings.push(shipment);
        return;
      }

      try {
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

        this.logger.log(`✅ Migrated and deleted shipment: ${original.trackingNumber}`);
        migrated.push(savedChargeShipment);
      } catch (err) {
        this.logger.error(`❌ Error migrating shipment ${shipment.trackingNumber}: ${err.message}`);
        errors.push({ shipment: shipment.trackingNumber, reason: err.message });
      }
    });

    await Promise.allSettled(processPromises);

    // ✅ Crear el ingreso relacionado al charge solo si hubo migraciones exitosas
    if (migrated.length > 0 && chargeSubsidiary) {
      const newIncome = this.incomeRepository.create({
        subsidiary: chargeSubsidiary,
        shipmentType: ShipmentType.FEDEX,
        incomeType: IncomeStatus.ENTREGADO,
        cost: chargeSubsidiary.chargeCost,
        isGrouped: true,
        sourceType: IncomeSourceType.CHARGE,
        chargeId: savedCharge.id,
        date: consDate ? consDate : new Date(),
      });

      await this.incomeRepository.save(newIncome);
    }

    return {
      migrated,
      notFound: notFoundTrackings,
      errors,
    };
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
      let shipmentToUpdate = await this.shipmentRepository.findOneBy({
        trackingNumber,
        recipientAddress
      })

      if(shipmentToUpdate) {
        shipmentToUpdate.payment = payment;
        await this.shipmentRepository.save(shipmentToUpdate);
      }

    }

    return shipmentsWithCharge;
  }

  private async processFedexScanEventsToStatuses(
    scanEvents: FedExScanEventDto[],
    shipment: Shipment
  ): Promise<ShipmentStatus[]> {
    this.logger.debug(`🔍 Iniciando processScanEventsToStatuses para ${shipment.trackingNumber} con ${scanEvents.length} eventos`);
    const { statuses, hasException, hasDelivered } = scanEvents
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .reduce<{
        statuses: ShipmentStatus[];
        hasException: boolean;
        hasDelivered: boolean;
      }>(
        (acc, event, index) => {
          this.logger.debug(`📌 Procesando evento ${index + 1}/${scanEvents.length} para ${shipment.trackingNumber}`);
          const mappedStatus = mapFedexStatusToLocalStatus(event.derivedStatusCode, event.exceptionCode);
          if (mappedStatus === ShipmentStatusType.DESCONOCIDO) {
            this.logger.warn(`⚠️ Estado desconocido para evento: ${event.derivedStatusCode}`);
            return acc;
          }

          const statusEntry = Object.assign(new ShipmentStatus(), {
            shipment,
            status: mappedStatus,
            exceptionCode: event.exceptionCode || undefined,
            notes: event.exceptionCode
              ? `${event.exceptionCode} - ${event.exceptionDescription}`
              : `${event.eventType} - ${event.eventDescription}`,
            timestamp: new Date(event.date),
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
        const removed = statuses.splice(lastNoEntIndex + 1).filter(
          (s) => s.status === ShipmentStatusType.EN_RUTA
        );
        for (const rem of removed) {
          const warn = `🗑️ [${shipment.trackingNumber}] Eliminado EN_RUTA posterior a NO_ENTREGADO: ${rem.notes}`;
          this.logger.warn(warn);
          this.logBuffer.push(warn);
        }
      }
    }

    this.logger.debug(`✅ Finalizado processScanEventsToStatuses para ${shipment.trackingNumber} con ${statuses.length} estados`);
    return statuses;
  }

  /*** Procesar Archivos cons master */
  async addConsMasterBySubsidiary(
    file: Express.Multer.File,
    subsidiaryId: string,
    consNumber: string,
    consDate?: Date
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

    this.logger.debug(`🔍 Validando subsidiaria con ID: ${subsidiaryId}`);
    const predefinedSubsidiary = await this.subsidiaryService.findById(subsidiaryId);

    if (!predefinedSubsidiary) {
      const reason = `Subsidiaria con ID '${subsidiaryId}' no encontrada`;
      this.logger.error(`❌ ${reason}`);
      this.logBuffer.push(reason);
      throw new BadRequestException(reason);
    }

    this.logger.debug(`📄 Leyendo archivo Excel: ${file.originalname}`);
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const shipmentsToSave = workbook.SheetNames.flatMap((sheetName) =>
      parseDynamicSheet(workbook.Sheets[sheetName], { fileName: file.originalname, sheetName })
    );
    this.logger.log(`📄 Total de envíos procesados desde archivo: ${shipmentsToSave.length}`);

    // Crear Consolidated
    this.logger.debug(`📦 Creando consolidado para ${shipmentsToSave.length} envíos`);
    const consolidated = Object.assign(new Consolidated(), {
      date: consDate ? format(consDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
      type: ConsolidatedType.ORDINARIA,
      numberOfPackages: shipmentsToSave.length,
      subsidiary: predefinedSubsidiary,
      subsidiaryId: predefinedSubsidiary.id,
      consNumber,
      isCompleted: false,
      efficiency: 0,
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

    const batches = Array.from(
      { length: Math.ceil(shipmentsToSave.length / this.BATCH_SIZE) },
      (_, i) => shipmentsToSave.slice(i * this.BATCH_SIZE, (i + 1) * this.BATCH_SIZE)
    );
    this.logger.log(`📦 Procesando ${batches.length} lotes de ${this.BATCH_SIZE} envíos cada uno`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      this.logger.debug(`📦 Iniciando lote ${i + 1}/${batches.length} con ${batch.length} envíos`);
      try {
        await Promise.all(
          batch.map((shipment, index) =>
            this.processShipment(shipment, predefinedSubsidiary, consolidated, result, shipmentsWithError, i + 1, index + 1)
          )
        );
        this.logger.debug(`✅ Finalizado lote ${i + 1}/${batches.length}`);
      } catch (err) {
        const reason = `Error procesando lote ${i + 1}: ${err.message}`;
        this.logger.error(`❌ ${reason}`);
        this.logBuffer.push(reason);
        shipmentsWithError.saveError.push({ trackingNumber: `LOTE_${i + 1}`, reason });
      }

      // Guardar lote intermedio
      if (this.shipmentBatch.length) {
        try {
          await this.saveShipmentsInBatch(this.shipmentBatch);
          this.logger.log(`💾 Guardados ${this.shipmentBatch.length} envíos en lote ${i + 1}`);
          this.logBuffer.push(`💾 Guardados ${this.shipmentBatch.length} envíos en lote ${i + 1}`);
          this.shipmentBatch = [];
        } catch (err) {
          const reason = `Error al guardar lote de envíos ${i + 1}: ${err.message}`;
          this.logger.error(`❌ ${reason}`);
          this.logBuffer.push(reason);
          shipmentsWithError.saveError.push({ trackingNumber: `LOTE_${i + 1}`, reason });
          result.failed += this.shipmentBatch.length;
          result.saved -= this.shipmentBatch.length;
          this.shipmentBatch = [];
        }
      }
    }

    // Evitar Consolidated innecesario si todos son duplicados
    if (result.duplicated === shipmentsToSave.length) {
      await this.consolidatedService.remove(consolidated.id);
      this.logger.warn(`⚠️ Todos los envíos son duplicados. Consolidado ${consolidated.id} eliminado.`);
      this.logBuffer.push(`⚠️ Todos los envíos son duplicados. Consolidado ${consolidated.id} eliminado.`);
    } else {
      // Actualizar consolidado
      this.logger.debug(`📊 Actualizando consolidado ${consolidated.id}`);
      consolidated.isCompleted = true;
      consolidated.efficiency = shipmentsToSave.length
        ? (result.saved / shipmentsToSave.length) * 100
        : 0;
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

  private async processShipment(
    shipment: ParsedShipmentDto,
    predefinedSubsidiary: Subsidiary,
    consolidated: Consolidated,
    result: any,
    shipmentsWithError: any,
    batchNumber: number,
    shipmentIndex: number
  ): Promise<void> {
    const trackingNumber = shipment.trackingNumber;
    this.logger.debug(`📦 Procesando envío ${shipmentIndex}/${this.BATCH_SIZE} del lote ${batchNumber}: ${trackingNumber}`);
    this.logger.debug(`📅 commitDate desde archivo: ${shipment.commitDate}, commitTime desde archivo: ${shipment.commitTime}`);

    if (!consolidated.id) {
      const reason = `Error: consolidated.id no está definido para ${trackingNumber}`;
      this.logger.error(`❌ ${reason}`);
      result.failed++;
      result.failedTrackings.push({ trackingNumber, reason });
      shipmentsWithError.saveError.push({ trackingNumber, reason });
      this.logBuffer.push(reason);
      return;
    }

    if (await this.existShipment(trackingNumber)) {
      const reason = `Envío duplicado: ${trackingNumber}`;
      this.logger.warn(`🔁 ${reason}`);
      result.duplicated++;
      result.duplicatedTrackings.push(shipment);
      shipmentsWithError.duplicated.push({ trackingNumber, reason });
      this.logBuffer.push(reason);
      return;
    }

    // Validar y formatear commitDate y commitTime
    let commitDate = shipment.commitDate;
    let commitTime = shipment.commitTime;

    if (commitDate) {
      try {
        const parsedDate = parse(commitDate, 'yyyy-MM-dd', new Date());
        if (isNaN(parsedDate.getTime())) {
          this.logger.warn(`⚠️ Formato de commitDate inválido para ${trackingNumber}: ${commitDate}`);
          commitDate = undefined;
        } else {
          commitDate = format(parsedDate, 'yyyy-MM-dd');
        }
      } catch (err) {
        this.logger.warn(`⚠️ Error al parsear commitDate para ${trackingNumber}: ${commitDate}, error: ${err.message}`);
        commitDate = undefined;
      }
    }

    if (commitTime) {
      try {
        const parsedTime = parse(commitTime, 'HH:mm:ss', new Date());
        if (isNaN(parsedTime.getTime())) {
          this.logger.warn(`⚠️ Formato de commitTime inválido para ${trackingNumber}: ${commitTime}`);
          commitTime = undefined;
        } else {
          commitTime = format(parsedTime, 'HH:mm:ss');
        }
      } catch (err) {
        this.logger.warn(`⚠️ Error al parsear commitTime para ${trackingNumber}: ${commitTime}, error: ${err.message}`);
        commitTime = undefined;
      }
    }

    const newShipment = Object.assign(new Shipment(), {
      trackingNumber,
      shipmentType: ShipmentType.FEDEX,
      recipientName: shipment.recipientName || '',
      recipientAddress: shipment.recipientAddress || '',
      recipientCity: shipment.recipientCity || predefinedSubsidiary.name,
      recipientZip: shipment.recipientZip || '',
      commitDate: commitDate || format(new Date(), 'yyyy-MM-dd'),
      commitTime: commitTime || '18:00:00',
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
      this.logger.debug(`📬 Consultando FedEx para ${trackingNumber}`);
      fedexShipmentData = await this.trackPackageWithRetry(trackingNumber);
      this.logger.debug(`📬 Datos FedEx recibidos para: ${trackingNumber}`);
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

      const trackResult =
        trackResults.find((r) => r.latestStatusDetail?.derivedCode === 'DL') || trackResults[0];
      this.logger.debug(
        `📜 Historial generado para ${trackingNumber}: ${histories.map((h) => h.status).join(', ')}`
      );

      // Solo sobrescribir commitDate y commitTime si no se asignaron desde el archivo
      if (!commitDate) {
        const rawDate = trackResult?.standardTransitTimeWindow?.window?.ends;
        const formatted = rawDate
          ? format(new Date(rawDate.replace(/([-+]\d{2}:\d{2})$/, '')), 'yyyy-MM-dd HH:mm:ss')
          : format(new Date(), 'yyyy-MM-dd HH:mm:ss');
        [newShipment.commitDate, newShipment.commitTime = '18:00:00'] = formatted.split(' ');
        this.logger.debug(`📅 commitDate asignado desde FedEx o por defecto para ${trackingNumber}: ${newShipment.commitDate} ${newShipment.commitTime}`);
      }

      Object.assign(newShipment, {
        statusHistory: histories,
        status: histories[histories.length - 1]?.status || ShipmentStatusType.PENDIENTE,
        priority: getPriority(new Date(newShipment.commitDate)),
        receivedByName: trackResult?.deliveryDetails?.receivedByName || '',
        shipmentType: ShipmentType.FEDEX,
      });

      this.logger.debug(`📌 Estatus inicial: ${newShipment.status} - Prioridad: ${newShipment.priority}`);

      if (shipment.payment) {
        const match = shipment.payment.match(/([0-9]+(?:\.[0-9]+)?)/);
        if (match) {
          const amount = parseFloat(match[1]);
          if (!isNaN(amount) && amount > 0) {
            newShipment.payment = Object.assign(new Payment(), {
              amount,
              status: histories.some((h) => h.status === ShipmentStatusType.ENTREGADO)
                ? PaymentStatus.PAID
                : PaymentStatus.PENDING,
            });
            this.logger.debug(
              `💰 Monto de pago: $${amount} - Estatus: ${newShipment.payment.status}`
            );
          }
        }
      }

      // Guardar el shipment individualmente para generar el ID
      let savedShipment: Shipment;
      try {
        savedShipment = await this.shipmentRepository.save(newShipment);
        this.logger.debug(`💾 Shipment guardado para ${trackingNumber} con ID: ${savedShipment.id}`);
      } catch (err) {
        const reason = `Error al guardar shipment ${trackingNumber}: ${err.message}`;
        this.logger.error(`❌ ${reason}`);
        result.failed++;
        result.failedTrackings.push({ trackingNumber, reason });
        shipmentsWithError.saveError.push({ trackingNumber, reason });
        this.logBuffer.push(reason);
        return;
      }

      // Añadir al lote para el guardado en batch (opcional, ya guardado)
      this.shipmentBatch.push(savedShipment);
      result.saved++;

      if ([ShipmentStatusType.ENTREGADO, ShipmentStatusType.NO_ENTREGADO].includes(savedShipment.status)) {
        const matchedHistory = histories
          .filter((h) => h.status === savedShipment.status)
          .pop();

        if (!matchedHistory) {
          const reason = `No se encontró matchedHistory para: ${trackingNumber}, status: ${savedShipment.status}`;
          this.logger.warn(`⚠️ ${reason}`);
          result.failed++;
          result.saved--;
          result.failedTrackings.push({ trackingNumber, reason });
          shipmentsWithError.saveError.push({ trackingNumber, reason });
          this.logBuffer.push(reason);
          return;
        }

        this.logger.debug(`🧾 Iniciando generateIncomes para ${trackingNumber}`);
        const incomeStartTime = Date.now();
        try {
          await this.generateIncomes(savedShipment, matchedHistory.timestamp, matchedHistory.exceptionCode);
          const incomeDuration = ((Date.now() - incomeStartTime) / 1000).toFixed(2);
          this.logger.debug(`✅ generateIncomes completado para ${trackingNumber} en ${incomeDuration}s`);
        } catch (err) {
          const reason = `Error en generateIncomes para ${trackingNumber}: ${err.message}`;
          this.logger.error(`❌ ${reason}`);
          result.failed++;
          result.saved--;
          result.failedTrackings.push({ trackingNumber, reason });
          shipmentsWithError.saveError.push({ trackingNumber, reason });
          this.logBuffer.push(reason);
        }
      } else {
        const reason = `No se generó income: status del envío ${savedShipment.status} no es elegible`;
        this.logger.warn(`🚫 ${reason}`);
        this.logBuffer.push(reason);
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

  private async generateIncomes(shipment: Shipment, timestamp: Date, exceptionCode?: string): Promise<void> {
    this.logger.debug(`🧾 Generando income para ${shipment.trackingNumber}`);
    const incomeStartTime = Date.now();

    // Validar datos requeridos
    if (!shipment.trackingNumber || !timestamp || !shipment.subsidiary || !shipment.id || !shipment.subsidiary.id) {
      this.logger.error(
        `🚀 Datos incompletos para generar income del tracking ${shipment.trackingNumber}: ` +
        `trackingNumber=${shipment.trackingNumber}, timestamp=${timestamp}, ` +
        `subsidiary=${shipment.subsidiary}, subsidiaryId=${shipment.subsidiary?.id}, shipmentId=${shipment.id}`
      );
      throw new Error(`Datos incompletos para generar income del tracking ${shipment.trackingNumber}`);
    }

    // Mapear incomeType según el estado del envío
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
        shipmentId: shipment.id,
        subsidiary: shipment.subsidiary,
        subsidiaryId: shipment.subsidiary.id,
        shipmentType: shipment.shipmentType || ShipmentType.FEDEX,
        cost: parseFloat(shipment.subsidiary.fedexCostPackage) || 0,
        incomeType,
        notDeliveryStatus: incomeSubType,
        isGrouped: false,
        sourceType: IncomeSourceType.SHIPMENT,
        date: timestamp,
        createdAt: new Date().toISOString(),
      });

      await this.incomeRepository.save(newIncome);
      const incomeDuration = ((Date.now() - incomeStartTime) / 1000).toFixed(2);
      this.logger.debug(`✅ Income guardado para ${shipment.trackingNumber} en ${incomeDuration}s`);
    } catch (err) {
      const reason = `Fallo al guardar income para ${shipment.trackingNumber}: ${err.message}`;
      this.logger.error(`❌ ${reason}`);
      throw new Error(reason);
    }
  }

  private async saveShipmentsInBatch(shipments: Shipment[]): Promise<void> {
    this.logger.debug(`💾 Iniciando guardado de ${shipments.length} envíos en lote`);
    try {
      await this.shipmentRepository.save(shipments, { chunk: 50 });
      this.logger.debug(`✅ Guardado exitoso de ${shipments.length} envíos`);
    } catch (err) {
      const reason = `Error al guardar lote de envíos: ${err.message}`;
      this.logger.error(`❌ ${reason}`);
      this.logBuffer.push(reason);
      throw err;
    }
  }

  private async flushLogBuffer(): Promise<void> {
    if (this.logBuffer.length) {
      this.logger.debug(`📜 Escribiendo ${this.logBuffer.length} logs a archivo`);
      try {
        await fs.appendFile(this.logFilePath, this.logBuffer.join('\n') + '\n', 'utf-8');
        this.logger.debug(`✅ Logs escritos a ${this.logFilePath}`);
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
      this.logger.debug(`📜 Generando archivo de errores: ${outputPath}`);
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
      this.logger.debug(`📬 Intento ${attempts + 1}/${maxAttempts} para trackPackage: ${trackingNumber}`);
      try {
        const result = await this.fedexService.trackPackage(trackingNumber);
        this.logger.debug(`✅ trackPackage exitoso para ${trackingNumber}`);
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

  private async existShipment(trackingNumber: string): Promise<boolean> {
    this.logger.debug(`🔍 Verificando existencia de envío: ${trackingNumber}`);
    try {
      const exists = await this.shipmentRepository.exists({
        where: { trackingNumber },
      });
      this.logger.debug(`✅ Verificación completada para ${trackingNumber}: ${exists}`);
      return exists;
    } catch (err) {
      this.logger.error(`❌ Error verificando existencia de envío ${trackingNumber}: ${err.message}`);
      throw err;
    }
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
          shipmentToUpdate.commitDate = fecha;
          shipmentToUpdate.commitTime = hora;
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

  
  /****** Métodos para el cron que valida los envios y actualiza los status ******************/
    private async getShipmentsToValidate(): Promise<Shipment[]> {
      const baseQuery = this.shipmentRepository
        .createQueryBuilder('shipment')
        .leftJoinAndSelect('shipment.payment', 'payment')
        .leftJoinAndSelect('shipment.statusHistory', 'statusHistory')
        .where('shipment.shipmentType = :shipmentType', { shipmentType: ShipmentType.FEDEX });

      // Regla 1: Envíos con status pendiente, recolección o en ruta
      const group1 = baseQuery.clone()
        .andWhere('shipment.status IN (:...statuses)', {
          statuses: [
            ShipmentStatusType.PENDIENTE,
            ShipmentStatusType.RECOLECCION,
            ShipmentStatusType.EN_RUTA,
          ],
        });

      // Regla 2: No entregado con exceptionCode 08, pero solo 3 veces en días diferentes
      const group2 = this.shipmentRepository
        .createQueryBuilder('shipment')
        .leftJoinAndSelect('shipment.payment', 'payment')
        .leftJoinAndSelect('shipment.statusHistory', 'statusHistory')
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

      // Regla 3: No entregado con exceptionCode 03
      const group3 = this.shipmentRepository
        .createQueryBuilder('shipment')
        .leftJoinAndSelect('shipment.payment', 'payment')
        .leftJoinAndSelect('shipment.statusHistory', 'statusHistory')
        .where('shipment.shipmentType = :shipmentType', {
          shipmentType: ShipmentType.FEDEX,
        })
        .andWhere('shipment.status = :status', {
          status: ShipmentStatusType.NO_ENTREGADO,
        })
        .andWhere('statusHistory.exceptionCode IN (:...codes)', { codes: ['03', '17'] })

      // Ejecutar todas las reglas en paralelo
      const [g1, g2, g3] = await Promise.all([
        group1.getMany(),
        group2.getMany(),
        group3.getMany(),
      ]);

      // Unir los resultados y eliminar duplicados por ID
      const map = new Map<string, Shipment>();
      [...g1, ...g2, ...g3].forEach((s) => map.set(s.id, s));
      return Array.from(map.values());
    }

    /*** Ya no será así hay que validar */
    async checkStatusOnFedex() {
      try {
        //const trackingNumber = '881991498461' ////// BORRARRRR!!!!!!!!

        /** Evaluar si checará los en pendiente en ruta o que status */
        const pendingShipments = await this.getShipmentsToValidate();

        this.logger.log(`📦🕐 ~ ShipmentsService ~ checkStatusOnFedex ~ pendingShipments ${pendingShipments.length}`)
        
        /** Por ahora solo esta revisando los envios faltaría un cron o en este mismo revisar las envios-carga */
        for (const shipment of pendingShipments) {
          this.logger.log("🚚 ~ ShipmentsService ~ checkStatusOnFedex ~ shipment:", shipment)
          
          try { // Cambiar...
            const shipmentInfo: FedExTrackingResponseDto = await this.fedexService.trackPackage(shipment.trackingNumber);
            console.log("🚀 ~ ShipmentsService ~ checkStatusOnFedex ~ shipmentInfo:", shipmentInfo)

            if(!shipmentInfo) {
              this.logger.log(`📦🚨 No se encontro información del Envió con Tracking number: ${shipment.trackingNumber}`);
              return `No se encontro información del Envió con Tracking number: ${shipment.trackingNumber}`;
            }

            const latestStatusDetail = shipmentInfo.output.completeTrackResults[0].trackResults[0].latestStatusDetail;
                    
            /*** Ejemplo: */
            /*{
              latestStatusDetail: {
                "code": "DE",
                "derivedCode": "DE",
                "statusByLocale": "Delivery exception",
                "description": "Delivery exception",
                "scanLocation": {
                  "city": "HERMOSILLO",
                  "stateOrProvinceCode": "SO",
                  "countryCode": "MX",
                  "residential": false,
                  "countryName": "Mexico"
                },
                "ancillaryDetails": [
                  {
                    "reason": "14",
                    "reasonDescription": "Return tracking number 289570198701",
                    "action": "No action is required.  The package is being returned to the shipper.",
                    "actionDescription": "Unable to deliver shipment, returned to shipper"
                  }
                ]
              },
            }*/

            this.logger.log(`📣 Último estatus: ${latestStatusDetail.statusByLocale}`);
            
            /*** Ver que hará en otros estatus ejemplo agregar no entregado */
            if (latestStatusDetail.code === 'DL') {
              const newShipmentStatus = new ShipmentStatus();
              const newIncome = new Income()
              const event = shipmentInfo.output.completeTrackResults[0].trackResults[0].scanEvents.find(event => event.eventType === "DL")

              newShipmentStatus.status = ShipmentStatusType.ENTREGADO; // o el status correspondiente

              const rawDate = event.date; // '2025-06-05T10:57:00-07:00'
              const eventDate = new Date(rawDate);
              
              console.log(`Fecha original (${event.date}):`, rawDate); 
              console.log('Fecha convertida (UTC):', eventDate.toISOString());

              newShipmentStatus.timestamp = eventDate;
              newShipmentStatus.notes = 'Actualizado por fedex API.';
              newShipmentStatus.shipment = shipment;

              shipment.status = ShipmentStatusType.ENTREGADO;
              shipment.statusHistory.push(newShipmentStatus);

              if(shipment.payment) {
                shipment.payment = {
                  ...shipment.payment,
                  status: PaymentStatus.PAID
                }
              }
                          
              /// Agregar nuevo income 
              newIncome.trackingNumber = shipment.trackingNumber;
              newIncome.subsidiary = shipment.subsidiary;
              newIncome.date = eventDate;
              newIncome.incomeType = IncomeStatus.ENTREGADO;
              newIncome.shipmentType = ShipmentType.FEDEX;

              /** El costo va a depender de la sucursal falta agregar eso */
              newIncome.cost = this.PRECIO_ENTREGADO

              await this.shipmentRepository.save(shipment);
              await this.incomeRepository.save(newIncome);
            } else if(latestStatusDetail.code === 'DE') {
              const newShipmentStatus = new ShipmentStatus();
              const newIncome = new Income()
              const reason = latestStatusDetail.ancillaryDetails[0].reason +" - "+ latestStatusDetail.ancillaryDetails[0].actionDescription
              const event = shipmentInfo.output.completeTrackResults[0].trackResults[0].scanEvents.find(event => event.eventType === "DE")

              newShipmentStatus.status = ShipmentStatusType.NO_ENTREGADO; // o el status correspondiente

              const rawDate = event.date; // '2025-06-05T10:57:00-07:00'
              const eventDate = new Date(rawDate);
              
              console.log(`Fecha original (${event.date}):`, rawDate); 
              console.log('Fecha convertida (UTC):', eventDate.toISOString());

              newShipmentStatus.timestamp = eventDate;
              newShipmentStatus.notes = reason;
              newShipmentStatus.shipment = shipment;
              newShipmentStatus.exceptionCode = latestStatusDetail.ancillaryDetails[0].reason;

              shipment.status = ShipmentStatusType.NO_ENTREGADO;
              shipment.statusHistory.push(newShipmentStatus);
                          
              /// Agregar nuevo income 
              newIncome.trackingNumber = shipment.trackingNumber;
              newIncome.subsidiary = shipment.subsidiary;
              newIncome.date = eventDate;
              newIncome.incomeType = IncomeStatus.NO_ENTREGADO;
              newIncome.notDeliveryStatus = latestStatusDetail.ancillaryDetails[0].reason; // Codigo especifico del por que paso eso: 14 - 07 - 08 -17 -03
              newIncome.shipmentType = ShipmentType.FEDEX;

              /** El costo va a depender de la sucursal falta agregar eso */
              newIncome.cost = this.PRECIO_ENTREGADO

              await this.shipmentRepository.save(shipment);
              await this.incomeRepository.save(newIncome);
            }


          } catch (err) {
            console.error(`🚨 Error tracking ${shipment.trackingNumber}:`, err.message);
          }
        }

      } catch( error) {
        console.log("🚨 error: ", error)
      }
    }
  /****************************************************************************************** */


}



