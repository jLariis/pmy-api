import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { ScannedShipment } from './dto/scanned-shipment.dto';

@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  /**
   * Valida un paquete por su número de tracking.
   * Se usa @HttpCode(HttpStatus.OK) para asegurar que siempre responda 200 
   * incluso si el paquete no existe (ya que el servicio retorna un objeto de error controlado).
   */
  @Get('validate-package')
  @HttpCode(HttpStatus.OK)
  async validatePackage(
    @Query('trackingNumber') trackingNumber: string,
    @Query('subsidiaryId') subsidiaryId?: string,
  ): Promise<ScannedShipment | { isValid: false; trackingNumber: string; reason: string }> {
    return await this.warehouseService.validateTrackingNumber(trackingNumber, subsidiaryId);
  }
  
}
