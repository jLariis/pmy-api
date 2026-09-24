import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { CONTACT_CHANNELS, ContactChannel } from 'src/entities/supplier-contact.entity';

// Mensajes en lenguaje simple: el front los muestra tal cual (con "Contacto N:" por delante).
export class ContactDto {
  @IsOptional() @IsUUID('all', { message: 'Contacto no reconocido' })
  id?: string;

  @IsString({ message: 'Escribe el nombre del contacto' })
  @MinLength(2, { message: 'Escribe el nombre del contacto' })
  @MaxLength(150, { message: 'El nombre del contacto es demasiado largo' })
  name: string;

  @IsOptional() @IsString() @MaxLength(100, { message: 'El puesto es demasiado largo' })
  position?: string | null;

  @ValidateIf((o) => !!o.email)
  @IsEmail({}, { message: 'El correo no es válido (ej. nombre@empresa.com)' })
  email?: string | null;

  @IsOptional() @IsString() @MaxLength(30, { message: 'El teléfono es demasiado largo' })
  phone?: string | null;

  @IsOptional() @IsString() @MaxLength(30, { message: 'El WhatsApp es demasiado largo' })
  whatsapp?: string | null;

  @IsIn(CONTACT_CHANNELS as unknown as string[], { message: 'Elige si recibe las órdenes por correo o por WhatsApp' })
  preferredChannel: ContactChannel;

  @IsOptional() @IsBoolean()
  isDefault?: boolean;
}

export class SupplierDto {
  @IsString({ message: 'Escribe el nombre o razón social del proveedor' })
  @MinLength(2, { message: 'Escribe el nombre o razón social del proveedor' })
  @MaxLength(200, { message: 'El nombre del proveedor es demasiado largo' })
  name: string;

  @IsOptional() @IsString() @MaxLength(13, { message: 'El RFC tiene más de 13 caracteres' })
  rfc?: string | null;

  @IsOptional() @IsString() @MaxLength(300, { message: 'La dirección es demasiado larga' })
  address?: string | null;

  @IsOptional() @IsString()
  notes?: string | null;

  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsArray({ message: 'Agrega al menos un contacto' })
  @ArrayMinSize(1, { message: 'Agrega al menos un contacto' })
  @ValidateNested({ each: true }) @Type(() => ContactDto)
  contacts: ContactDto[];
}
