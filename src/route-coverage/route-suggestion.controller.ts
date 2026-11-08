import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RouteSuggestionService } from './route-suggestion.service';

/** Sugerencias de salida a ruta (CP + vencimiento + bodega, repartidor/unidad/km). Solo lectura. */
@ApiTags('route-suggestions')
@ApiBearerAuth()
@Controller('route-suggestions')
export class RouteSuggestionController {
  constructor(private readonly suggestions: RouteSuggestionService) {}

  @Get()
  @ApiOperation({ summary: 'Paquetes en bodega agrupados por ruta sugerida, con su vencimiento' })
  forSubsidiary(@Query('subsidiaryId') subsidiaryId: string) {
    return this.suggestions.forSubsidiary(subsidiaryId);
  }

  @Get('dispatch-defaults')
  @ApiOperation({ summary: 'Repartidor y unidad que suelen ir a estas rutas' })
  dispatchDefaults(@Query('subsidiaryId') subsidiaryId: string, @Query('routeIds') routeIds?: string) {
    return this.suggestions.dispatchDefaults(subsidiaryId, (routeIds ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  }

  @Get('vehicle-kms')
  @ApiOperation({ summary: 'Último kilometraje creíble de una unidad' })
  vehicleKms(@Query('vehicleId') vehicleId: string) {
    return this.suggestions.vehicleLastKms(vehicleId);
  }
}
