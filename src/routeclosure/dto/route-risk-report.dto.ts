import { IsBoolean, IsOptional, Matches } from 'class-validator';

export class RouteRiskReportDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha debe ser AAAA-MM-DD.' })
  date?: string;

  /** true = solo arma el reporte y lo regresa, sin mandar el correo. */
  @IsOptional()
  @IsBoolean({ message: 'La vista previa debe ser sí o no.' })
  dryRun?: boolean;
}
