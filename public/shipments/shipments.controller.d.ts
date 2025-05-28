import { ShipmentsService } from './shipments.service';
export declare class ShipmentsController {
    private readonly shipmentsService;
    constructor(shipmentsService: ShipmentsService);
    allShipments(): Promise<import("../entities").Shipment[]>;
    saveShipments(createShipmentDto: any): void;
    uploadFile(file: Express.Multer.File): Promise<{
        saved: number;
    }>;
}
