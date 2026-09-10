import { IsOptional, IsString } from 'class-validator';

export class ConsolidadorQueryDto {
  @IsOptional() @IsString() consNumber?: string;
  @IsOptional() @IsString() routeId?: string;
}
