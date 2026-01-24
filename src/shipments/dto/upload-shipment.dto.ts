import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

export class UploadShipmentDto {
  @IsString()
  subsidiaryId: string;

  @IsOptional()
  @IsString()
  consNumber?: string;

  @IsOptional()
  @IsString()
  consDate?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isAereo?: boolean;
}