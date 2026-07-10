import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateTicketDto {
  @IsIn(['mejora', 'cambio', 'eliminar', 'error']) tipo: 'mejora' | 'cambio' | 'eliminar' | 'error';
  @IsString() titulo: string;
  @IsString() descripcion: string;
  @IsString() @IsOptional() menuPrincipal?: string;
  @IsString() @IsOptional() submenu?: string;
  @IsString() @IsOptional() seccion?: string;
  @IsString() @IsOptional() subseccion?: string;
  @IsString() @IsOptional() nuevoMenu?: string;
  @IsString() @IsOptional() menuError?: string;
  @IsString() @IsOptional() submenuError?: string;
  @IsString() @IsOptional() pasosReplicar?: string;
  @IsString() @IsOptional() appVersion?: string;
  @IsString() @IsOptional() route?: string;
}
