import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import * as XLSX from 'xlsx';
import { FedexService } from './fedex.service';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { parseDynamicSheet } from 'src/utils/layout-parsers.util';
import { TrackingResponseDto } from './dto/fedex/tracking-response.dto';
import { scanEventsFilter } from 'src/utils/scan-events-filter';
import { ParsedShipmentDto } from './dto/parsed-shipment.dto';
import { mapFedexStatusToLocalStatus } from 'src/utils/fedex-status-map.utils';
import { format } from 'date-fns';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { ScanEventDto } from './dto/fedex/scan-event.dto';
import { DhlShipmentDto } from './dto/dhl/dhl-shipment.dto';
import { Priority } from 'src/common/enums/priority.enum';
import { mapDhlStatusTextToEnum } from 'src/utils/dhl-status-map.utils';
import { Payment } from 'src/entities';
import { PaymentStatus } from 'src/common/enums/payment-status.enum';

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>,
    private readonly fedexService: FedexService
  ) { }

  async processScanEvents(scanEvents: ScanEventDto[], fedexShipmentData: TrackingResponseDto,  savedShipment: Shipment): Promise<ShipmentStatus[]>{
    const shipmentStatus: ShipmentStatus[] = [];
    const filteredScanEvents: ScanEventDto[] = [];
    let initialState: ScanEventDto;

    if(scanEvents.length === 0) {
      filteredScanEvents.push(...scanEventsFilter(fedexShipmentData.output.completeTrackResults[0].trackResults[0].scanEvents, "At local FedEx facility"));
      initialState = filteredScanEvents.find(scanEvent => scanEvent.eventDescription === "" && scanEvent.exceptionDescription ==="At local FedEx facility")
    } else {
      filteredScanEvents.push(...scanEvents);
      initialState = filteredScanEvents.find(scanEvent => scanEvent.eventDescription === "On the way" && scanEvent.exceptionDescription ==="A trusted third-party vendor is on the way with your package")
    }

    if(filteredScanEvents.length === 0) {
      filteredScanEvents.push(...scanEventsFilter(fedexShipmentData.output.completeTrackResults[0].trackResults[0].scanEvents, "On FedEx vehicle for delivery"))
    }

    for (const scanEvent of filteredScanEvents) {
        const isInicialState = scanEvent === initialState;
        const newShipmentStatus = new ShipmentStatus();
        const date = new Date(scanEvent.date);
        const formatted = format(date, 'yyyy-MM-dd HH:mm:ss');

        newShipmentStatus.status = isInicialState
          ? ShipmentStatusType.RECOLECCION
          : mapFedexStatusToLocalStatus(scanEvent.eventDescription);        
        newShipmentStatus.timestamp = formatted;
        newShipmentStatus.notes = isInicialState
          ? 'Paquete recogido en sucursal.'
          : 'Actualizado por sistema y validado con Fedex.';

        // ✅ Aquí asignas el shipment relacionado
        newShipmentStatus.shipment = savedShipment;
        shipmentStatus.push(newShipmentStatus);
    }

    return shipmentStatus;
  }

  async createShipmentHistory(shipment: ParsedShipmentDto, savedShipment: Shipment): Promise<ShipmentStatus[]> {
    try {
      const fedexShipmentData: TrackingResponseDto = await this.fedexService.trackPackage(shipment.trackingNumber);
      const scanEvents = scanEventsFilter(fedexShipmentData.output.completeTrackResults[0].trackResults[0].scanEvents, "A trusted third-party vendor is on the way with your package");
      const histories = await this.processScanEvents(scanEvents, fedexShipmentData, savedShipment);    

      return histories;
    } catch (error) {
      console.error(error);
      return []; // o lanza una excepción si prefieres
    }
  }


  /*** Ya no será así hay que validar */
  async checkStatusOnFedex() {
    try {
      /** Evaluar si checará los en pendiente en ruta o que status */
      const pendingShipments = await this.shipmentRepository.find(
        { 
          where: { 
            status: ShipmentStatusType.PENDIENTE 
          },
          relations: ['payment', 'statusHistory'] 
      });

      for (const shipment of pendingShipments) {
        this.logger.log("🚀 ~ ShipmentsService ~ checkStatusOnFedex ~ shipment:", shipment)
        
        try { // Cambiar...
          const shipmentInfo: TrackingResponseDto = await this.fedexService.trackPackage(shipment.trackingNumber);
          const status = shipmentInfo.output.completeTrackResults[0].trackResults[0].latestStatusDetail.statusByLocale;
          const scanEvents = scanEventsFilter(shipmentInfo.output.completeTrackResults[0].trackResults[0].scanEvents);

          //this.logger.log("🚀 ~ ShipmentsService ~ checkStatusOnFedex ~ status:", status)
          //this.logger.log("🚀 ~ ShipmentsService ~ checkStatusOnFedex ~ scanEvents:", scanEvents)
          
          if (status === 'Delivered') {
            const newShipmentStatus = new ShipmentStatus();
            newShipmentStatus.status = ShipmentStatusType.ENTREGADO; // o el status correspondiente
            newShipmentStatus.timestamp = new Date().toISOString();
            newShipmentStatus.notes = 'Actualizado por fedex API.';
            newShipmentStatus.shipment = shipment;

            shipment.status = ShipmentStatusType.ENTREGADO;
            shipment.statusHistory.push(newShipmentStatus);
            await this.shipmentRepository.save(shipment);
          }
        } catch (err) {
          console.error(`Error tracking ${shipment.trackingNumber}:`, err.message);
        }
      }

    } catch( error) {
      console.log("error: ", error)
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
        const histories = await this.createShipmentHistory(shipment, newShipment);
        newShipment.statusHistory = histories;
        newShipment.status = histories[0].status;
        newShipment.shipmentType = ShipmentType.FEDEX;

        /*const lastHistory = histories[histories.length - 1];
        console.log("🚀 ~ ShipmentsService ~ validateShipmentFedex ~ lastHistory:", lastHistory)
        const firstHistory = histories[0];
        console.log("🚀 ~ ShipmentsService ~ validateShipmentFedex ~ firstHistory:", firstHistory)*/


        if(shipment.payment){
          const newPayment: Payment = new Payment();
          const match = shipment.payment.match(/([0-9]+(?:\.[0-9]+)?)/);

          if(match) {
            const amount = parseFloat(match[1]);
            if(!isNaN(amount)) {
              newPayment.amount = amount;
              newPayment.status = PaymentStatus.FAILED
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
    parse(text: string): DhlShipmentDto {
      const lines = text.split('\n').map(l => l.trim());
      console.log("🚀 ~ ShipmentsService ~ parse ~ lines:", lines)

      const dto: DhlShipmentDto = {
        awb: '',
        origin: '',
        destination: '',
        shipmentTime: '',
        receiver: {
          name: '',
          contactName: '',
          address1: '',
          address2: '',
          city: '',
          state: '',
          zip: '',
          country: '',
          phone: '',
        },
        events: [],
      };

      for (const line of lines) {
        if (line.startsWith('AWB :')) dto.awb = line.replace('AWB :', '').trim();
        if (line.startsWith('Orig :')) dto.origin = line.replace('Orig :', '').trim();
        if (line.startsWith('Dest :')) dto.destination = line.replace('Dest :', '').trim();
        if (line.startsWith('Shipment Time :')) dto.shipmentTime = line.replace('Shipment Time :', '').trim();
        if (line.startsWith('Receiver Name :')) dto.receiver.name = line.replace('Receiver Name :', '').trim();
        if (line.startsWith('Address Line1 :')) dto.receiver.address1 = line.replace('Address Line1 :', '').trim();
        if (line.startsWith('Address Line2 :')) dto.receiver.address2 = line.replace('Address Line2 :', '').trim();
        if (line.startsWith('City :')) dto.receiver.city = line.replace('City :', '').trim();
        if (line.startsWith('Zip Code :')) dto.receiver.zip = line.replace('Zip Code :', '').trim();
        if (line.startsWith('Phone :')) dto.receiver.phone = line.replace('Phone :', '').trim();
        if (line.startsWith('Event :')) {
          const [, status, location, timestamp] = line.match(/Event : (.*?) at (.*?) on (.*)/) || [];
          if (status && location && timestamp) {
            dto.events.push({ status, location, timestamp });
          }
        }
      }

      return dto;
    }
    
    async createFromParsedDto(input: string) {
      const dto = this.parse(input);
      console.log('Parsed DTO:', dto);
      const shipment = new Shipment();

      shipment.trackingNumber = dto.awb;
      shipment.shipmentType = ShipmentType.FEDEX;
      shipment.recipientName = dto.receiver.name;
      shipment.recipientAddress = `${dto.receiver.address1} ${dto.receiver.address2}`.trim();
      shipment.recipientCity = dto.receiver.city;
      shipment.recipientZip = dto.receiver.zip;
      shipment.recipientPhone = dto.receiver.phone;
      shipment.status = ShipmentStatusType.PENDIENTE;
      shipment.priority = Priority.BAJA;
      shipment.shipmentType = ShipmentType.DHL;

      const commitDateTime = new Date(dto.shipmentTime);
      shipment.commitDate = new Date(commitDateTime.toISOString().split('T')[0]);
      shipment.commitTime = commitDateTime.toTimeString().split(' ')[0];

      shipment.statusHistory = dto.events.map(event => {
        const status = new ShipmentStatus();
        status.status = mapDhlStatusTextToEnum(event.status); // aquí el cambio clave
        status.timestamp = event.timestamp;
        status.notes = event.location; // puedes poner location como nota si no la necesitas separada
        return status;
      });

      //return this.shipmentRepository.save(shipment);
    }
  /******************************************* */
}



