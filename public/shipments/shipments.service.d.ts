import { Repository } from 'typeorm';
import { Shipment } from 'src/entities/shipment.entity';
export declare class ShipmentsService {
    private shipmentRepository;
    constructor(shipmentRepository: Repository<Shipment>);
    create(): Promise<void>;
    processFile(file: Express.Multer.File): Promise<{
        saved: number;
    }>;
    findAll(): Promise<Shipment[]>;
    findOne(id: string): Promise<Shipment>;
    update(id: string, updateUserDto: any): Promise<import("typeorm").UpdateResult>;
    remove(id: string): Promise<import("typeorm").DeleteResult>;
}
