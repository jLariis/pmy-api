import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ImportFilesService } from './import-files.service';

/**
 * Historial y descarga de los archivos originales de importación FedEx.
 * La autenticación la aplica el JwtAuthGuard global (APP_GUARD).
 */
@Controller('import-files')
export class ImportFilesController {
  constructor(private readonly service: ImportFilesService) {}

  @Get()
  list(@Query() q: { subsidiaryId?: string; kind?: string; from?: string; to?: string; limit?: string }) {
    return this.service.list({
      subsidiaryId: q.subsidiaryId,
      kind: q.kind,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
  }

  @Get('by-consolidated/:id')
  byConsolidated(@Param('id') id: string) {
    return this.service.findByConsolidated(id);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const f = await this.service.getDownloadable(id);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.originalName)}"`);
    res.send(f.buffer);
  }
}
