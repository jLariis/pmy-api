import { IsString, IsUUID, IsEnum, IsDateString, IsArray, IsOptional } from 'class-validator';
import { StatusEnum } from 'src/common/enums/status.enum';
import { Subsidiary } from 'src/entities';

export class CreateRouteDto {
    @IsString()
    name: string;

    @IsString()
    @IsOptional()
    code: string;

    @IsEnum(['activo', 'inactivo'])
    @IsOptional()
    status?: StatusEnum;

    subsidiary: Subsidiary;

}