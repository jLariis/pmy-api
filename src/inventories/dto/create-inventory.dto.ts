import { InventoryType } from "src/common/enums/inventory-type.enum";
import { ChargeShipment, Shipment, Subsidiary } from "src/entities";

export class CreateInventoryDto {
    inventoryDate?: Date;
    shipments: string[];
    chargeShipments: string[];
    subsidiary: Subsidiary;
    type: InventoryType;
}
