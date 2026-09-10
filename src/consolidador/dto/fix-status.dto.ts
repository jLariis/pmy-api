import { IsEnum, IsString, MinLength } from 'class-validator';
import { ShipmentStatusType } from '../../common/enums/shipment-status-type.enum';

export class FixStatusDto {
  @IsEnum(ShipmentStatusType) newStatus: ShipmentStatusType;
  @IsString() @MinLength(3) reason: string;
}
