import { IsArray, IsOptional, IsString } from 'class-validator';

/** Un paquete escaneado para registrar en bodega, con su tipo. */
export class PickUpItemDto {
  @IsString()
  trackingNumber: string;

  /** 'ocurre' (=> ES_OCURRE) o 'entrega_bodega' (=> ENTREGADO_EN_BODEGA). */
  @IsString()
  type: string;

  @IsOptional()
  @IsString()
  shipmentId?: string | null;

  @IsOptional()
  @IsString()
  chargeShipmentId?: string | null;
}

/**
 * Payload de "Registro Ocurre / Entrega en bodega".
 * El tipo va POR PAQUETE para poder guardar ambos en un solo envío.
 * Validación laxa a propósito (el detalle se valida en el service) para no
 * provocar 400 espurios por basura del payload.
 */
export class SavePickUpDto {
  @IsString()
  subsidiaryId: string;

  @IsArray()
  items: PickUpItemDto[];
}
