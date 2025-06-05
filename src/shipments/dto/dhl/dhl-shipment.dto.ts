import { DhlPartyDto } from "./dhl-party.dto";
import { DhlTrackingEventDto } from "./dhl-tracking-event.dto";

export interface DhlShipmentDto {
  awb: string;
  origin: string;
  destination: string;
  shipmentTime: string;
  product: string;
  pieces: number;
  weight: number;
  declaredValue?: number;
  description?: string;
  shipperAccount: string;
  payerAccount: string;
  receiver: {
    name: string;
    contactName: string;
    address1: string;
    address2: string;
    city: string;
    state: string;
    country: string;
    zip: string;
    phone: string;
    reference?: string;
  };
  events?: {
    awbPid: string;
    origin?: string;
    destination?: string;
    facilityId?: string;
    route?: string;
    code: string;
    eventDateTime: string;
    dataAvailable: string;
    remark: string;
  }[];
}