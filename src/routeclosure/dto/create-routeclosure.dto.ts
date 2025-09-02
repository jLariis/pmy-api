import { Shipment, Subsidiary, User } from "src/entities";
import { PackageDispatch } from "src/entities/package-dispatch.entity";

export class CreateRouteclosureDto {
    claseDate: Date;
    returnedPackages: Shipment[];
    podPackages: Shipment[];
    packageDispatch: PackageDispatch;
    subsidiary: Subsidiary;
    createdBy: User;
    actualKms: string;
    collections: string[];
}
