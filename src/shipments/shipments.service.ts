import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import * as XLSX from 'xlsx';
import { FedexService } from './fedex.service';
import { ShipmentStatus } from 'src/entities/shipment-status.entity';
import { detectLayoutType } from 'src/utils/file-detector.util';
import { parseByLayout } from 'src/utils/layout-parsers.util';

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>,
    private readonly fedexService: FedexService
  ) { }

  async create() {

  }

  async processExcelFile(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');

    const { buffer, originalname } = file;
    if (!originalname.match(/\.(csv|xlsx?)$/i)) {
      throw new BadRequestException('Unsupported file type');
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const isCSV = originalname.toLowerCase().endsWith('.csv');

    // Detect layout
    const layoutType = detectLayoutType(sheet);

    if (!layoutType) {
      throw new BadRequestException('Layout not recognized');
    }

    // Parse to uniform shipments
    const shipments = parseByLayout(sheet, layoutType, isCSV);

    // Filtrar envíos para insertar sólo los que NO existen aún por trackingNumber
    const trackingNumbers = shipments.map(s => s.trackingNumber);

    // Buscar los que ya existen
    const existingShipments = await this.shipmentRepository.find({
      where: trackingNumbers.map(trackingNumber => ({ trackingNumber })),
      select: ['trackingNumber'],
    });
    const existingTrackingNumbers = new Set(existingShipments.map(s => s.trackingNumber));

    // Filtrar sólo los nuevos
    const newShipments = shipments.filter(s => !existingTrackingNumbers.has(s.trackingNumber));

    if (newShipments.length === 0) {
      return { saved: 0, message: 'Todos los trackingNumbers ya existen en la base de datos.' };
    }

    const saved = await this.shipmentRepository.save(newShipments);
    return { saved: saved.length };
  }

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

      try {
          const status = await this.fedexService.trackPackage(pendingShipments[0].trackingNumber);
          this.logger.log(`🚀 ~ ShipmentsService ~ checkStatusOnFedex ~ status: ${status}`)
          this.logger.log(`🚀 ~ ShipmentsService ~ checkStatusOnFedex ~ pendingShipments[0]: ${pendingShipments[0]}`)
          
          if (status === 'Delivered') {
            const newShipmentStatus = new ShipmentStatus();
            newShipmentStatus.status = ShipmentStatusType.ENTREGADO; // o el status correspondiente
            newShipmentStatus.timestamp = new Date().toISOString();
            newShipmentStatus.notes = 'Actualizado por cron job automático';
            newShipmentStatus.shipment = pendingShipments[0];

            pendingShipments[0].status = ShipmentStatusType.ENTREGADO;
            pendingShipments[0].statusHistory.push(newShipmentStatus);
            await this.shipmentRepository.save(pendingShipments[0]);
          }
        } catch (err) {
          console.error(`Error tracking ${pendingShipments[0].trackingNumber}:`, err.message);
        }


      /*for (const shipment of pendingShipments) {
        this.logger.log("🚀 ~ ShipmentsService ~ checkStatusOnFedex ~ shipment:", shipment)

        try {
          const status = await this.fedexService.trackPackage(shipment.trackingNumber);
          this.logger.log("🚀 ~ ShipmentsService ~ checkStatusOnFedex ~ status:", status)
          
          if (status === 'Delivered') {
            const newShipmentStatus = new ShipmentStatus();
            newShipmentStatus.status = ShipmentStatusType.ENTREGADO; // o el status correspondiente
            newShipmentStatus.timestamp = new Date().toISOString();
            newShipmentStatus.notes = 'Actualizado por cron job automático';
            newShipmentStatus.shipment = shipment;

            shipment.status = ShipmentStatusType.ENTREGADO;
            shipment.statusHistory.push(newShipmentStatus);
            await this.shipmentRepository.save(shipment);
          }
        } catch (err) {
          console.error(`Error tracking ${shipment.trackingNumber}:`, err.message);
        }
      }*/

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
}
