import { BadRequestException } from '@nestjs/common';
import { OutboundType } from 'src/common/enums/outbound-type.enum';

export function assertOutboundConsistency(dto: {
  type: OutboundType;
  kms?: number;
  routes?: unknown[];
  destinationId?: string;
}): void {
  if (dto.type === OutboundType.DISPATCH) {
    if (dto.kms === undefined || dto.kms === null || Number.isNaN(Number(dto.kms))) {
      throw new BadRequestException('El kilometraje inicial es obligatorio para una salida a ruta.');
    }
    if (!Array.isArray(dto.routes) || dto.routes.length === 0) {
      throw new BadRequestException('Debe seleccionar al menos una ruta para una salida a ruta.');
    }
    return;
  }
  if (dto.type === OutboundType.TRANSFER) {
    if (!dto.destinationId) {
      throw new BadRequestException('Debe seleccionar la sucursal destino para un traspaso.');
    }
    return;
  }
  throw new BadRequestException(`Tipo de salida '${dto.type}' no soportado.`);
}
