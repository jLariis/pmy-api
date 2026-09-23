import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { REQUEST_PRIORITIES, RequestPriority } from 'src/entities/maintenance-request.entity';

export class CreateRequestDto {
  @IsUUID()
  vehicleId: string;

  @IsOptional() @ValidateIf((o) => o.kmsAtRequest !== null) @IsInt() @Min(0) @Max(1_000_000)
  kmsAtRequest?: number | null;

  @IsString() @MinLength(3)
  description: string;

  @IsIn(REQUEST_PRIORITIES as unknown as string[])
  priority: RequestPriority;
}

export class UpdateRequestDto {
  @IsOptional() @ValidateIf((o) => o.kmsAtRequest !== null) @IsInt() @Min(0) @Max(1_000_000)
  kmsAtRequest?: number | null;

  @IsOptional() @IsString() @MinLength(3)
  description?: string;

  @IsOptional() @IsIn(REQUEST_PRIORITIES as unknown as string[])
  priority?: RequestPriority;
}

export class QuoteItemDto {
  @IsOptional() @ValidateIf((o) => o.serviceId !== null) @IsUUID()
  serviceId?: string | null;

  @IsString() @MinLength(2) @MaxLength(300)
  description: string;

  @IsNumber() @Min(0.01)
  quantity: number;

  @IsNumber() @Min(0)
  unitPrice: number;

  @IsOptional() @IsNumber() @Min(0) @Max(1)
  taxRate?: number;
}

export class QuoteDto {
  @IsUUID()
  supplierId: string;

  @IsDateString()
  quoteDate: string;

  @IsOptional() @ValidateIf((o) => o.validUntil !== null) @IsDateString()
  validUntil?: string | null;

  @IsOptional() @IsString()
  notes?: string | null;

  @IsArray() @ArrayMinSize(1, { message: 'Agrega al menos una partida' })
  @ValidateNested({ each: true }) @Type(() => QuoteItemDto)
  items: QuoteItemDto[];
}
