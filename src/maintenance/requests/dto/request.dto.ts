import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { REQUEST_PRIORITIES, REQUEST_TYPES, RequestPriority, RequestType } from 'src/entities/maintenance-request.entity';

const KMS = { message: 'El km no es válido' };

export class RequestItemDto {
  @IsOptional() @IsUUID('all', { message: 'Renglón no reconocido' })
  id?: string;

  @IsOptional() @ValidateIf((o) => o.productId !== null) @IsUUID('all', { message: 'Producto del catálogo no reconocido' })
  productId?: string | null;

  @IsOptional() @ValidateIf((o) => o.categoryId !== null) @IsUUID('all', { message: 'Pieza o insumo no reconocido' })
  categoryId?: string | null;

  @IsString({ message: 'Describe lo que se necesita' })
  @MinLength(2, { message: 'Describe lo que se necesita' })
  @MaxLength(300, { message: 'La descripción es demasiado larga' })
  description: string;

  @IsNumber({}, { message: 'La cantidad debe ser un número' }) @Min(0.01, { message: 'La cantidad debe ser mayor a 0' })
  quantity: number;

  @IsOptional() @ValidateIf((o) => o.unitId !== null) @IsUUID('all', { message: 'Unidad de medida no válida' })
  unitId?: string | null;

  @IsOptional() @IsString()
  notes?: string | null;
}

export class CreateRequestDto {
  @IsIn(REQUEST_TYPES as unknown as string[], { message: 'Elige el tipo de solicitud' })
  type: RequestType;

  @IsUUID('all', { message: 'Elige la sucursal' })
  subsidiaryId: string;

  /** Obligatoria para mantenimiento/servicio/reparación (se valida en el servicio). */
  @IsOptional() @ValidateIf((o) => o.vehicleId !== null) @IsUUID('all', { message: 'Unidad no válida' })
  vehicleId?: string | null;

  @IsOptional() @ValidateIf((o) => o.kmsAtRequest !== null) @IsInt(KMS) @Min(0, KMS) @Max(1_000_000, KMS)
  kmsAtRequest?: number | null;

  @IsString({ message: 'Describe para qué se necesita' })
  @MinLength(3, { message: 'Describe para qué se necesita' })
  description: string;

  @IsIn(REQUEST_PRIORITIES as unknown as string[], { message: 'Elige la prioridad' })
  priority: RequestPriority;

  @IsArray({ message: 'Agrega al menos un renglón' })
  @ArrayMinSize(1, { message: 'Agrega al menos un renglón (qué se necesita y cuánto)' })
  @ValidateNested({ each: true }) @Type(() => RequestItemDto)
  items: RequestItemDto[];
}

export class UpdateRequestDto {
  @IsOptional() @IsIn(REQUEST_TYPES as unknown as string[], { message: 'Elige el tipo de solicitud' })
  type?: RequestType;

  @IsOptional() @ValidateIf((o) => o.vehicleId !== null) @IsUUID('all', { message: 'Unidad no válida' })
  vehicleId?: string | null;

  @IsOptional() @ValidateIf((o) => o.kmsAtRequest !== null) @IsInt(KMS) @Min(0, KMS) @Max(1_000_000, KMS)
  kmsAtRequest?: number | null;

  @IsOptional() @IsString() @MinLength(3, { message: 'Describe para qué se necesita' })
  description?: string;

  @IsOptional() @IsIn(REQUEST_PRIORITIES as unknown as string[], { message: 'Elige la prioridad' })
  priority?: RequestPriority;

  @IsOptional() @IsArray() @ArrayMinSize(1, { message: 'Agrega al menos un renglón' })
  @ValidateNested({ each: true }) @Type(() => RequestItemDto)
  items?: RequestItemDto[];
}

export class RejectRequestDto {
  @IsString({ message: 'Escribe el motivo del rechazo' }) @MinLength(3, { message: 'Escribe el motivo del rechazo' })
  reason: string;
}

export class QuoteItemDto {
  /** Renglón de la solicitud al que responde (comparativo por partida). */
  @IsOptional() @ValidateIf((o) => o.requestItemId !== null) @IsUUID('all', { message: 'Renglón no reconocido' })
  requestItemId?: string | null;

  @IsOptional() @ValidateIf((o) => o.productId !== null) @IsUUID('all', { message: 'Producto del catálogo no reconocido' })
  productId?: string | null;

  @IsString({ message: 'Describe el concepto' })
  @MinLength(2, { message: 'Describe el concepto' })
  @MaxLength(300, { message: 'La descripción es demasiado larga' })
  description: string;

  @IsNumber({}, { message: 'La cantidad debe ser un número' }) @Min(0.01, { message: 'La cantidad debe ser mayor a 0' })
  quantity: number;

  @IsNumber({}, { message: 'El precio debe ser un número' }) @Min(0, { message: 'El precio no puede ser negativo' })
  unitPrice: number;

  @IsOptional() @IsIn(['si', 'no', 'sobre_pedido'], { message: 'Existencia no válida (sí, no o sobre pedido)' })
  availability?: 'si' | 'no' | 'sobre_pedido';

  @IsOptional() @ValidateIf((o) => o.leadTimeDays !== null) @IsInt({ message: 'Los días de entrega deben ser un número entero' })
  @Min(0, { message: 'Los días de entrega no pueden ser negativos' }) @Max(365, { message: 'Máximo 365 días de entrega' })
  leadTimeDays?: number | null;

  @IsOptional() @IsBoolean()
  ivaEnabled?: boolean;

  @IsOptional() @IsBoolean()
  iepsEnabled?: boolean;

  @IsOptional() @IsNumber({}, { message: 'Tasa de IEPS no válida' }) @Min(0, { message: 'Tasa de IEPS no válida' }) @Max(2, { message: 'Tasa de IEPS no válida' })
  iepsRate?: number;

  @IsOptional() @ValidateIf((o) => o.quality !== null) @IsInt() @Min(1, { message: 'La calidad va de 1 a 5 estrellas' }) @Max(5, { message: 'La calidad va de 1 a 5 estrellas' })
  quality?: number | null;

  /** Compat v1/v2 (0.16 = con IVA). */
  @IsOptional() @IsNumber() @Min(0) @Max(1)
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
