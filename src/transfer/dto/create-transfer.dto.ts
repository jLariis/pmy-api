import { Type } from 'class-transformer';
import { IsString, IsOptional, IsNumber, IsUUID, IsBoolean, IsDate } from 'class-validator';

export class CreateTransferDto {
  @IsUUID()
  @IsOptional()
  originId?: string;

  @IsUUID()
  @IsOptional()
  destinationId?: string;

  @IsString()
  @IsOptional()
  otherDestination?: string;

  @IsString()
  transferType: string;

  @Type(() => Date)
  @IsDate()
  transferDate: Date;

  @IsBoolean()
  @IsOptional()
  secondAbord?: boolean;

  @IsNumber()
  @IsOptional()
  secondAboardAmount?: number;

  @IsNumber()
  @IsOptional()
  extraAmount?: number;
  
  @IsNumber()
  totalAmount: number;

  @IsString()
  @IsOptional()
  otherTransferType?: string;

  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsUUID()
  @IsOptional()
  vehicleId?: string;

  @IsUUID('all', { each: true })
  @IsOptional()
  driverIds?: string[];

}
