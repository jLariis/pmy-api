import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { FedexStatusResolver } from './fedex-status.resolver';
import { FedexScrapeVerifier } from './fedex-scrape.verifier';

@ApiTags('fedex-status')
@Controller('fedex-status')
export class FedexStatusController {
  constructor(
    private readonly resolver: FedexStatusResolver,
    private readonly verifier: FedexScrapeVerifier,
  ) {}

  /** Último estatus canónico de una guía (read-only, siempre fresco desde FedEx). */
  @Get('latest/:trackingNumber')
  @ApiOperation({ summary: 'Último estatus del paquete desde FedEx (normalizado y validado)' })
  getLatest(
    @Param('trackingNumber') trackingNumber: string,
    @Query('fedexUniqueId') fedexUniqueId?: string,
    @Query('carrierCode') carrierCode?: string,
  ) {
    return this.resolver.getLatestStatus(trackingNumber, { fedexUniqueId, carrierCode });
  }

  /** Verificación cruzada (API vs. scrape/legado) para auditar el mapeo. QA on-demand. */
  @Get('verify/:trackingNumber')
  @ApiOperation({ summary: 'Contrasta el estatus de la API contra una segunda fuente' })
  verify(@Param('trackingNumber') trackingNumber: string) {
    return this.verifier.verify(trackingNumber);
  }
}
