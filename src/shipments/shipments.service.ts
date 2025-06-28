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
import { endOfToday, format, startOfToday } from 'date-fns';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { Income, Payment, Subsidiary } from 'src/entities';
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

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);
  private PRECIO_ENTREGADO = 59.51;

  /*** Temporal */
  private citiesNotClasified = [];

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
    private readonly subsidiaryService: SubsidiariesService
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

  private async processScanEventsToStatuses(
    scanEvents: FedExScanEventDto[],
    shipment: Shipment
  ): Promise<ShipmentStatus[]> {
    const statuses: ShipmentStatus[] = [];
    let hasException = false;
    let hasDelivered = false;

    // Ordenar eventos por fecha ascendente
    const sortedEvents = scanEvents.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Mapear y construir la lista inicial de statuses
    for (const event of sortedEvents) {
      const code = event.derivedStatusCode;
      const mappedStatus = mapFedexStatusToLocalStatus(code, event.exceptionCode);
      /*if (mappedStatus === ShipmentStatusType.DESCONOCIDO) {
        // Opcional: log para estados desconocidos
        continue;
      }*/

      if (mappedStatus === ShipmentStatusType.NO_ENTREGADO) hasException = true;
      if (mappedStatus === ShipmentStatusType.ENTREGADO) hasDelivered = true;

      const statusEntry = new ShipmentStatus();
      statusEntry.shipment = shipment;
      statusEntry.status = mappedStatus;
      statusEntry.exceptionCode = event.exceptionCode || undefined;
      statusEntry.notes = event.exceptionCode
        ? `${event.exceptionCode} - ${event.exceptionDescription}`
        : `${event.eventType} - ${event.eventDescription}`;
      statusEntry.timestamp = new Date(event.date);

      statuses.push(statusEntry);

      // Log cada registro
      const logLine = `📝 [${shipment.trackingNumber}] Registrado status: ${statusEntry.status} - ${statusEntry.notes}`;
      this.logger.log(logLine);
      await this.appendLogToFile(`${logLine} at ${statusEntry.timestamp.toISOString()}`);
    }

    // Si hubo excepciones pero luego entrega, conservamos TODO
    if (hasException && hasDelivered) {
      const msg = `📦 [${shipment.trackingNumber}] Excepciones previas pero entrega exitosa. Conservando todos los estados.`;
      this.logger.log(msg);
      await this.appendLogToFile(msg);
      return statuses;
    }

    // Si no hubo entrega y sí excepciones, eliminar EN_RUTA posteriores al último NO_ENTREGADO
    if (!hasDelivered && hasException) {
      // Índice del último NO_ENTREGADO
      const lastNoEntIndex = statuses
        .map((s, i) => (s.status === ShipmentStatusType.NO_ENTREGADO ? i : -1))
        .filter((i) => i !== -1)
        .pop();

      if (lastNoEntIndex !== undefined && lastNoEntIndex < statuses.length - 1) {
        const removed = statuses.splice(lastNoEntIndex + 1);
        for (const rem of removed) {
          if (rem.status === ShipmentStatusType.EN_RUTA) {
            const warn = `🗑️ [${shipment.trackingNumber}] Eliminado EN_RUTA posterior a NO_ENTREGADO: ${rem.notes}`;
            this.logger.warn(warn);
            await this.appendLogToFile(warn);
          }
        }
      }
    }

    return statuses;
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

  /*** Ya no será así hay que validar */
  async checkStatusOnFedex() {
    try {
      /** Evaluar si checará los en pendiente en ruta o que status */
      const pendingShipments = await this.shipmentRepository.find({ 
        where: { 
          status: In([ShipmentStatusType.PENDIENTE, ShipmentStatusType.RECOLECCION]),
          shipmentType: ShipmentType.FEDEX
        },
        relations: ['payment', 'statusHistory'] 
      });

      this.logger.log(`📦🕐 ~ ShipmentsService ~ checkStatusOnFedex ~ pendingShipments ${pendingShipments.length}`)
      
      /** Por ahora solo esta revisando los envios faltaría un cron o en este mismo revisar las envios-carga */
      for (const shipment of pendingShipments) {
        this.logger.log("🚚 ~ ShipmentsService ~ checkStatusOnFedex ~ shipment:", shipment)
        
        try { // Cambiar...
          const shipmentInfo: FedExTrackingResponseDto = await this.fedexService.trackPackage(shipment.trackingNumber);

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

          /***** Tengo que agregar algo que valide el envio que sea carga_shipment y carga
           * Para cuando ya todos los envios que pertenecen a la carga esten cerrados va a generar el income
           * 
           */


          
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

  /** Nuevo método que toma todos los valores de Shipment y Charge */
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

  async existShipment(trackingNumber: string, recipientCity: string): Promise<boolean> {
    const [_, count] = await this.shipmentRepository.findAndCountBy({
      trackingNumber,
      recipientCity,
    });

    return count > 0;
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
  async processFileF2(file: Express.Multer.File, subsidiaryId: string) {
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
      chargeDate: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
      numberOfPackages: shipmentsToUpdate.length,
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
        date: new Date(),
      });

      await this.incomeRepository.save(newIncome);
    }

    return {
      migrated,
      notFound: notFoundTrackings,
      errors,
    };
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

  /*** ESTE ES EL BUENO */
  async validateMultipleSheetsShipmentFedexWithSubsidaryNew(
    file: Express.Multer.File,
    subsidiaryId: string
  ): Promise<Shipment[]> {
    if (!file) throw new BadRequestException('No file uploaded');

    const { buffer, originalname } = file;
    const duplicatedTrackings: any[] = [];
    const shipments: Shipment[] = [];

    if (!originalname.match(/\.(csv|xlsx?)$/i)) {
      throw new BadRequestException('Only .csv, .xls or .xlsx files are allowed');
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    for (const row of rows) {
      const trackingNumber = row['Tracking']?.toString().trim();

      if (!trackingNumber) continue;

      const existingShipment = await this.shipmentRepository.findOneBy({
        trackingNumber,
        subsidiaryId,
      });

      if (existingShipment) {
        duplicatedTrackings.push(trackingNumber);
        continue;
      }

      // Obtener datos de FedEx
      const fedexShipmentData = await this.fedexService.trackPackage(trackingNumber);

      const trackResults = fedexShipmentData.output.completeTrackResults[0].trackResults;

      // Combinar todos los scanEvents de todos los resultados
      const allScanEvents = trackResults.flatMap(result => result.scanEvents || []);

      const newShipment = this.shipmentRepository.create({
        trackingNumber,
        shipmentType: ShipmentType.FEDEX,
        subsidiaryId,
      });

      // Procesar todos los eventos
      const histories = await this.processScanEventsToStatuses(allScanEvents, newShipment);
      this.logger.debug(`📜 Historial generado para ${trackingNumber}: ${histories.map(h => h.status).join(", ")}`);

      // Seleccionar el trackResult más relevante (entregado, si existe)
      const trackResult = trackResults.find(r => r.latestStatusDetail?.derivedCode === 'DL') || trackResults[0];

      newShipment.statusHistory = histories;
      newShipment.status = histories[histories.length - 1]?.status;
      newShipment.receivedByName = trackResult?.deliveryDetails?.receivedByName || null;

      shipments.push(newShipment);
    }

    await this.shipmentRepository.save(shipments);

    this.logger.debug(`📦 Nuevos envíos creados: ${shipments.length}, Duplicados: ${duplicatedTrackings.length}`);

    return shipments;
  }


  async validateMultipleSheetsShipmentFedexWithSubsidary(file: Express.Multer.File, subsidiaryId?: string) {
    const startTime = Date.now(); // tiempo inicio

    this.logger.log(`📂 Iniciando procesamiento de archivo: ${file?.originalname}`);

    if (!file) throw new BadRequestException('No se subió ningún archivo');

    const { buffer, originalname } = file;
    if (!originalname.toLowerCase().match(/\.(csv|xlsx?)$/)) {
      throw new BadRequestException('Tipo de archivo no soportado');
    }

    const predefinedSubsidiary = subsidiaryId
      ? await this.subsidiaryService.findById(subsidiaryId)
      : null;

    if (subsidiaryId && !predefinedSubsidiary) {
      throw new BadRequestException(`Subsidiaria con ID '${subsidiaryId}' no encontrada`);
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const shipmentsToSave: ParsedShipmentDto[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const parsedShipments = parseDynamicSheet(sheet, { fileName: originalname, sheetName });
      shipmentsToSave.push(...parsedShipments);
    }

    this.logger.log(`📄 Total de envíos procesados desde archivo: ${shipmentsToSave.length}`);

    const result = {
      saved: 0,
      failed: 0,
      duplicated: 0,
      duplicatedTrackings: [] as ParsedShipmentDto[],
      failedTrackings: [] as { trackingNumber: string; reason: string }[],
    };

    const shipmentsWithError = {
      duplicated: [] as ParsedShipmentDto[],
      fedexError: [] as { trackingNumber: string; reason: string }[],
      saveError: [] as { trackingNumber: string; reason: string }[],
    };

    for (const shipment of shipmentsToSave) {
      const exists = await this.existShipment(shipment.trackingNumber, shipment.recipientCity);
      if (exists) {
        this.logger.warn(`🔁 Envío duplicado: ${shipment.trackingNumber}`);
        result.duplicated++;
        result.duplicatedTrackings.push(shipment);
        shipmentsWithError.duplicated.push(shipment);
        continue;
      }

      const newShipment = new Shipment();
      Object.assign(newShipment, {
        trackingNumber: shipment.trackingNumber,
        recipientName: shipment.recipientName,
        recipientAddress: shipment.recipientAddress,
        recipientCity: shipment.recipientCity,
        recipientZip: shipment.recipientZip,
        commitDate: shipment.commitDate,
        commitTime: shipment.commitTime,
        recipientPhone: shipment.recipientPhone,
        isPartOfCharge: shipment.isPartOfCharge,
      });

      this.logger.debug(`📦 Procesando tracking: ${newShipment.trackingNumber}`);

      let fedexShipmentData: FedExTrackingResponseDto;

      try {
        fedexShipmentData = await this.fedexService.trackPackage(shipment.trackingNumber);
        this.logger.debug(`📬 Datos FedEx recibidos para: ${shipment.trackingNumber}`);
      } catch (err) {
        const reason = `❌ Error FedEx (${shipment.trackingNumber}): ${err.message}`;
        this.logger.error(reason);
        result.failed++;
        result.failedTrackings.push({ trackingNumber: shipment.trackingNumber, reason });
        shipmentsWithError.fedexError.push({ trackingNumber: shipment.trackingNumber, reason });
        continue;
      }

      try {
        const trackResults = fedexShipmentData.output.completeTrackResults[0]?.trackResults;
        const allScanEvents = trackResults.flatMap(result => result.scanEvents || []);
        //const scanEvents = fedexShipmentData.output.completeTrackResults[0].trackResults[0].scanEvents;
        const histories = await this.processScanEventsToStatuses(allScanEvents, newShipment);
        
        const trackResult = trackResults.find(r => r.latestStatusDetail?.derivedCode === 'DL') || trackResults[0];
        this.logger.debug(`📜 Historial generado para ${shipment.trackingNumber}: ${histories.map(h => h.status).join(", ")}`);

        if (!shipment.commitDate) {
          const rawDate = trackResult?.standardTransitTimeWindow?.window?.ends;
          const formatted = rawDate
            ? format(new Date(rawDate.replace(/([-+]\d{2}:\d{2})$/, '')), 'yyyy-MM-dd HH:mm:ss')
            : format(new Date(), 'yyyy-MM-dd HH:mm:ss');
          const [fecha, hora = '18:00:00'] = formatted.split(' ');
          newShipment.commitDate = fecha;
          newShipment.commitTime = hora;
        }

        newShipment.priority = getPriority(new Date(newShipment.commitDate));
        newShipment.subsidiary = predefinedSubsidiary;
        newShipment.statusHistory = histories;
        newShipment.status = histories[histories.length - 1]?.status;
        newShipment.receivedByName = trackResult?.deliveryDetails?.receivedByName;
        newShipment.shipmentType = ShipmentType.FEDEX;

        this.logger.debug(`📌 Estatus inicial: ${newShipment.status} - Prioridad: ${newShipment.priority}`);

        if (shipment.payment) {
          const match = shipment.payment.match(/([0-9]+(?:\.[0-9]+)?)/);
          const isPaymentComplete = histories.some(h => h.status === ShipmentStatusType.ENTREGADO);
          if (match) {
            const amount = parseFloat(match[1]);
            if (!isNaN(amount) && amount > 0) {
              const newPayment = new Payment();
              newPayment.amount = amount;
              newPayment.status = isPaymentComplete ? PaymentStatus.PAID : PaymentStatus.PENDING;
              newShipment.payment = newPayment;
              this.logger.debug(`💰 Monto de pago: $${amount} - Estatus: ${newPayment.status}`);
            }
          }
        }

        if (!newShipment.recipientCity && predefinedSubsidiary) {
          newShipment.recipientCity = predefinedSubsidiary.name;
        }

        const savedShipment = await this.shipmentRepository.save(newShipment);
        result.saved++;

        if ([ShipmentStatusType.ENTREGADO, ShipmentStatusType.NO_ENTREGADO].includes(savedShipment.status)) {
          // Tomar la última historia cuyo status coincida
          const matchedHistory = histories
            .filter(h => h.status === savedShipment.status)
            .pop();

          if (!matchedHistory) {
            this.logger.warn(`⚠️ No se encontró matchedHistory para: ${savedShipment.trackingNumber}, status: ${savedShipment.status}`);
            return;
          }

          // Log genérico para ambos casos
          this.logger.log(`🧾 Generando income para ${savedShipment.trackingNumber} con status ${savedShipment.status}`);

          if (savedShipment.status === ShipmentStatusType.NO_ENTREGADO) {
            const ts = matchedHistory.timestamp.toISOString();
            const logLine1 = `🧾 matchedHistory.timestamp: ${ts}`;
            const logLine2 = `🧾 matchedHistory.exceptionCode: ${matchedHistory.exceptionCode}`;
            const logLine3 = `🧾 matchedHistory.notes: ${matchedHistory.notes}`;

            this.logger.log(logLine1);
            this.logger.log(logLine2);
            this.logger.log(logLine3);

            await this.appendLogToFile(`${logLine1} at ${ts}`);
            await this.appendLogToFile(`${logLine2} at ${ts}`);
            await this.appendLogToFile(`${logLine3} at ${ts}`);
          }

          // Finalmente, generamos el income pasando el timestamp y exceptionCode de la última historia
          await this.generateIncomes(
            savedShipment,
            matchedHistory.timestamp,
            matchedHistory.exceptionCode
          );

        } else {
          this.logger.warn(`🚫 No se generó income: status del envío ${savedShipment.status} no es elegible`);
        }

      } catch (err) {
        const reason = `❌ Error al guardar shipment ${shipment.trackingNumber}: ${err.message}`;
        this.logger.error(reason);
        result.failed++;
        result.failedTrackings.push({ trackingNumber: shipment.trackingNumber, reason });
        shipmentsWithError.saveError.push({ trackingNumber: shipment.trackingNumber, reason });
      }
    }

    const summarizedErrors = [
      ...shipmentsWithError.duplicated.map(s => ({ trackingNumber: s.trackingNumber, reason: "Duplicado" })),
      ...shipmentsWithError.fedexError,
      ...shipmentsWithError.saveError
    ];

    if (summarizedErrors.length > 0) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outputPath = path.join(__dirname, `../../logs/shipment-errors-${timestamp}.json`);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, JSON.stringify(shipmentsWithError, null, 2), 'utf-8');
      this.logger.warn(`⚠️ Errores registrados en archivo: ${outputPath}`);
    }

    const endTime = Date.now()                  // tiempo fin en ms
    const durationMs = endTime - startTime      // ms transcurridos
    const durationMin = (durationMs / 60000)    // lo convertimos a minutos
      .toFixed(2)                               // con dos decimales

    this.logger.log(`⏱️ Tiempo total de procesamiento: ${durationMin} minutos`);

    this.logger.log(`✅ Proceso finalizado: ${result.saved} guardados, ${result.duplicated} duplicados, ${result.failed} fallidos`);

    return {
      ...result,
      errors: summarizedErrors
    };
  }

  private async generateIncomes(shipment: Shipment, eventDate: Date, statusCode: string) {
    if (!shipment.trackingNumber || !eventDate || !shipment.subsidiary) {
      console.log("🚀 ~ ShipmentsService ~ generateIncomes ~ shipment.subsidiary:", shipment.subsidiary)
      console.log("🚀 ~ ShipmentsService ~ generateIncomes ~ eventDate:", eventDate)
      console.log("🚀 ~ ShipmentsService ~ generateIncomes ~ shipment.trackingNumber:", shipment.trackingNumber)
      throw new Error(`Datos incompletos para generar income del tracking ${shipment.trackingNumber}`);
    }

    let incomeType: IncomeStatus;
    let incomeSubType = '';

    switch (shipment.status) {
      case ShipmentStatusType.ENTREGADO:
        incomeType = IncomeStatus.ENTREGADO;
        break;

      case ShipmentStatusType.NO_ENTREGADO:
        incomeType = IncomeStatus.NO_ENTREGADO;
        incomeSubType = statusCode ?? '';
        break;

      default:
        throw new Error(`Unhandled shipment status: ${shipment.status}`);
    }

    /** Esta por el momento solo para fedex la parte del costo faltaria para dhl*/
    const newIncome = this.incomeRepository.create({
      trackingNumber: shipment.trackingNumber,
      subsidiary: shipment.subsidiary,
      date: eventDate,
      incomeType,
      notDeliveryStatus: incomeSubType,
      shipmentType: ShipmentType.FEDEX,
      cost: parseFloat(shipment.subsidiary.fedexCostPackage),
      shipmentId: shipment.id,
    });

    this.logger.log(`💸 Guardando income para ${shipment.trackingNumber}`);
    const savedIncome = await this.incomeRepository.save(newIncome);
    this.logger.log(`✅ Income guardado: ${savedIncome.id}`);
  }

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

  /*** Obtener KPI's de envios */
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
}



