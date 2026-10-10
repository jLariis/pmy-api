import { InventoryType } from "src/common/enums/inventory-type.enum";
import { Subsidiary } from "src/entities";
import { InventoryRejectedTracking } from "src/entities/inventory.entity";

export class CreateInventoryDto {
    inventoryDate?: Date;
    shipments: string[];
    chargeShipments: string[];
    subsidiary: Subsidiary;
    type?: InventoryType;
    /** Nombre que mandaba el front (antes se ignoraba y todo quedaba "Inicial"). */
    inventoryType?: InventoryType;
    rejectedTrackings?: InventoryRejectedTracking[];
}
