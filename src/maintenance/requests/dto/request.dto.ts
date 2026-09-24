import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { REQUEST_PRIORITIES, RequestPriority } from 'src/entities/maintenance-request.entity';

const KMS = { message: 'El km no es válido' };

export class CreateRequestDto {
  @IsUUID('all', { message: 'Elige la unidad que necesita mantenimiento' })
  vehicleId: string;

  @IsOptional() @ValidateIf((o) => o.kmsAtRequest !== null) @IsInt(KMS) @Min(0, KMS) @Max(1_000_000, KMS)
  kmsAtRequest?: number | null;

  @IsString({ message: 'Describe qué necesita la unidad' })
  @MinLength(3, { message: 'Describe qué necesita la unidad' })
  description: string;

  @IsIn(REQUEST_PRIORITIES as unknown as string[], { message: 'Elige la prioridad' })
  priority: RequestPriority;
}

export class UpdateRequestDto {
  @IsOptional() @ValidateIf((o) => o.kmsAtRequest !== null) @IsInt(KMS) @Min(0, KMS) @Max(1_000_000, KMS)
  kmsAtRequest?: number | null;

  @IsOptional() @IsString() @MinLength(3, { message: 'Describe qué necesita la unidad' })
  description?: string;

  @IsOptional() @IsIn(REQUEST_PRIORITIES as unknown as string[], { message: 'Elige la prioridad' })
  priority?: RequestPriority;
}

export class QuoteItemDto {
  @IsOptional() @ValidateIf((o) => o.serviceId !== null) @IsUUID('all', { message: 'Servicio del catálogo no reconocido' })
  serviceId?: string | null;

  @IsString({ message: 'Describe el concepto' })
  @MinLength(2, { message: 'Describe el concepto' })
  @MaxLength(300, { message: 'La descripción es demasiado larga' })
  description: string;

  @IsNumber({}, { message: 'La cantidad debe ser un número' }) @Min(0.01, { message: 'La cantidad debe ser mayor a 0' })
  quantity: number;

  @IsNumber({}, { message: 'El precio debe ser un número' }) @Min(0, { message: 'El precio no puede ser negativo' })
  unitPrice: number;

  @IsOptional() @IsNumber({}, { message: 'IVA no válido' }) @Min(0, { message: 'IVA no válido' }) @Max(1, { message: 'IVA no válido' })
  taxRate?: number;
}

export class QuoteDto {
  @IsUUID('all', { message: 'Elige el proveedor que cotizó' })
  supplierId: string;

  @IsDateString({}, { message: 'Indica la fecha de la cotización' })
  quoteDate: string;

  @IsOptional() @ValidateIf((o) => o.validUntil !== null) @IsDateString({}, { message: 'La fecha de vigencia no es válida' })
  validUntil?: string | null;

  @IsOptional() @IsString()
  notes?: string | null;

  @IsArray({ message: 'Agrega al menos un concepto' })
  @ArrayMinSize(1, { message: 'Agrega al menos un concepto' })
  @ValidateNested({ each: true }) @Type(() => QuoteItemDto)
  items: QuoteItemDto[];
}
