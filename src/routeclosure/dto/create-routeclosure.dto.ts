import { Shipment, Subsidiary, User } from "src/entities";
import { PackageDispatch } from "src/entities/package-dispatch.entity";
import { DhlStatusType } from "src/common/enums/dhl-status-type.enum";

/**
 * Paquete enviado en el cierre de ruta. Para DHL: `code` es el código propio del
 * carrier (OK/NH/BA/RD/CM); si se omite se asume `OK` (entregado). `isCharge` indica
 * que el registro es un ChargeShipment (carga), no que se deba cobrar.
 */
export interface RouteClosurePackageInput {
    id: string;
    code?: DhlStatusType;
    isCharge?: boolean;
}

export class CreateRouteclosureDto {
    claseDate: Date;
    returnedPackages: (Shipment | RouteClosurePackageInput)[];
    podPackages: (Shipment | RouteClosurePackageInput)[];
    packageDispatch: PackageDispatch;
    subsidiary: Subsidiary;
    createdBy: User;
    actualKms: string;
    collections: string[];
    noVanPackages: string[];
}
