import { Module } from '@nestjs/common';
import { FedexService } from 'src/shipments/fedex.service';
import { FedexStatusResolver } from './fedex-status.resolver';
import { FedexScrapeVerifier } from './fedex-scrape.verifier';
import { FedexStatusController } from './fedex-status.controller';

/**
 * Servicio nuevo de "último estatus" de FedEx (read-only) + verificación cruzada.
 * Exporta el resolver para que otros módulos (devoluciones) lo reusen.
 */
@Module({
  controllers: [FedexStatusController],
  providers: [FedexService, FedexStatusResolver, FedexScrapeVerifier],
  exports: [FedexStatusResolver],
})
export class FedexStatusModule {}
