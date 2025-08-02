import { IsArray, IsString, IsOptional } from "class-validator";
import { Route, Subsidiary, Vehicle } from "src/entities"
import { Driver } from "src/entities/driver.entity";

export class CreatePackageDispatchDto {
    @IsArray()
    @IsString({ each: true })
    shipments: string[];

    @IsArray()
    routes: Route[];

    @IsArray()
    drivers: Driver[];

    @IsOptional()
    vehicle?: Vehicle;

    @IsOptional()
    subsidiary?: Subsidiary;

    @IsString()
    kms?: string;
}
