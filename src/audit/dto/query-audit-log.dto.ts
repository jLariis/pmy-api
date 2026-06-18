import { IsEnum, IsInt, IsOptional, IsString, Min, IsDateString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction, AuditModule, AuditResult } from 'src/common/enums/audit.enum';

export class QueryAuditLogDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsEnum(AuditModule) module?: AuditModule;
  @IsOptional() @IsEnum(AuditAction) action?: AuditAction;
  @IsOptional() @IsEnum(AuditResult) result?: AuditResult;
  @IsOptional() @IsString() entityName?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() subsidiaryId?: string;
  /** Busca en description / userEmail / path / entityId. */
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit: number = 25;
  @IsOptional() @IsString() sortBy: string = 'createdAt';
  @IsOptional() @IsIn(['ASC', 'DESC']) order: 'ASC' | 'DESC' = 'DESC';
}
