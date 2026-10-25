import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddDispatchPackagesDto {
  @IsArray({ message: 'Las guías deben venir en una lista' })
  @ArrayNotEmpty({ message: 'Escanea o escribe al menos una guía para agregar' })
  @IsString({ each: true, message: 'Cada guía debe ser texto' })
  trackingNumbers: string[];

  @IsString({ message: 'Escribe el motivo del cambio' })
  @IsNotEmpty({ message: 'Escribe el motivo del cambio' })
  @MaxLength(500, { message: 'El motivo no puede pasar de 500 caracteres' })
  reason: string;
}

export class RemoveDispatchPackagesDto {
  @IsArray({ message: 'Los paquetes deben venir en una lista' })
  @ArrayNotEmpty({ message: 'Elige al menos un paquete para quitar' })
  @IsString({ each: true, message: 'Paquete no válido' })
  ids: string[];

  @IsString({ message: 'Escribe el motivo del cambio' })
  @IsNotEmpty({ message: 'Escribe el motivo del cambio' })
  @MaxLength(500, { message: 'El motivo no puede pasar de 500 caracteres' })
  reason: string;
}
