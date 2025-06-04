export enum ShipmentStatusType {
  RECOLECCION = 'recoleccion',
  PENDIENTE = 'pendiente',
  EN_RUTA = 'en_ruta',
  ENTREGADO = 'entregado',
  NO_ENTREGADO = 'no_entregado',
}

export enum ShipmentFedexStatusType {
  Delivered = 'Delivered',
  AtLocalFedExFacility = 'At local FedEx facility',
  OnTheWay = 'On the way',
  OnFedExVehicleForDelivery = 'On FedEx vehicle for delivery',
  DepartedFedExHub = 'Departed FedEx hub',
  ArrivedAtFedExHub = 'Arrived at FedEx hub',
  LeftFedExOriginFacility = 'Left FedEx origin facility',
  PickedUp = 'Picked up',
  ShipmentInformationSentToFedEx = 'Shipment information sent to FedEx'
}

export enum ShipmentCanceledStatus {
  
}
