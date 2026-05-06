import { IsString, IsOptional, IsNumber, IsUUID } from 'class-validator';

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
