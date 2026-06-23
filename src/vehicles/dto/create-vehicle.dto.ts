import { IsString, IsEnum, IsOptional, IsNumber } from 'class-validator';
import { VehicleStatus } from 'src/common/enums/vehicle-status-enum';
import { VehicleTypeEnum } from 'src/common/enums/vehicle-type.enum';
import { Subsidiary } from 'src/entities';

export class CreateVehicleDto {
    @IsString()
    plateNumber: string;

    @IsString()
    @IsOptional()
    plateNumber2?: string;

    @IsString()
    @IsOptional()
    policyNumber?: string;

    @IsOptional()
    policyExpirationDate?: Date;

    @IsString()
    model: string;

    @IsString()
    brand: string;

    @IsNumber()
    @IsOptional()
    kms?: number;

    @IsString()
    @IsOptional()
    code?: string;

    @IsString()
    @IsOptional()
    name?: string;

    @IsNumber()
    @IsOptional()
    capacity?: number;

    // Sin @IsEnum: el enum del frontend diverge del backend (van/camioneta/rabon… vs camion/moto).
    // TODO: alinear VehicleTypeEnum front/back y luego endurecer.
    type?: VehicleTypeEnum;

    // Nombres alineados con la entidad (antes eran lastMaintenance/nextMaintenance y no mapeaban).
    @IsOptional()
    lastMaintenanceDate?: Date;

    @IsOptional()
    nextMaintenanceDate?: Date;

    subsidiary: Subsidiary;

    @IsEnum(VehicleStatus)
    @IsOptional() // tiene valor por defecto en la entidad
    status?: VehicleStatus;
}
