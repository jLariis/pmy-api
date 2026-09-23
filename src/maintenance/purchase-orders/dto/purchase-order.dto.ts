import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { CONTACT_CHANNELS, ContactChannel } from 'src/entities/supplier-contact.entity';

export class PoItemDto {
  @IsOptional() @IsUUID()
  id?: string;

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

  @IsOptional() @IsBoolean()
  approved?: boolean;
}

export class UpdatePurchaseOrderDto {
  @IsOptional() @IsString()
  notes?: string | null;

  @IsOptional() @ValidateIf((o) => o.contactId !== null) @IsUUID()
  contactId?: string | null;

  @IsOptional() @IsUUID()
  supplierId?: string;

  @IsOptional() @IsArray() @ArrayMinSize(1, { message: 'La orden debe tener al menos una partida' })
  @ValidateNested({ each: true }) @Type(() => PoItemDto)
  items?: PoItemDto[];
}

export class AuthorizeItemDto {
  @IsUUID()
  id: string;

  @IsBoolean()
  approved: boolean;

  @IsOptional() @IsNumber() @Min(0.01)
  quantity?: number;

  @IsOptional() @IsNumber() @Min(0)
  unitPrice?: number;
}

export class AuthorizeDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AuthorizeItemDto)
  items?: AuthorizeItemDto[];
}

export class ReasonDto {
  @IsString() @MinLength(3, { message: 'Escribe el motivo' })
  reason: string;
}

export class CancelDto extends ReasonDto {
  @IsOptional() @IsBoolean()
  notifySupplier?: boolean;
}

export class SendDto {
  @IsOptional() @IsIn(CONTACT_CHANNELS as unknown as string[])
  channel?: ContactChannel;

  @IsOptional() @IsUUID()
  contactId?: string;
}

export class CompleteDto {
  @IsDateString()
  completedAt: string;

  @IsInt() @Min(0) @Max(1_000_000)
  completedKms: number;

  @IsOptional() @IsNumber() @Min(0)
  finalAmount?: number;

  @IsOptional() @ValidateIf((o) => o.nextMaintenanceDate !== null) @IsDateString()
  nextMaintenanceDate?: string | null;
}
