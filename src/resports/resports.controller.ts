import { Controller, Get, Res, Query, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { ResportsService } from './resports.service';
import { Public } from 'src/auth/decorators/decorators/public-decorator';
import { ApiTags } from '@nestjs/swagger';

@Public()
@ApiTags('reports')
@Controller('resports')
export class ResportsController {
  constructor(private readonly resportsService: ResportsService) {}

  @Get()
  async findAll(
    @Query('subsidiaryId') subsidiaryId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const reportBuffer = await this.resportsService.generateIncomeStatementReport(
      subsidiaryId,
      startDate,
      endDate,
    );

    const fileName = `Income_Statement_${subsidiaryId}_${startDate}_to_${endDate}.xlsx`;

    response.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': reportBuffer.byteLength,
    });

    return new StreamableFile(new Uint8Array(reportBuffer));
  }
}