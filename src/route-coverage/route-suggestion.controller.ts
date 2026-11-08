import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RouteSuggestionService } from './route-suggestion.service';

/** Sugerencias de salida a ruta (CP + vencimiento + bodega). Solo lectura. */
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
}
