import { IsString, IsEnum, IsUUID, IsOptional, IsNumber } from 'class-validator';
import { VehicleStatus } from 'src/common/enums/vehicle-status-enum';
import { VehicleTypeEnum } from 'src/common/enums/vehicle-type.enum';
import { Subsidiary } from 'src/entities';


export class CreateVehicleDto {
    @IsString()
    plateNumber: string;

    @IsString()
    model: string;

    @IsString()
    brand: string;

    @IsNumber()
    kms: number;

    @IsString()
    code: string;

    @IsString()
    name: string;

    @IsNumber()
    capacity: number;

    type: VehicleTypeEnum;

    lastMaintenance?: Date;

    nextMaintenance?: Date;

    subsidiary: Subsidiary;

    @IsEnum(VehicleStatus)
    @IsOptional() // ya que tiene un valor por defecto en la entidad
    status?: VehicleStatus;
}

