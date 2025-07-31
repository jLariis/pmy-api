import { IsString, IsEnum, IsUUID, IsOptional } from 'class-validator';
import { VehicleStatus } from 'src/common/enums/vehicle-status-enum';
import { Subsidiary } from 'src/entities';


export class CreateVehicleDto {
    @IsString()
    plateNumber: string;

    @IsString()
    model: string;

    @IsString()
    brand: string;

    @IsString()
    kms: number;

    lastMaintenance?: Date;

    nextMaintenance?: Date;

    subsidiary: Subsidiary;

    @IsEnum(VehicleStatus)
    @IsOptional() // ya que tiene un valor por defecto en la entidad
    status?: VehicleStatus;
}

