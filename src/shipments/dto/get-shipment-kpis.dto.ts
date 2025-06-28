import { IsDateString, IsOptional, IsUUID } from 'class-validator'

export class GetShipmentKpisDto {
  @IsDateString()
  from: string

  @IsDateString()
  to: string

  @IsUUID()
  @IsOptional()
  subsidiaryId?: string
}