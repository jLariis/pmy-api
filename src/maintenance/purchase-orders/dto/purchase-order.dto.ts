import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { CONTACT_CHANNELS, ContactChannel } from 'src/entities/supplier-contact.entity';

const QTY = { message: 'La cantidad debe ser mayor a 0' };
const PRICE = { message: 'El precio no puede ser negativo' };
const TAX = { message: 'IVA no válido' };
const KMS = { message: 'El km no es válido' };

export class PoItemDto {
  @IsOptional() @IsUUID('all', { message: 'Concepto no reconocido' })
  id?: string;

  @IsOptional() @ValidateIf((o) => o.serviceId !== null) @IsUUID('all', { message: 'Servicio del catálogo no reconocido' })
  serviceId?: string | null;

  @IsString({ message: 'Describe el concepto' }) @MinLength(2, { message: 'Describe el concepto' })
  @MaxLength(300, { message: 'La descripción es demasiado larga' })
  description: string;

  @IsNumber({}, QTY) @Min(0.01, QTY)
  quantity: number;

  @IsNumber({}, PRICE) @Min(0, PRICE)
  unitPrice: number;

  @IsOptional() @IsNumber({}, TAX) @Min(0, TAX) @Max(1, TAX)
  taxRate?: number;

  @IsOptional() @IsBoolean()
  approved?: boolean;
}

export class UpdatePurchaseOrderDto {
  @IsOptional() @IsString()
  notes?: string | null;

  @IsOptional() @ValidateIf((o) => o.contactId !== null) @IsUUID('all', { message: 'Elige a qué contacto se envía' })
  contactId?: string | null;

  @IsOptional() @IsUUID('all', { message: 'Proveedor no reconocido' })
  supplierId?: string;

  @IsOptional() @IsArray({ message: 'La orden debe tener al menos un concepto' })
  @ArrayMinSize(1, { message: 'La orden debe tener al menos un concepto' })
  @ValidateNested({ each: true }) @Type(() => PoItemDto)
  items?: PoItemDto[];
}

export class AuthorizeItemDto {
  @IsUUID('all', { message: 'Concepto no reconocido' })
  id: string;

  @IsBoolean({ message: 'Indica si apruebas el concepto' })
  approved: boolean;

  @IsOptional() @IsNumber({}, QTY) @Min(0.01, QTY)
  quantity?: number;

  @IsOptional() @IsNumber({}, PRICE) @Min(0, PRICE)
  unitPrice?: number;
}

export class AuthorizeDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AuthorizeItemDto)
  items?: AuthorizeItemDto[];
}

export class ReasonDto {
  @IsString({ message: 'Escribe el motivo' }) @MinLength(3, { message: 'Escribe el motivo' })
  reason: string;
}

export class CancelDto extends ReasonDto {
  @IsOptional() @IsBoolean()
  notifySupplier?: boolean;
}

export class SendDto {
  @IsOptional() @IsIn(CONTACT_CHANNELS as unknown as string[], { message: 'Elige correo o WhatsApp' })
  channel?: ContactChannel;

  @IsOptional() @IsUUID('all', { message: 'Elige a qué contacto se envía' })
  contactId?: string;
}

export class CompleteDto {
  @IsDateString({}, { message: 'Indica la fecha en que se hizo el servicio' })
  completedAt: string;

  @IsInt(KMS) @Min(0, KMS) @Max(1_000_000, KMS)
  completedKms: number;

  @IsOptional() @IsNumber({}, { message: 'El monto no es válido' }) @Min(0, { message: 'El monto no puede ser negativo' })
  finalAmount?: number;

  @IsOptional() @ValidateIf((o) => o.nextMaintenanceDate !== null) @IsDateString({}, { message: 'La fecha del próximo servicio no es válida' })
  nextMaintenanceDate?: string | null;
}
