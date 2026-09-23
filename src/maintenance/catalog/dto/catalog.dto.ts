import { IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { VehicleTypeEnum } from 'src/common/enums/vehicle-type.enum';
import { MAINTENANCE_SERVICE_UNITS, MaintenanceServiceUnit } from 'src/entities/maintenance-service.entity';

export class CategoryDto {
  @IsString() @MinLength(2) @MaxLength(100)
  name: string;

  @IsOptional() @IsInt()
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100)
  name?: string;

  @IsOptional() @IsInt()
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class ServiceDto {
  @IsString() @MinLength(2) @MaxLength(150)
  name: string;

  @IsUUID()
  categoryId: string;

  @IsIn(MAINTENANCE_SERVICE_UNITS as unknown as string[])
  unit: MaintenanceServiceUnit;

  @IsNumber() @Min(0)
  referencePrice: number;

  @IsOptional() @IsEnum(VehicleTypeEnum)
  vehicleType?: VehicleTypeEnum | null;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class UpdateServiceDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(150)
  name?: string;

  @IsOptional() @IsUUID()
  categoryId?: string;

  @IsOptional() @IsIn(MAINTENANCE_SERVICE_UNITS as unknown as string[])
  unit?: MaintenanceServiceUnit;

  @IsOptional() @IsNumber() @Min(0)
  referencePrice?: number;

  @IsOptional() @IsEnum(VehicleTypeEnum)
  vehicleType?: VehicleTypeEnum | null;

  @IsOptional() @IsBoolean()
  active?: boolean;
}
