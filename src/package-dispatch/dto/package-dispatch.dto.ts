import { DispatchStatus } from "src/common/enums/dispatch-enum"
import { Driver, Route, Shipment, Subsidiary, Vehicle } from "src/entities"

export class PackageDispatchDto {
  id: string
  trackingNumber: string
  status: DispatchStatus
  routes: Route[]
  drivers: Driver[]
  vehicle: Vehicle
  shipments: Shipment[]
  estimatedArrival: string
  startTime: string
  subsidiary: Subsidiary
}