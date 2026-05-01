// ==========================================
// Sub-modelos (Componentes reutilizables)
// ==========================================

export interface LocationDto {
  airportCode: string;
  locationCode: string;
  locationName: string;
}

export interface AddressDto {
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  stateProvince: string;
  countryCode: string;
}

export interface PartyDto {
  accountNumber: string;
  name: string;
  address: AddressDto;
}

export interface LastEventDto {
  timestampCode: string;
  timestampDescription: string;
  timestampDateTime: string;
  locationCode: string;
  locationName: string;
}

export interface TimestampDto {
  timestampCode: string;
  timestampDescription: string;
  timestampDateTime: string;
  locationCode: string;
  locationName: string;
  journeyID?: string;
  signatory?: string;
  remarks?: string;
}

export interface MasterbillDto {
  masterbillNumber: string;
  carrier: {
    name: string;
    standardCarrierCode: string;
    bookingReference: string;
  };
}

export interface TransportUnitDto {
  transportUnitID: string;
  transportUnitType: string;
  sealNumbers: string[];
  timestamps: TimestampDto[];
}

export interface TransportLegDto {
  vesselName: string;
  vesselLloydsNumber: string;
  journeyID: string;
  modeOfTransport: string;
  // Nota: El JSON trae un campo con caracteres especiales, lo mapeamos así:
  "legType(in testing)"?: string; 
  portOfLoading: LocationDto;
  portOfUnloading: LocationDto;
  estimatedDepartureDate: string;
  estimatedArrivalDate: string;
  actualDepartureDate: string;
  actualArrivalDate: string;
}

export interface ExceptionDto {
  exceptionCode: string;
  exceptionDescription: string;
  exceptionType: string;
  exceptionDateTime: string;
  closureDateTime: string;
  remarks: string;
  responsibleParty: string;
}

export interface ReferenceDto {
  type: string;
  number: string;
}

// ==========================================
// Modelos de Emisiones (Emissions)
// ==========================================

export interface DistanceDto {
  uom: string;
  pickup: string;
  mainHaul: string;
  delivery: string;
  totalDistance: string;
}

export interface PrimaryEnergyDto {
  uom: string;
  totalTankToWheel: string;
  totalWellToWheel: string;
}

export interface CarbonDioxideEquivalentsDto {
  uom: string;
  pickupTankToWheel: string;
  pickupWellToWheel: string;
  mainHaulTankToWheel: string;
  mainHaulWellToWheel: string;
  deliveryTankToWheel: string;
  deliveryWellToWheel: string;
  stationHandlingTankToWheel: string;
  stationHandlingWellToWheel: string;
  totalTankToWheel: string;
  totalWellToWheel: string;
}

export interface EmissionMetricDto {
  uom: string;
  totalTankToWheel: string;
  totalWellToWheel: string;
}

export interface EmissionsDto {
  distance: DistanceDto;
  primaryEnergy: PrimaryEnergyDto;
  carbonDioxideEquivalents: CarbonDioxideEquivalentsDto;
  nitrogenOxides: EmissionMetricDto;
  sulfurDioxides: EmissionMetricDto;
  nonMethaneHydrocarbons: EmissionMetricDto;
  particles: EmissionMetricDto;
}

// ==========================================
// Entidades Principales
// ==========================================

export interface DhlShipmentDetailsDto {
  housebillNumber: string;
  externalBookingID: string;
  phase: string;
  origin: LocationDto;
  destination: LocationDto;
  shipper: PartyDto;
  consignee: PartyDto;
  modeOfTransport: string;
  totalPackages: string;
  totalWeight: string;
  totalWeightUom: string;
  totalVolume: number;
  totalVolumeUom: string;
  totalChargeable: number;
  totalChargeableUom: string;
  serviceCode: string;
  serviceProduct: string;
  paymentTerms: string;
  expressBOLFlag: boolean;
  warehouseUpdateFlag: boolean;
  incoterms: string;
  goodsDescription: string;
  status: string;
  lastEvent: LastEventDto;
  timestamps: TimestampDto[];
  masterbills: MasterbillDto[];
  transportUnits: TransportUnitDto[];
  transportLegs: TransportLegDto[];
  exceptions: ExceptionDto[];
  references: ReferenceDto[];
  emissions: EmissionsDto;
}

export interface ShipmentTrackingDto {
  queryID: string;
  queryIDType: string;
  shipment: DhlShipmentDetailsDto;
}

// ==========================================
// DTO Raíz (El que usarás como tipo de retorno)
// ==========================================
export interface DhlTrackingResponseDto {
  shipmentTracking: ShipmentTrackingDto;
}