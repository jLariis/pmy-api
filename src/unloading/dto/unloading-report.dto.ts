// src/unloading/dto/unloading-report.dto.ts
export class PackageDispatchDto {
  id: string;
  trackingNumber: string;
  firstDriverName: string | null;
}

export class ShipmentDto {
  id: string;
  trackingNumber: string;
  status: string;
  commitDateTime: Date;
  routeId: string;
  packageDispatch: PackageDispatchDto | null;
}

export class ChargeShipmentDto {
  id: string;
  trackingNumber: string;
  status: string;
  commitDateTime: Date;
  routeId: string;
  packageDispatch: PackageDispatchDto | null;
}

export class UnloadingReportDto {
  id: string;
  date: Date;
  subsidiary: {
    id: string;
    name: string;
  };
  shipments: ShipmentDto[];
  chargeShipments: ChargeShipmentDto[];
}
