import { ShipmentConsolidatedDto } from "./shipment.dto";

export class ConsolidatedDto {
    shipments: ShipmentConsolidatedDto[];
    isConsolidatedComplete: boolean;
    consolidatedDate: Date;
}