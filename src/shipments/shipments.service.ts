import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
import { Payment, ShipmentStatus } from 'src/entities';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import { CreateShipmentDto } from './dto/create-shipment.dto';

@Injectable()
export class ShipmentsService {
  constructor(
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>
) { }

  async create() {

  }
  async processFile(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');

    const { buffer, originalname } = file;

    if (!originalname.match(/\.(csv|xlsx?)$/i)) {
      throw new BadRequestException('Unsupported file type');
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const jsonData: any[][] = XLSX.utils.sheet_to_json(sheet, {
      range: 6, // Desde fila 7 (índice 6)
      header: 1,
    });

    const consNumber = jsonData[0]?.[4];

    const today = new Date();
    const todayISO = today.toISOString();

    const isCSV = originalname.toLowerCase().endsWith('.csv');

    const shipments: any[] = jsonData
      .map((row) => {
        if (!row || row.length === 0) return null;

        const commitDate = new Date(row[5]); // Columna 5
        const daysDiff = (commitDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);

        let priority: 'alta' | 'media' | 'baja';
        if (daysDiff <= 0) priority = 'alta';
        else if (daysDiff <= 3) priority = 'media';
        else priority = 'baja';

        return {
          trackingNumber: row[0],                            // Col 0 (común)
          recipientName: isCSV ? row[13] : row[1],           // CSV → col 13, XLSX → col 1
          recipientAddress: isCSV ? row[14] : row[2],        // CSV → col 14, XLSX → col 2
          recipientCity: isCSV ? row[15] : row[3],           // CSV → col 15, XLSX → col 3
          recipientZip: isCSV ? row[18] : row[4],            // CSV → col 18, XLSX → col 4
          commitDate: isCSV ? row[20] : row[5],                                // Col 5
          commitTime: isCSV ? row[21] : row[6],                                // Col 6
          recipientPhone: isCSV ? row[23] : row[7],          // CSV → col 23, XLSX → col 7
          status: ShipmentStatusType.PENDIENTE,  
          payment: null,
          priority,
          statusHistory: [
            {
              status: ShipmentStatusType.RECOLECCION,
              timestamp: todayISO,
              notes: 'Paquete recogido en sucursal',
            },
          ],
          constNumber: consNumber
        };
      })
      .filter(Boolean);

    const result = await this.shipmentRepository.save(shipments);
    return { saved: result.length };
  }

  async findAll() {
    return await this.shipmentRepository.find({
      relations: ['statusHistory', 'payment']
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
