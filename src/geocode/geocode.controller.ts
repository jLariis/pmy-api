import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GeocodeService } from './geocode.service';

@ApiTags('geocode')
@ApiBearerAuth()
@Controller('geocode')
export class GeocodeController {
  constructor(private readonly geocodeService: GeocodeService) {}

  /**
   * Geocodifica una dirección mexicana (parsing inteligente + caché en BD).
   * Devuelve un array (vacío si no se ubica): [{ lat, lon, display_name, source }].
   */
  @Get()
  async geocode(
    @Query('address') address?: string,
    @Query('city') city?: string,
    @Query('zip') zip?: string,
    @Query('q') q?: string,
  ) {
    return this.geocodeService.geocode({ address, city, zip, q });
  }

  /** Guarda una corrección MANUAL del usuario (verdad de campo, gana siempre). */
  @Post('manual')
  async saveManual(
    @Body() body: { address?: string; city?: string; zip?: string; lat: number; lng: number },
  ) {
    return this.geocodeService.saveManual(body);
  }

  // ---- Administración del caché aprendido (pantalla en Configuración) ----

  @Get('cache')
  async listCache(@Query('search') search?: string) {
    const [items, counts] = await Promise.all([
      this.geocodeService.listCache(search),
      this.geocodeService.countCache(),
    ]);
    return { items, ...counts };
  }

  @Patch('cache/:id')
  async updateCache(@Param('id') id: string, @Body() body: { lat: number; lng: number }) {
    return this.geocodeService.updateCache(id, body.lat, body.lng);
  }

  @Delete('cache/:id')
  async deleteCache(@Param('id') id: string) {
    return this.geocodeService.deleteCache(id);
  }

  @Delete('cache')
  async clearCache(@Query('scope') scope?: 'all' | 'auto') {
    return this.geocodeService.clearCache(scope === 'all' ? 'all' : 'auto');
  }
}
