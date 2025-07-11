import { IsString, IsNumber, IsInt, IsObject, IsOptional, IsISO8601 } from 'class-validator';

export class SubsidiaryKpiDto {
  @IsString()
  subsidiaryId: string;

  @IsString()
  subsidiaryName: string;

  @IsInt()
  totalPackages: number;

  @IsInt()
  deliveredPackages: number;

  @IsInt()
  undeliveredPackages: number;

  @IsObject()
  undeliveredDetails: {
    total: number;
    byExceptionCode: {
      code07: number;
      code08: number;
      code03: number;
      unknown: number;
    };
  };

  @IsInt()
  inTransitPackages: number;

  @IsInt()
  totalCharges: number;

  @IsObject()
  consolidations: {
    ordinary: number;
    air: number;
    total: number;
  };

  @IsNumber()
  averageRevenuePerPackage: number;

  @IsNumber()
  totalRevenue: number;

  @IsNumber()
  totalExpenses: number;

  @IsNumber()
  averageEfficiency: number;

  @IsNumber()
  totalProfit: number;
}