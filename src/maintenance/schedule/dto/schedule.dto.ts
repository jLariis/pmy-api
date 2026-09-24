import { IsDateString, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

const KMS = { message: 'El km no es válido' };
const INTERVAL = { message: 'El intervalo debe estar entre 500 y 100,000 km' };

export class UpdateScheduleDto {
  /** Corrección manual del km actual (puede bajar: corrige capturas erróneas). */
  @IsOptional() @IsInt(KMS) @Min(0, KMS) @Max(1_000_000, KMS)
  kms?: number;

  @IsOptional() @IsInt(INTERVAL) @Min(500, INTERVAL) @Max(100_000, INTERVAL)
  maintenanceIntervalKms?: number;

  @IsOptional() @IsInt(KMS) @Min(0, KMS) @Max(1_000_000, KMS)
  lastMaintenanceKms?: number | null;

  @IsOptional() @ValidateIf((o) => o.lastMaintenanceDate !== null) @IsDateString({}, { message: 'La fecha del último servicio no es válida' })
  lastMaintenanceDate?: string | null;

  @IsOptional() @ValidateIf((o) => o.nextMaintenanceDate !== null) @IsDateString({}, { message: 'La fecha del próximo servicio no es válida' })
  nextMaintenanceDate?: string | null;
}
