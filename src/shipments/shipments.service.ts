import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import * as XLSX from 'xlsx';
import { FedexService } from './fedex.service';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { getPriority, parseDynamicSheet, parseDynamicSheetCharge, parseDynamicSheetDHL } from 'src/utils/file-upload.utils';
import { scanEventsFilter } from 'src/utils/scan-events-filter';
import { ParsedShipmentDto } from './dto/parsed-shipment.dto';
import { mapFedexStatusToLocalStatus } from 'src/utils/fedex.utils';
import { endOfToday, format, startOfToday } from 'date-fns';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { Income, Payment, Subsidiary } from 'src/entities';
import { PaymentStatus } from 'src/common/enums/payment-status.enum';
import { DHLService } from './dhl.service';
import { DhlShipmentDto } from './dto/dhl/dhl-shipment.dto';
import { FedExScanEventDto, FedExTrackingResponseDto } from './dto/fedex/fedex-tracking-response.dto';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { Priority } from 'src/common/enums/priority.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import * as stringSimilarity from 'string-similarity';

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);
  private PRECIO_ENTREGADO = 59.51;
  private PRECIO_NO_ENTREGADO = 59.51;
  private PRECIO_DHL = 45.00;
  

  constructor(
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>,
    @InjectRepository(Income)
    private incomeRepository: Repository<Income>,
    @InjectRepository(Subsidiary)
    private subsidiaryRepository: Repository<Subsidiary>,    
    private readonly fedexService: FedexService,
    private readonly dhlService: DHLService,
    private readonly subsidiaryService: SubsidiariesService
  ) { }

  async processScanEvents(scanEvents: FedExScanEventDto[], fedexShipmentData: FedExTrackingResponseDto,  savedShipment: Shipment): Promise<ShipmentStatus[]>{
    const shipmentStatus: ShipmentStatus[] = [];
    const filteredScanEvents: FedExScanEventDto[] = [];

    if(scanEvents.length === 0) {
      filteredScanEvents.push(...scanEventsFilter(fedexShipmentData.output.completeTrackResults[0].trackResults[0].scanEvents, "At local FedEx facility"));
    } else {
      filteredScanEvents.push(...scanEvents);
    }

    if(filteredScanEvents.length === 0) {
      filteredScanEvents.push(...scanEventsFilter(fedexShipmentData.output.completeTrackResults[0].trackResults[0].scanEvents, "On FedEx vehicle for delivery"))
    }

    for (const scanEvent of filteredScanEvents) {
        const isInicialState = scanEvent.date === filteredScanEvents[filteredScanEvents.length - 1].date;
            
        const newShipmentStatus = new ShipmentStatus();
        const rawDate = scanEvent.date; // '2025-06-05T10:57:00-07:00'
        const eventDate = new Date(rawDate);
        
        newShipmentStatus.status = isInicialState
          ? ShipmentStatusType.RECOLECCION
          : mapFedexStatusToLocalStatus(scanEvent.eventDescription);        
        newShipmentStatus.timestamp = eventDate;
        newShipmentStatus.notes = this.generateNote(scanEvent, isInicialState);
       
        /** Tal vez esto se eliminará por que el cron será el que estará asignando los estatus */
        if (newShipmentStatus.status === ShipmentStatusType.NO_ENTREGADO) {
          newShipmentStatus.exceptionCode = scanEvent.exceptionCode;
        }

        // ✅ Aquí asignas el shipment relacionado
        newShipmentStatus.shipment = savedShipment;
        shipmentStatus.push(newShipmentStatus);
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

            /*** recordar que si esta al reves si es true es carga y si no es paquete normal */
            newIncome.cost = shipment.isPartOfCharge ? 0 : this.PRECIO_ENTREGADO

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

            /*** recordar que si esta al reves si es true es carga y si no es paquete normal */
            /*** Creo que esto dependera del cógigo */
            newIncome.cost = shipment.isPartOfCharge ? 0 : this.PRECIO_ENTREGADO

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

  async findAll() {
    return await this.shipmentRepository.find({
      relations: ['statusHistory', 'payment'],
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

  async validateShipmentFedex(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');

    const { buffer, originalname } = file;
    const duplicatedTrackings: any[] = [];

    if (!originalname.match(/\.(csv|xlsx?)$/i)) {
      throw new BadRequestException('Unsupported file type');
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    
    const shipmentsToSave: ParsedShipmentDto[] = parseDynamicSheet(sheet, {fileName: originalname});
    
    const newShipments: Shipment[] = [];

    for (const shipment of shipmentsToSave) {
      const exists = await this.existShipment(shipment.trackingNumber, shipment.recipientCity);

      if (exists) {
        duplicatedTrackings.push(shipment);
      } else {
        const payment: Payment = null;
        const newShipment: Shipment = await this.shipmentRepository.create({...shipment, payment})
        const fedexShipmentData: FedExTrackingResponseDto = await this.fedexService.trackPackage(shipment.trackingNumber);
        const histories = await this.createShipmentHistory(newShipment, fedexShipmentData);

        if(!shipment.commitDate) {
          const rawDate = fedexShipmentData.output.completeTrackResults[0].trackResults[0].standardTransitTimeWindow.window.ends; // Ej: '2025-06-05T10:57:00-07:00'
                    
          if(!rawDate){
            const defaultDay = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
            const [fecha] = defaultDay.split(' ');
            newShipment.commitDate = fecha;
            newShipment.commitTime = '18:00:00'
          } else {
            const formattedDateTime = format(
              new Date(rawDate.replace(/([-+]\d{2}:\d{2})$/, '')), 
              'yyyy-MM-dd HH:mm:ss'
            );
            console.log("🚀 ~ ShipmentsService ~ validateShipmentFedex ~ formattedDateTime:", formattedDateTime)  

            const [fecha, hora] = formattedDateTime.split(' ');
            newShipment.commitDate = fecha;
            newShipment.commitTime = hora
        
          }

        }

        newShipment.priority = getPriority(new Date(newShipment.commitDate))
        newShipment.subsidiary = await this.cityClasification(shipment.recipientCity)
        newShipment.statusHistory = histories;
        newShipment.status = histories[0].status;
        newShipment.receivedByName = fedexShipmentData.output.completeTrackResults[0].trackResults[0].deliveryDetails.receivedByName;
        newShipment.shipmentType = ShipmentType.FEDEX;
        newShipment.isPartOfCharge = shipment.isPartOfCharge;    

        if(shipment.payment){
          const newPayment: Payment = new Payment();
          const match = shipment.payment.match(/([0-9]+(?:\.[0-9]+)?)/);
          const isPaymentClomplete = histories.findIndex(history => history.status === ShipmentStatusType.ENTREGADO);

          if(match) {
            const amount = parseFloat(match[1]);
            if(!isNaN(amount)) {
              newPayment.amount = amount;
              newPayment.status =  isPaymentClomplete ? PaymentStatus.PAID : PaymentStatus.PENDING
            }
          }

          newShipment.payment = newPayment;
        }
        
        if(!newShipment.subsidiary) {
          /** Si no encontro la cuidad dentro de la normalización buscar la que trae en la Api de Fedex y asignarle sucursal */
          newShipment.subsidiary = await this.subsidiaryService.getByName(fedexShipmentData.output.completeTrackResults[0].trackResults[0].recipientInformation.address.city);
        }

        console.log("🚀 ~ ShipmentsService ~ validateShipmentFedex ~ newShipment.commitDate:", newShipment.commitDate)
        newShipments.push(newShipment);
      }
    }
    
    await this.shipmentRepository.save(newShipments);

    const datoToResponse = {
      saved: newShipments.length,
      duplicated: duplicatedTrackings.length,
      duplicatedTrackings,
    }

    this.logger.log(`🚀 ~ ShipmentsService ~ processExcelFile ~ datoToResponse: ${JSON.stringify(datoToResponse)}`)

    return datoToResponse;
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


  async validateMultipleSheetsShipmentFedex(file: Express.Multer.File) {
    this.logger.log(`📂 Start processing file: ${file?.originalname}`);

    if (!file) throw new BadRequestException('No file uploaded');

    const { buffer, originalname } = file;
    if (!originalname.toLowerCase().match(/\.(csv|xlsx?)$/)) {
      throw new BadRequestException('Unsupported file type');
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const potencialCity = await this.parseCityOfFile(originalname);
    this.logger.log(`📍 Potential subsidiary city: ${JSON.stringify(potencialCity)}`);

    const shipmentsToSave: ParsedShipmentDto[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const parsedShipments = parseDynamicSheet(sheet, { fileName: originalname, sheetName });
      shipmentsToSave.push(...parsedShipments);
    }

    this.logger.log(`🚚📦 Shipments extracted from file...`);

    const result = {
      saved: 0,
      failed: 0,
      duplicated: 0,
      duplicatedTrackings: [] as ParsedShipmentDto[],
      failedTrackings: [] as { trackingNumber: string; reason: string }[],
    };

    for (const shipment of shipmentsToSave) {
      const exists = await this.existShipment(shipment.trackingNumber, shipment.recipientCity);
      if (exists) {
        this.logger.log(`🚩 Duplicated shipment: ${shipment.trackingNumber} - ${shipment.recipientCity}`);
        result.duplicated++;
        result.duplicatedTrackings.push(shipment);
        continue;
      }

      const newShipment = this.shipmentRepository.create({
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

      let fedexShipmentData: FedExTrackingResponseDto;

      try {
        fedexShipmentData = await this.fedexService.trackPackage(shipment.trackingNumber);
      } catch (err) {
        result.failed++;
        result.failedTrackings.push({
          trackingNumber: shipment.trackingNumber,
          reason: `Error al obtener tracking FedEx: ${err.message}`,
        });
        continue;
      }

      const histories = await this.createShipmentHistory(newShipment, fedexShipmentData);
      const trackResult = fedexShipmentData.output.completeTrackResults[0]?.trackResults[0];

      if (!shipment.commitDate) {
        this.logger.log(`📅 Shipment without commitDate — getting from FedEx data`);
        const rawDate = trackResult?.standardTransitTimeWindow?.window?.ends;
        const formatted = rawDate
          ? format(new Date(rawDate.replace(/([-+]\d{2}:\d{2})$/, '')), 'yyyy-MM-dd HH:mm:ss')
          : format(new Date(), 'yyyy-MM-dd HH:mm:ss');

        const [fecha, hora = '18:00:00'] = formatted.split(' ');
        newShipment.commitDate = fecha;
        newShipment.commitTime = hora;
      }

      newShipment.priority = getPriority(new Date(newShipment.commitDate));
      newShipment.subsidiary = await this.cityClasification(shipment.recipientCity);
      newShipment.statusHistory = histories;
      newShipment.status = histories[0]?.status;
      newShipment.receivedByName = trackResult?.deliveryDetails?.receivedByName;
      newShipment.shipmentType = ShipmentType.FEDEX;

      // Procesar pago si aplica
      if (shipment.payment) {
        this.logger.log(`💵 Shipment includes payment...`);
        const match = shipment.payment.match(/([0-9]+(?:\.[0-9]+)?)/);
        const isPaymentComplete = histories.some(h => h.status === ShipmentStatusType.ENTREGADO);
        if (match) {
          const amount = parseFloat(match[1]);
          if (!isNaN(amount) && amount > 0) {
            const newPayment = new Payment();
            newPayment.amount = amount;
            newPayment.status = isPaymentComplete ? PaymentStatus.PAID : PaymentStatus.PENDING;
            newShipment.payment = newPayment;
          }
        }
      }

      // Subsidiaria por fallback
      if (!newShipment.subsidiary) {
        this.logger.log(`📍 Subsidiary not found, checking FedEx data`);
        const parsedSubsidiary = await this.subsidiaryService.getByName(
          trackResult?.recipientInformation?.address?.city
        );
        newShipment.subsidiary = parsedSubsidiary ?? potencialCity;
        this.logger.log(`📍 Assigned subsidiary: ${JSON.stringify(newShipment.subsidiary)}`);
      }

      // Rellenar ciudad si está vacía
      if (!newShipment.recipientCity) {
        newShipment.recipientCity = newShipment.subsidiary.name;
      }

      try {
        const savedShipment = await this.shipmentRepository.save(newShipment);
        result.saved++;

        // Generar income si aplica
        if ([ShipmentStatusType.ENTREGADO, ShipmentStatusType.NO_ENTREGADO].includes(savedShipment.status)) {
          const matchedHistory = histories.find(h => h.status === savedShipment.status);
          if (matchedHistory) {
            await this.generateIncomes(savedShipment, fedexShipmentData, matchedHistory.timestamp);
          }
        }

      } catch (err) {
        result.failed++;
        result.failedTrackings.push({
          trackingNumber: newShipment.trackingNumber,
          reason: `Error al guardar shipment: ${err.message}`,
        });
      }
    }

    this.logger.log(`✅ Resultado FedEx: ${JSON.stringify(result)}`);
    return result;
  }

  
  private async saveShipmentsInChunks(
    shipments: Shipment[],
    chunkSize = 20,
  ): Promise<{ saved: Shipment[]; failed: { shipment: Shipment; reason: string }[] }> {
    const saved: Shipment[] = [];
    const failed: { shipment: Shipment; reason: string }[] = [];

    for (let i = 0; i < shipments.length; i += chunkSize) {
      const chunk = shipments.slice(i, i + chunkSize);
      const results = await Promise.allSettled(chunk.map(s => this.shipmentRepository.save(s)));

      results.forEach((result, idx) => {
        const shipment = chunk[idx];

        if (result.status === 'fulfilled') {
          saved.push(result.value);
        } else {
          failed.push({
            shipment,
            reason: result.reason?.message || 'Unknown error',
          });
          this.logger.error(`❌ Error saving shipment ${shipment.trackingNumber}: ${result.reason}`);
        }
      });
    }

    return { saved, failed };
  }

  private async generateIncomes(shipment: Shipment, fedexShipmentData: FedExTrackingResponseDto, eventDate: Date) {
    if (!shipment.trackingNumber || !eventDate || !shipment.subsidiary) {
      console.log("🚀 ~ ShipmentsService ~ generateIncomes ~ shipment.subsidiary:", shipment.subsidiary)
      console.log("🚀 ~ ShipmentsService ~ generateIncomes ~ eventDate:", eventDate)
      console.log("🚀 ~ ShipmentsService ~ generateIncomes ~ shipment.trackingNumber:", shipment.trackingNumber)
      throw new Error(`Datos incompletos para generar income del tracking ${shipment.trackingNumber}`);
    }

    const trackResult = fedexShipmentData.output.completeTrackResults[0]?.trackResults[0];
    const latestStatusDetail = trackResult?.latestStatusDetail;

    let incomeType: IncomeStatus;
    let incomeSubType = '';

    switch (shipment.status) {
      case ShipmentStatusType.ENTREGADO:
        incomeType = IncomeStatus.ENTREGADO;
        break;

      case ShipmentStatusType.NO_ENTREGADO:
        incomeType = IncomeStatus.NO_ENTREGADO;
        incomeSubType = latestStatusDetail?.ancillaryDetails?.[0]?.reason ?? '';
        break;

      default:
        throw new Error(`Unhandled shipment status: ${shipment.status}`);
    }

    const newIncome = this.incomeRepository.create({
      trackingNumber: shipment.trackingNumber,
      subsidiary: shipment.subsidiary,
      date: eventDate,
      incomeType,
      notDeliveryStatus: incomeSubType,
      shipmentType: ShipmentType.FEDEX,
      cost: shipment.isPartOfCharge ? 0 : this.PRECIO_ENTREGADO,
      isPartOfCharge: shipment.isPartOfCharge,
    });

    return this.incomeRepository.save(newIncome);
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
        newShipment.isPartOfCharge = shipment.isPartOfCharge;    

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
    const citiesNotClasified = [];
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
        //return await this.subsidiaryService.getByName("Cd Obregon");

      case "NAVOJOA":
        subsidiary = await this.subsidiaryService.getByName("Navojoa");
        //return await this.subsidiaryService.getByName("Navojoa");
      
        case "HUATABAMPO":
      case "ETCHOJOA":
      case "CRISTOBAL CAMPOS":
        subsidiary = await this.subsidiaryService.getByName("Huatabampo");
        //return await this.subsidiaryService.getByName("Huatabampo");
      case "PUERTO PE&ASCO":
      case "PENASCO":
      case "PUERTO PE?ASCO":
      case "PUERTO PENASCO":
      case "PUERTO PENAZCO":
        subsidiary = await this.subsidiaryService.getByName("Puerto Peñasco");
        //return await this.subsidiaryService.getByName("Puerto Peñasco");
      
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
        subsidiary = await this.subsidiaryService.getByName("Cabo San Lucas");
      default:
        citiesNotClasified.push(cityToClasificate);
    }
    
    console.log("🚀 ~ ShipmentsService ~ cityClasification ~ citiesNotClasified:", citiesNotClasified)
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

}



