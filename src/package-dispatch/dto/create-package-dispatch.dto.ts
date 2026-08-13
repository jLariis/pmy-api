import { IsArray, IsString, IsOptional, IsBoolean, IsDateString } from "class-validator";
import { Route, Subsidiary, Vehicle } from "src/entities"
import { Driver } from "src/entities/driver.entity";

export class CreatePackageDispatchDto {
    @IsArray()
    @IsString({ each: true })
    shipments: string[];

    @IsOptional()
    @IsArray()
    routes?: Route[];

    @IsOptional()
    @IsArray()
    drivers?: Driver[];

    @IsOptional()
    vehicle?: Vehicle;

    @IsOptional()
    subsidiary?: Subsidiary;

    @IsOptional()
    @IsString()
    kms?: string;

    @IsOptional()
    @IsDateString()
    routeDate?: string; // 'YYYY-MM-DD' — día operativo de la ruta (default hoy en el servicio)

    @IsOptional()
    @IsBoolean()
    is315?: boolean;
}
