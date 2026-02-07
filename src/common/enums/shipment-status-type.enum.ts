export enum ShipmentStatusType {
  RECOLECCION = 'recoleccion',
  RECIBIDO_EN_BODEGA = 'recibido_en_bodega',
  PENDIENTE = 'pendiente',
  EN_RUTA = 'en_ruta', //
  EN_TRANSITO = 'en_transito', // SALIDA A RUTA
  ENTREGADO = 'entregado',
  NO_ENTREGADO = 'no_entregado', //PUEDE QUE SE ELIMINE
  DESCONOCIDO = 'desconocido',
  RECHAZADO = 'rechazado', // DEX07
  DEVUELTO_A_FEDEX = 'devuelto_a_fedex', // DEVOLUCION A FEDEX
  ES_OCURRE = 'es_ocurre', //HP - 015A
  EN_BODEGA = 'en_bodega', // DESEMBARQUE - 67
  RETORNO_ABANDONO_FEDEX = 'retorno_abandono_fedex', //STAT14
  ESTACION_FEDEX = 'estacion_fedex', //STAT41
  LLEGADO_DESPUES = 'llegado_despues',//STAT31
  DIRECCION_INCORRECTA = 'direccion_incorrecta', //DEX03
  CLIENTE_NO_DISPONIBLE = 'cliente_no_disponible', //DEX08
  CAMBIO_FECHA_SOLICITADO = 'cambio_fecha_solicitado', //DEX17
  ACARGO_DE_FEDEX = 'acargo_de_fedex', // OD
  ENTREGADO_POR_FEDEX = 'entregado_por_fedex', // ED o DL después de un OD
  //17 - 17 - A request was made to change this delivery date.
  //84
  //14
  //15
  //16 - Pago recibido por Fedex
  //A12 - 
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
  DEX08 = 'dex08',
  DEX07 = 'dex07',
  DEX03 = 'dex03'
}
