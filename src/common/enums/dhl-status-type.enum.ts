/**
 * Códigos de entrega EXCLUSIVOS de DHL (capa de código por carrier).
 *
 * Son un namespace propio, independiente de los códigos DEX numéricos de FedEx
 * ('03'/'07'/'08'/'67'…): al usar abreviaturas alfabéticas nunca chocan con los
 * filtros cableados de FedEx sobre `shipment_status.exceptionCode`.
 *
 * Cada código se traduce a la capa canónica interna (`ShipmentStatusType`) vía
 * `mapDhlCodeToInternal` en `src/utils/dhl.utils.ts`.
 */
export enum DhlStatusType {
  OK = 'OK', // POD / Entregado        -> entregado        (cobra, terminal)
  NH = 'NH', // No estaba / ausente     -> cliente_no_disponible
  BA = 'BA', // Dirección incorrecta    -> direccion_incorrecta
  RD = 'RD', // Rechazado / rehusado    -> rechazado
  CM = 'CM', // Cambio de domicilio     -> cambio_domicilio
}
