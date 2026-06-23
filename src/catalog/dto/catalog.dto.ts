import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateCatalogItemDto {
  @IsString()
  type: string;

  @IsString()
  key: string;

  @IsString()
  label: string;

  @IsInt()
  @IsOptional()
  sortOrder?: number;
}

export class UpdateCatalogItemDto {
  @IsString()
  @IsOptional()
  label?: string;

  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
