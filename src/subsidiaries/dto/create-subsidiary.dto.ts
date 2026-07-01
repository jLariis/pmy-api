import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * DTO de creación/edición de Sucursal. Antes el controller recibía la ENTIDAD
 * cruda sin validación (mass-assignment); aquí declaramos los campos editables.
 *
 * IMPORTANTE — validación deliberadamente PERMISIVA en montos/emails/zoneId:
 * el toggle "activo" y el drag&drop de Zonas reenvían la sucursal COMPLETA por
 * PATCH, y (a) los `decimal` llegan como STRING desde MySQL, (b) `officeEmail`
 * suele ser "" por default. Un `@IsNumber`/`@IsEmail`/`@IsUUID` estricto rompería
 * esos flujos (400). El `ValidationPipe` global NO usa whitelist, así que esto
 * valida tipos sin descartar extras; el service guarda explícitamente.
 */
export class CreateSubsidiaryDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  officeManager?: string;

  @IsString()
  @IsOptional()
  managerPhone?: string;

  @IsString()
  @IsOptional()
  officeEmail?: string;

  @IsString()
  @IsOptional()
  officeEmailToCopy?: string;

  // Montos: SIN @IsNumber a propósito (los `decimal` llegan como string en el
  // round-trip del toggle/zonas). Tipados como number para TypeORM; runtime acepta string.
  @IsOptional()
  fedexCostPackage?: number;

  @IsOptional()
  dhlCostPackage?: number;

  @IsOptional()
  chargeCost?: number;

  @IsOptional()
  tycoAmount?: number;

  @IsOptional()
  airportAmount?: number;

  @IsOptional()
  secondAbordAmount?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsBoolean()
  @IsOptional()
  isWarehouse?: boolean;

  @IsOptional()
  zoneId?: string | null;

  // Geolocalización para el mapa del dashboard (antes hardcodeada).
  @IsString() @IsOptional() state?: string;
  // lat/lng: permisivos (los `decimal` pueden llegar como string en el round-trip).
  @IsOptional() latitude?: number | null;
  @IsOptional() longitude?: number | null;

  // Config operativa por sucursal (antes hardcodeada).
  @IsBoolean() @IsOptional() monitorFedexCode67?: boolean;
  @IsBoolean() @IsOptional() monitorFedexCode44?: boolean;
  @IsBoolean() @IsOptional() trackFedexExternalDelivery?: boolean;
  @IsBoolean() @IsOptional() forceFedexStatusOverride?: boolean;
  @IsBoolean() @IsOptional() sortDispatchByPostalCode?: boolean;

  // Reglas de ingreso por sucursal.
  @IsBoolean() @IsOptional() chargeDex03?: boolean;
  @IsBoolean() @IsOptional() chargeDex07?: boolean;
  @IsBoolean() @IsOptional() chargeDex08?: boolean;
  @IsBoolean() @IsOptional() chargeDelivered?: boolean;
  @IsBoolean() @IsOptional() generateDhlIncomeOnDelivery?: boolean;
  @IsBoolean() @IsOptional() countTransfersAsIncome?: boolean;
}
