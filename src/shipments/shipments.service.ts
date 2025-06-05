import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import * as XLSX from 'xlsx';
import { FedexService } from './fedex.service';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { parseDynamicSheet, parseDynamicSheetCharge } from 'src/utils/file-upload.utils';
import { TrackingResponseDto } from './dto/fedex/tracking-response.dto';
import { scanEventsFilter } from 'src/utils/scan-events-filter';
import { ParsedShipmentDto } from './dto/parsed-shipment.dto';
import { mapFedexStatusToLocalStatus } from 'src/utils/fedex.utils';
import { format } from 'date-fns';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { ScanEventDto } from './dto/fedex/scan-event.dto';
import { Payment } from 'src/entities';
import { PaymentStatus } from 'src/common/enums/payment-status.enum';
import { DHLService } from './dhl.service';
import { DhlShipmentDto } from './dto/dhl/dhl-shipment.dto';

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>,
    private readonly fedexService: FedexService,
    private readonly dhlService: DHLService
  ) { }

  async processScanEvents(scanEvents: ScanEventDto[], fedexShipmentData: TrackingResponseDto,  savedShipment: Shipment): Promise<ShipmentStatus[]>{
    const shipmentStatus: ShipmentStatus[] = [];
    const filteredScanEvents: ScanEventDto[] = [];
    let initialState: ScanEventDto;

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
        const date = new Date(scanEvent.date);
        const formatted = format(date, 'yyyy-MM-dd HH:mm:ss');

        newShipmentStatus.status = isInicialState
          ? ShipmentStatusType.RECOLECCION
          : mapFedexStatusToLocalStatus(scanEvent.eventDescription);        
        newShipmentStatus.timestamp = formatted;
        newShipmentStatus.notes = this.generateNote(scanEvent, isInicialState);

        // ✅ Aquí asignas el shipment relacionado
        newShipmentStatus.shipment = savedShipment;
        shipmentStatus.push(newShipmentStatus);
    }

    return shipmentStatus;
  }

  /** Este esta de mas refactorizar */
  async createShipmentHistory(shipment: ParsedShipmentDto, savedShipment: Shipment, fedexShipmentData: TrackingResponseDto): Promise<ShipmentStatus[]> {
    try {
      const scanEvents = scanEventsFilter(fedexShipmentData.output.completeTrackResults[0].trackResults[0].scanEvents, "A trusted third-party vendor is on the way with your package");
      const histories = await this.processScanEvents(scanEvents, fedexShipmentData, savedShipment);    

      return histories;
    } catch (error) {
      console.error(error);
      return []; // o lanza una excepción si prefieres
    }
  }

  private generateNote(scanEvent: ScanEventDto, isInitialState: boolean) {
    console.log("🚀 ~ ShipmentsService ~ generateNote ~ isInitialState:", isInitialState) 
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
      const pendingShipments = await this.shipmentRepository.find(
        { 
          where: { 
            status: ShipmentStatusType.PENDIENTE,
            shipmentType: ShipmentType.FEDEX
          },
          relations: ['payment', 'statusHistory'] 
      });

      for (const shipment of pendingShipments) {
        this.logger.log("🚚 ~ ShipmentsService ~ checkStatusOnFedex ~ shipment:", shipment)
        
        try { // Cambiar...
          const shipmentInfo: TrackingResponseDto = await this.fedexService.trackPackage(shipment.trackingNumber);

          if(!shipmentInfo) {
            this.logger.log(`📦🚨 No se encontro información del Envió con Tracking number: ${shipment.trackingNumber}`);
            return `No se encontro información del Envió con Tracking number: ${shipment.trackingNumber}`;
          }

          const status = shipmentInfo.output.completeTrackResults[0].trackResults[0].latestStatusDetail.statusByLocale;

          this.logger.log(`📣 Último estatus: ${status}`);
          
          if (status === 'Delivered') {
            const newShipmentStatus = new ShipmentStatus();
            newShipmentStatus.status = ShipmentStatusType.ENTREGADO; // o el status correspondiente
            newShipmentStatus.timestamp = new Date().toISOString();
            newShipmentStatus.notes = 'Actualizado por fedex API.';
            newShipmentStatus.shipment = shipment;

            shipment.status = ShipmentStatusType.ENTREGADO;
            shipment.statusHistory.push(newShipmentStatus);
            shipment.payment = {
              ...shipment.payment,
              status: PaymentStatus.PAID
            }
            // Modificar la parte del payment

            await this.shipmentRepository.save(shipment);
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
        const fedexShipmentData: TrackingResponseDto = await this.fedexService.trackPackage(shipment.trackingNumber);
        const histories = await this.createShipmentHistory(shipment, newShipment,fedexShipmentData);
        newShipment.statusHistory = histories;
        newShipment.status = histories[0].status;
        newShipment.receivedByName = fedexShipmentData.output.completeTrackResults[0].trackResults[0].deliveryDetails.receivedByName;
        newShipment.shipmentType = ShipmentType.FEDEX;
        newShipment.isNotIndividualBilling = shipment.isNotIndividualBilling;

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
  async validateDataforTracking(trackingNumber: string) {
    const shipmentInfo: TrackingResponseDto = await this.fedexService.trackPackage(trackingNumber)
    console.log("🚀 ~ ShipmentsService ~ validateDataforTracking ~ shipmentInfo:", shipmentInfo)

    const scanEvents = scanEventsFilter(shipmentInfo.output.completeTrackResults[0].trackResults[0].scanEvents);
    
    console.log("🚀 ~ ShipmentsService ~ validateDataforTracking ~ scanEvents:", scanEvents)

    return scanEvents;

    /* for (const shipment of shipmentsToSave) {
      const exists = await this.existShipment(shipment.trackingNumber, shipment.recipientCity);

      if (exists) {
        duplicatedTrackings.push(shipment);
      } else {
        const newShipment: Shipment = await this.shipmentRepository.create(shipment)
        const histories = await this.createShipmentHistory(shipment, newShipment);
        newShipment.statusHistory = histories;
        newShipment.status = histories[0].status;
        newShipment.shipmentType = ShipmentType.FEDEX;
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

    return datoToResponse;*/
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
}



