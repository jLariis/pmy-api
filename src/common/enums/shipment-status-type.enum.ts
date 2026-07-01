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
  ENTREGADO_EN_BODEGA = 'entregado_en_bodega', // Entrega final al cliente en sucursal
  EN_BODEGA = 'en_bodega', // DESEMBARQUE - 67
  RETORNO_ABANDONO_FEDEX = 'retorno_abandono_fedex', //STAT14
  ESTACION_FEDEX = 'estacion_fedex', //STAT41
  LLEGADO_DESPUES = 'llegado_despues',//STAT31
  DIRECCION_INCORRECTA = 'direccion_incorrecta', //DEX03
  CLIENTE_NO_DISPONIBLE = 'cliente_no_disponible', //DEX08
  CAMBIO_FECHA_SOLICITADO = 'cambio_fecha_solicitado', //DEX17
  ACARGO_DE_FEDEX = 'acargo_de_fedex', // OD
  ENTREGADO_POR_FEDEX = 'entregado_por_fedex', // ED o DL después de un OD}
  DEMORA_EN_ENTREGA = 'demora_en_entrega', // DEX84 o STAT84
  EMPRESA_CERRADA = 'empresa_cerrada', // STAT42
  NO_SE_PUDO_RECOLECTAR_EL_COBRO = 'no_se_pudo_recolectar_el_cobro', // DEX93
  RESTRICCION_SEGURIDAD_UBICACION = 'restriccion_seguridad_ubicacion', // DEX05: "Location security restrictions - Delivery will be reattempted"
  OTRO = 'otro' // DEX93 falta definir
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

/**
 * Estados TERMINALES: el paquete ya llegó a un desenlace y NO debe contarse como
 * "pendiente" ni como "sin 67" (no se espera que reciba un 67 local).
 * Se usa para filtrar reportes (sin67/sin44/pendientes). Lista ajustable por negocio.
 */
export const TERMINAL_SHIPMENT_STATUSES: ShipmentStatusType[] = [
  ShipmentStatusType.ENTREGADO,
  ShipmentStatusType.ENTREGADO_POR_FEDEX,
  ShipmentStatusType.ENTREGADO_EN_BODEGA,
  ShipmentStatusType.DEVUELTO_A_FEDEX,
  ShipmentStatusType.RETORNO_ABANDONO_FEDEX,
  ShipmentStatusType.ES_OCURRE,
  ShipmentStatusType.ACARGO_DE_FEDEX,
];

/**
 * Estados que GENERAN INGRESO al actualizar (espejo de la lógica de
 * processMasterFedexUpdate → isChargeable): ENTREGADO (DL), RECHAZADO (07) y
 * CLIENTE_NO_DISPONIBLE (08, cobra en la 3ra visita acumulada).
 * OJO: ENTREGADO_POR_FEDEX NO genera ingreso (es el blindaje anti-cobro cuando
 * FedEx tomó el control). Se usa para resaltar en reportes.
 */
export const INCOME_GENERATING_STATUSES: ShipmentStatusType[] = [
  ShipmentStatusType.ENTREGADO,
  ShipmentStatusType.RECHAZADO,
  ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
];
