import { Controller, Get, Res, Query, StreamableFile, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ResportsService } from './resports.service';
import { Public } from 'src/auth/decorators/decorators/public-decorator';
import { ApiTags, ApiQuery } from '@nestjs/swagger';

@Public()
@ApiTags('reports')
@Controller('reports')
export class ResportsController {
  // Instanciamos el Logger oficial de NestJS
  private readonly logger = new Logger(ResportsController.name);

  constructor(private readonly resportsService: ResportsService) {}

  @Get('income-statement')
  @ApiQuery({ name: 'subsidiaryIds', required: false, type: [String] })
  async downloadIncomeStatement(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res({ passthrough: true }) response: Response,
    @Query('subsidiaryIds') subsidiaryIds?: string | string[],
  ): Promise<StreamableFile> {
    try {
      // 1. Log de entrada para ver exactamente qué manda el frontend
      this.logger.log(`📥 Solicitud recibida: startDate=${startDate}, endDate=${endDate}, subsidiaryIds=${JSON.stringify(subsidiaryIds)}`);

      let parsedIds: string[] = [];
      
      if (subsidiaryIds) {
        const rawIds = Array.isArray(subsidiaryIds) ? subsidiaryIds : [subsidiaryIds];
        parsedIds = rawIds.filter(id => id && id.trim() !== '');
      }

      // 2. Log para confirmar cómo quedaron los IDs después de limpiarlos
      this.logger.log(`🔍 IDs procesados (limpios): ${JSON.stringify(parsedIds)}`);

      this.logger.log('⚙️ Iniciando generación de Excel en el servicio...');
      
      const reportBuffer = await this.resportsService.generateIncomeStatementReport(
        parsedIds,
        startDate,
        endDate,
      );

      // 3. Log para confirmar que el Excel se creó y tiene un tamaño válido
      this.logger.log(`✅ Excel generado exitosamente. Tamaño: ${reportBuffer.byteLength} bytes`);

      let prefix = 'Todas_Las_Sucursales';

      if (parsedIds.length === 1) {
        prefix = parsedIds[0];
      } else if (parsedIds.length > 1) {
        prefix = 'Multiples_Sucursales';
      }

      const fileName = `Estado_de_Resultados_${prefix}_${startDate}_al_${endDate}.xlsx`;
      
      // 4. Log final antes de despachar la respuesta
      this.logger.log(`📤 Despachando archivo al cliente: ${fileName}`);

      response.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': reportBuffer.byteLength,
      });

      return new StreamableFile(new Uint8Array(reportBuffer));

    } catch (error) {
      // 5. Log de errores críticos: Si algo truena, esto lo atrapará y te lo dirá.
      this.logger.error(`❌ Error crítico al generar el reporte: ${error.message}`, error.stack);
      throw error;
    }
  }
}