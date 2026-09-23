import { IsDateString, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export class UpdateScheduleDto {
  /** Corrección manual del km actual (puede bajar: corrige capturas erróneas). */
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000)
  kms?: number;

  @IsOptional() @IsInt() @Min(500) @Max(100_000)
  maintenanceIntervalKms?: number;

  @IsOptional() @IsInt() @Min(0) @Max(1_000_000)
  lastMaintenanceKms?: number | null;

  @IsOptional() @ValidateIf((o) => o.lastMaintenanceDate !== null) @IsDateString()
  lastMaintenanceDate?: string | null;

  @IsOptional() @ValidateIf((o) => o.nextMaintenanceDate !== null) @IsDateString()
  nextMaintenanceDate?: string | null;
}
