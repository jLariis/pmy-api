import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PackageDossierService } from './package-dossier.service';

@ApiTags('package-dossier')
@ApiBearerAuth()
@Controller('package-dossier')
export class PackageDossierController {
  constructor(private readonly service: PackageDossierService) {}

  /** Expediente completo de una guía FedEx/DHL o JD de pieza DHL (solo lectura). */
  @Get(':query')
  @ApiOperation({ summary: 'Expediente de una guía: registros, movimientos internos e historial FedEx/DHL' })
  async getDossier(@Param('query') query: string) {
    if (!query || query.trim().length < 5) {
      throw new BadRequestException('Escribe al menos 5 caracteres de la guía.');
    }
    return this.service.getDossier(query);
  }
}
