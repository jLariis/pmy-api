import { ShipmentFedexStatusType, ShipmentStatusType } from "src/common/enums/shipment-status-type.enum";

function isValidFedexStatus(status: string): status is ShipmentFedexStatusType {
  return Object.values(ShipmentFedexStatusType).includes(status as ShipmentFedexStatusType);
}

export function mapFedexStatusToLocalStatus(fedexStatusString: string): ShipmentStatusType {
  if (!isValidFedexStatus(fedexStatusString)) {
    return ShipmentStatusType.NO_ENTREGADO;
  }

  const fedexStatus = fedexStatusString as ShipmentFedexStatusType;

  switch (fedexStatus) {
    case ShipmentFedexStatusType.Delivered:
      return ShipmentStatusType.ENTREGADO;

    case ShipmentFedexStatusType.PickedUp:
    case ShipmentFedexStatusType.ShipmentInformationSentToFedEx:
    case ShipmentFedexStatusType.AtLocalFedExFacility:
      return ShipmentStatusType.RECOLECCION;

    case ShipmentFedexStatusType.LeftFedExOriginFacility:
    case ShipmentFedexStatusType.DepartedFedExHub:
    case ShipmentFedexStatusType.ArrivedAtFedExHub:
    case ShipmentFedexStatusType.OnTheWay:
    case ShipmentFedexStatusType.OnFedExVehicleForDelivery:
      return ShipmentStatusType.EN_RUTA;

    default:
      return ShipmentStatusType.NO_ENTREGADO;
  }
}
