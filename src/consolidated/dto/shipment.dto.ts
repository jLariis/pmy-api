import { Shipment } from "src/entities";

export class ShipmentConsolidatedDto extends Shipment {
  daysInRoute: number;
}