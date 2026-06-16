import { IsOptional, IsString } from 'class-validator';

/**
 * Traspaso inline de un paquete mal enrutado a la sucursal destino.
 * Validación laxa a propósito; el detalle se valida en el service.
 */
export class CreatePackageTransferDto {
  @IsString()
  trackingNumber: string;

  @IsString()
  destinationId: string;

  @IsOptional()
  @IsString()
  shipmentId?: string | null;

  @IsOptional()
  @IsString()
  chargeShipmentId?: string | null;

  /** Origen del registro: 'inventory' | 'package_dispatch'. */
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
