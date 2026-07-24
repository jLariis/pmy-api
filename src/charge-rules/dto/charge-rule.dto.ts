import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpsertChargeRuleDto {
  /** ShipmentType: 'fedex' | 'dhl' | 'other'. */
  @IsString()
  carrier: string;

  /** 'DELIVERED' o el código de no-entrega ('03','07','08','NH','BA','RD','CM'…). */
  @IsString()
  code: string;

  @IsBoolean()
  chargeable: boolean;

  /** Omitir/null = default global; con valor = override para esa sucursal. */
  @IsOptional()
  @IsString()
  subsidiaryId?: string | null;
}
