import { DhlPartyDto } from "./dhl-party.dto";
import { DhlTrackingEventDto } from "./dhl-tracking-event.dto";

export class DhlShipmentDto {
  awb: string;
  origin: string;
  destination: string;
  shipmentTime: string;
  receiver: DhlPartyDto;
  events: DhlTrackingEventDto[];
}