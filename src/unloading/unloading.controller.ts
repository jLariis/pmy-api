import { Controller, Get, Post, Body, Patch, Param, Delete, UploadedFile, UseInterceptors, BadRequestException, UploadedFiles, Query } from '@nestjs/common';
import { UnloadingService } from './unloading.service';
import { CreateUnloadingDto } from './dto/create-unloading.dto';
import { UpdateUnloadingDto } from './dto/update-unloading.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ValidateTrackingNumbersDto } from './dto/validate-tracking-numbers.dto';

@ApiTags('unloadings')
@ApiBearerAuth()
@Controller('unloadings')
export class UnloadingController {
  constructor(private readonly unloadingService: UnloadingService) {}

  @Post()
  create(@Body() createUnloadingDto: CreateUnloadingDto) {
    return this.unloadingService.create(createUnloadingDto);
  }

  
  @Get('report')
  @ApiOperation({
    summary: 'Generar y enviar reporte de descargas',
    description: 'Genera un reporte consolidado de descargas y lo envía por correo electrónico. Puede filtrarse por rango de fechas.'
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Fecha de inicio del reporte (formato: YYYY-MM-DD o ISO string)',
    example: '2025-10-01',
    type: String
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Fecha de fin del reporte (formato: YYYY-MM-DD o ISO string)',
    example: '2025-10-05',
    type: String
  })
  @ApiResponse({
    status: 200,
    description: 'Reporte generado y enviado exitosamente',
    schema: {
      example: {
        message: 'Correo enviado exitosamente',
        totalUnloadings: 3,
        totalPackages: 45,
        period: 'del 2025-10-01 al 2025-10-05'
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Formato de fecha inválido',
    schema: {
      example: {
        statusCode: 400,
        message: 'Formato de fecha inicial inválido',
        error: 'Bad Request'
      }
    }
  })
  @ApiResponse({
    status: 500,
    description: 'Error interno del servidor',
    schema: {
      example: {
        statusCode: 500,
        message: 'Error al generar el reporte',
        error: 'Internal Server Error'
      }
    }
  })
  async getReport(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    console.log('===== QUERY PARAMETERS =====');
    console.log('startDate:', startDate);
    console.log('endDate:', endDate);

    let startDateObj: Date | undefined;
    let endDateObj: Date | undefined;

    if (startDate) {
      // Crear fecha en UTC
      const tempDate = new Date(startDate);
      if (isNaN(tempDate.getTime())) {
        throw new BadRequestException('Formato de fecha inicial inválido');
      }
      // Convertir a UTC
      startDateObj = new Date(Date.UTC(
        tempDate.getUTCFullYear(),
        tempDate.getUTCMonth(),
        tempDate.getUTCDate(),
        0, 0, 0, 0
      ));
      console.log('startDateObj (UTC):', startDateObj.toISOString());
    }

    if (endDate) {
      const tempDate = new Date(endDate);
      if (isNaN(tempDate.getTime())) {
        throw new BadRequestException('Formato de fecha final inválido');
      }
      endDateObj = new Date(Date.UTC(
        tempDate.getUTCFullYear(),
        tempDate.getUTCMonth(),
        tempDate.getUTCDate(),
        0, 0, 0, 0
      ));
      console.log('endDateObj (UTC):', endDateObj.toISOString());
    }

    const result = await this.unloadingService.sendUnloadingReport(startDateObj, endDateObj);
    
    return result;

    console.log('===== REPORTE COMPLETADO =====');
    /*return {
      message: 'Correo enviado exitosamente',
      totalUnloadings: result.length,
      totalPackages: result.reduce((sum, u) => sum + u.shipments.length + u.chargeShipments.length, 0),
      period: startDate && endDate 
        ? `del ${startDate} al ${endDate}` 
        : 'del día de hoy',
      timestamp: new Date().toISOString()
    };*/
  }

  @Get('subsidiary/:subsidiaryId')
  findBySubsidiary(@Param('subsidiaryId') subsidiaryId: string) {
    return this.unloadingService.findAllBySubsidiary(subsidiaryId);
  }

  @Get()
  findAll() {
    return this.unloadingService.findAll();
  }

  @Post('validate-tracking-numbers')
    validateTrackingNumbers(
      @Body() body: ValidateTrackingNumbersDto
    ) {
      const { trackingNumbers, subsidiaryId } = body;
      return this.unloadingService.validateTrackingNumbers(trackingNumbers, subsidiaryId);
    }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUnloadingDto: UpdateUnloadingDto) {
    return this.unloadingService.update(+id, updateUnloadingDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.unloadingService.remove(+id);
  }

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files')) // Use FilesInterceptor to handle multiple files
  @ApiOperation({ summary: 'Subir archivo PDF y Excel y enviar por correo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivos PDF y Excel a enviar por correo',
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
        subsidiaryName: {
          type: 'string',
          example: 'Cd. Obregon',
        },
        unloadingId: {
          type: 'string',
          example: '6076326c-f6f6-4004-825d-5419a4e6412f',
        },
      },
    },
  })
  async sendEmail(
    @UploadedFiles() files: Express.Multer.File[], // Receive multiple files
    @Body('subsidiaryName') subsidiaryName: string,
    @Body('unloadingId') unloadingId: string,
  ) {
    console.log('🚀 ~ UnloadingController ~ sendEmail ~ files:', files);
    console.log('🚀 ~ UnloadingController ~ sendEmail ~ subsidiaryName:', subsidiaryName);
    console.log('🚀 ~ UnloadingController ~ sendEmail ~ unloadingId:', unloadingId);

    // Validate that both files are present
    if (!files || files.length !== 2) {
      throw new BadRequestException('Se esperan exactamente dos archivos: un PDF y un Excel.');
    }

    // Identify PDF and Excel files based on mimetype or filename
    const pdfFile = files.find((file) => file.mimetype === 'application/pdf');
    const excelFile = files.find((file) =>
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    if (!pdfFile || !excelFile) {
      throw new BadRequestException('Se requiere un archivo PDF y un archivo Excel.');
    }

    // Call the service with the identified files
    return this.unloadingService.sendByEmail(pdfFile, excelFile, subsidiaryName, unloadingId);
  }
  
  @Get('consolidateds/:subsidiaryId')
  async getConsolidatedForStartUnloading(@Param('subsidiaryId') subsidiaryId: string){
    console.log("🚀 ~ UnloadingController ~ getConsolidatedForStartUnloading ~ subsidiaryId:", subsidiaryId)
    return await this.unloadingService.getConsolidateToStartUnloading(subsidiaryId)
  }

}
