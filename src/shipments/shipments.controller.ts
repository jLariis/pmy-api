import { Controller, Get, Post, Param,UseGuards, UseInterceptors, UploadedFile, BadRequestException, InternalServerErrorException, Request, UploadedFiles, Query, Body } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { FedexService } from './fedex.service';
import { FedExTrackingResponseDto } from './dto/fedex/fedex-tracking-response.dto';

@ApiTags('shipments')
@ApiBearerAuth()
@Controller('shipments')
export class ShipmentsController {
  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly fedexService: FedexService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Consultar todos los envios' })
  allShipments(){
    return this.shipmentsService.findAllShipmentsAndCharges();
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Subir archivo Excel para procesar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivo Excel a procesar (Envios, Cargas, F2 o Cobros)',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        subsidiaryId: {
          type: 'string'
        }
      },
    },
  })
  uploadFile(
    @UploadedFile() file: Express.Multer.File, 
    @Body('subsidiaryId') subsidiaryId?: string
  ) {
    
    if(file.originalname.toLowerCase().includes('cobro')){
      console.log("Incluye cobro: ", file.originalname);
      return this.shipmentsService.processFileCharges(file);
    } else if(file.originalname.toLowerCase().includes('f2') || file.originalname.toLowerCase().includes('fedex')){ 
      console.log("🚀 ~ ShipmentsController ~ uploadFile ~ subsidiaryId:", subsidiaryId)
      console.log("Incluye F2/Fedex  ~ Es Carga: ", file.originalname);
      return this.shipmentsService.processFileF2(file, subsidiaryId);
    }

    return this.shipmentsService.validateMultipleSheetsShipmentFedex(file);
  }

  @Post('upload-dhl')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'excelFile', maxCount: 1 },
      { name: 'txtFile', maxCount: 1 },
    ]),
  )
  @ApiOperation({ summary: 'Subir archivo txt y Excel para procesar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivos Excel y TXT',
    schema: {
      type: 'object',
      properties: {
        excelFile: {
          type: 'string',
          format: 'binary',
        },
        txtFile: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadDhlFile(
    @UploadedFiles()
    files: {
      excelFile?: Express.Multer.File[];
      txtFile?: Express.Multer.File[];
    },
  ) {
    const excelFile = files.excelFile?.[0];
    const txtFile = files.txtFile?.[0];

    if (!excelFile || !txtFile) {
      throw new BadRequestException('Ambos archivos son requeridos');
    }

    try {
      const fileContent = txtFile.buffer.toString('utf-8');
      const result = await this.shipmentsService.processDhlTxtFile(fileContent);
      const updateShipments = await this.shipmentsService.processDhlExcelFiel(excelFile);

      return {
        success: true,
        message: 'Archivo DHL procesado correctamente',
        ...result,
        ...updateShipments,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException({
        errorId: 'DHL_UPLOAD_ERROR',
        message: 'Error al procesar los archivos DHL',
        details: error.message,
      });
    }
  }

  @Get('kpis')
  async getKPIs(
    @Query('date') date: string,
    @Query('subsidiaryId') subsidiaryId?: string
  ) {
    return await this.shipmentsService.getShipmentKPIs(date, subsidiaryId)
  }

  @Get('charges')
  async getCharges() {
    return await this.shipmentsService.getAllChargesWithStatus();
  }

  /****************************************** SOLO PRUEBAS *********************************************************/
  
    @Get('test-tracking/:trackingNumber')
    @ApiResponse({ type: FedExTrackingResponseDto })
    testTracking(@Param('trackingNumber') trackingNumber: string){
      console.log("🚀 ~ ShipmentsController ~ testTracking ~ trackingNumber:", trackingNumber)
      //return this.shipmentsService.checkStatusOnFedex();
      return this.fedexService.trackPackage(trackingNumber);
    }

    @Post('validate-tracking')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Subir archivo Excel para procesar' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
      description: 'Archivo Excel a procesar',
      schema: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    })
    @UseGuards(JwtAuthGuard)
    validateTracking(@UploadedFile() file: Express.Multer.File, @Request() req) {
      console.log("🚀 ~ ShipmentsController ~ validateTracking ~ req:", req)
      return this.shipmentsService.validateDataforTracking(file);
    }

    @Get('normalize-cities')
    normalizeCities() {
      return this.shipmentsService.normalizeCities();
    }


    @Get('test-cron')
    testCronJob() {
      return this.shipmentsService.checkStatusOnFedex();
    }

  /**************************************************************************************************************** */

}
