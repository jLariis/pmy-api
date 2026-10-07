import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsString, IsUUID, ValidateNested } from 'class-validator';

export class ApplyClosureFixItemDto {
  @IsUUID('all', { message: 'El paquete seleccionado no es válido.' })
  shipmentId: string;

  @IsIn(['shipment', 'charge'], { message: 'El tipo de paquete no es válido.' })
  kind: 'shipment' | 'charge';

  @IsString({ message: 'Falta la revisión del paquete; vuelve a revisar.' })
  fingerprint: string;
}

export class ApplyClosureFixesDto {
  @IsArray({ message: 'Selecciona al menos un paquete.' })
  @ArrayMinSize(1, { message: 'Selecciona al menos un paquete.' })
  @ValidateNested({ each: true })
  @Type(() => ApplyClosureFixItemDto)
  items: ApplyClosureFixItemDto[];
}
