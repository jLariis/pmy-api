import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { CONTACT_CHANNELS, ContactChannel } from 'src/entities/supplier-contact.entity';

export class ContactDto {
  @IsOptional() @IsUUID()
  id?: string;

  @IsString() @MinLength(2) @MaxLength(150)
  name: string;

  @IsOptional() @IsString() @MaxLength(100)
  position?: string | null;

  @ValidateIf((o) => !!o.email) @IsEmail({}, { message: 'Correo no válido' })
  email?: string | null;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string | null;

  @IsOptional() @IsString() @MaxLength(30)
  whatsapp?: string | null;

  @IsIn(CONTACT_CHANNELS as unknown as string[])
  preferredChannel: ContactChannel;

  @IsOptional() @IsBoolean()
  isDefault?: boolean;
}

export class SupplierDto {
  @IsString() @MinLength(2) @MaxLength(200)
  name: string;

  @IsOptional() @IsString() @MaxLength(20)
  rfc?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string | null;

  @IsOptional() @IsString()
  notes?: string | null;

  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsArray() @ArrayMinSize(1, { message: 'Agrega al menos un contacto' })
  @ValidateNested({ each: true }) @Type(() => ContactDto)
  contacts: ContactDto[];
}
