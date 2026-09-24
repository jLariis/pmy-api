import { IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { VehicleTypeEnum } from 'src/common/enums/vehicle-type.enum';
import { MAINTENANCE_SERVICE_UNITS, MaintenanceServiceUnit } from 'src/entities/maintenance-service.entity';

const CAT_NAME = { message: 'Escribe el nombre de la categoría' };
const SVC_NAME = { message: 'Escribe el nombre del servicio' };
const PRICE = { message: 'Escribe un precio de referencia (0 o más)' };
const UNIT = { message: 'Elige la unidad (servicio, pieza, litro o juego)' };
const VTYPE = { message: 'Tipo de vehículo no válido' };

export class CategoryDto {
  @IsString(CAT_NAME) @MinLength(2, CAT_NAME) @MaxLength(100, { message: 'El nombre es demasiado largo' })
  name: string;

  @IsOptional() @IsInt({ message: 'El orden debe ser un número entero' })
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString(CAT_NAME) @MinLength(2, CAT_NAME) @MaxLength(100, { message: 'El nombre es demasiado largo' })
  name?: string;

  @IsOptional() @IsInt({ message: 'El orden debe ser un número entero' })
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class ServiceDto {
  @IsString(SVC_NAME) @MinLength(2, SVC_NAME) @MaxLength(150, { message: 'El nombre es demasiado largo' })
  name: string;

  @IsUUID('all', { message: 'Elige una categoría' })
  categoryId: string;

  @IsIn(MAINTENANCE_SERVICE_UNITS as unknown as string[], UNIT)
  unit: MaintenanceServiceUnit;

  @IsNumber({}, PRICE) @Min(0, PRICE)
  referencePrice: number;

  @IsOptional() @IsEnum(VehicleTypeEnum, VTYPE)
  vehicleType?: VehicleTypeEnum | null;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class UpdateServiceDto {
  @IsOptional() @IsString(SVC_NAME) @MinLength(2, SVC_NAME) @MaxLength(150, { message: 'El nombre es demasiado largo' })
  name?: string;

  @IsOptional() @IsUUID('all', { message: 'Elige una categoría' })
  categoryId?: string;

  @IsOptional() @IsIn(MAINTENANCE_SERVICE_UNITS as unknown as string[], UNIT)
  unit?: MaintenanceServiceUnit;

  @IsOptional() @IsNumber({}, PRICE) @Min(0, PRICE)
  referencePrice?: number;

  @IsOptional() @IsEnum(VehicleTypeEnum, VTYPE)
  vehicleType?: VehicleTypeEnum | null;

  @IsOptional() @IsBoolean()
  active?: boolean;
}
