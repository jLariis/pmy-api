import { BadRequestException } from '@nestjs/common';
import { OutboundType } from 'src/common/enums/outbound-type.enum';

export function assertOutboundConsistency(dto: {
  type: OutboundType;
  kms?: number;
  routes?: unknown[];
  warehouse?: string;
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
    const destination = String(dto.destinationId ?? '').trim();
    if (!destination) {
      throw new BadRequestException('Debe seleccionar la sucursal destino para un traspaso.');
    }
    // Un traspaso hacia la misma bodega deja las guías donde están (en_ruta) y la
    // sucursal real no puede sacarlas a ruta (caso Peñasco 13-oct-2026).
    if (destination === String(dto.warehouse ?? '').trim()) {
      throw new BadRequestException('La sucursal destino no puede ser la misma bodega de origen.');
    }
    return;
  }
  throw new BadRequestException(`Tipo de salida '${dto.type}' no soportado.`);
}
