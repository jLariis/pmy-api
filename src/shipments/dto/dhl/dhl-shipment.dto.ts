export interface DhlShipmentDto {
  awb: string;
  pid?: string; // <-- Nueva propiedad para almacenar el JD / JJD específico de la pieza
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
  remesas?: string[];
  /** yyyy-MM-dd: vencimiento (EDD) precargado cuando el origen es el Excel de DHL. */
  dueDate?: string;
  /** true = la pieza no cruzó con la hoja Shipment (sin dirección/CP reales). */
  incomplete?: boolean;
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