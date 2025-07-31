import { IsString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { StatusEnum } from 'src/common/enums/status.enum';
import { Subsidiary } from 'src/entities';

export class CreateDriverDto {
  @IsString()
  name: string;

  @IsString()
  licenseNumber: string;

  @IsString()
  phoneNumber: string;

  subsidiary: Subsidiary;

  @IsEnum(['activo', 'inactivo'])
  @IsOptional()
  status?: StatusEnum;
}
