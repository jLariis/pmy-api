import { Controller, Get, Post, Param,UseGuards, UseInterceptors, UploadedFile, BadRequestException, InternalServerErrorException, Request, UploadedFiles, Query, Body, Logger } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { FedexService } from './fedex.service';
import { FedExTrackingResponseDto } from './dto/fedex/fedex-tracking-response.dto';
import { GetShipmentKpisDto } from './dto/get-shipment-kpis.dto';
import { CheckFedexStatusDto } from './dto/check-status-fedex-test';
import { ForPickUpDto } from './dto/for-pick-up.dto';

@ApiTags('shipments')
@ApiBearerAuth()
@Controller('shipments')
export class ShipmentsController {
  private readonly logger = new Logger(ShipmentsController.name);

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
    @Body('subsidiaryId') subsidiaryId: string,
    @Body('consNumber') consNumber: string,
    @Body('consDate') consDate?: string,
    @Body('isAereo') isAereo?: string
  ) {

    const isAereoBoolean = typeof isAereo === 'string' 
      ? isAereo.toLowerCase() === 'true' 
      : Boolean(isAereo);

    let dateForCons = null;

    if(consDate) {
      dateForCons = new Date(consDate);
    }

    return this.shipmentsService.addConsMasterBySubsidiary(file, subsidiaryId, consNumber, dateForCons, isAereoBoolean);
  }

  @Post('upload-charge')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Subir archivo Excel para procesar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivo Excel a procesar Cargas o F2',
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
  uploadChargeFile(
    @UploadedFile() file: Express.Multer.File, 
    @Body('subsidiaryId') subsidiaryId: string,
    @Body('consNumber') consNumber: string,
    @Body('consDate') consDate?: string,
    @Body('notRemoveCharge') notRemoveCharge: any = false,
  ) {
      console.log("🚀 ~ Raw notRemoveCharge:", notRemoveCharge);
  
    // Conversión robusta a boolean
    const shouldNotRemove = 
      notRemoveCharge === 'true' || 
      notRemoveCharge === true || 
      notRemoveCharge === '1' || 
      notRemoveCharge === 1;
    
    console.log("🚀 ~ Parsed notRemoveCharge:", shouldNotRemove);
    
    let dateForCons = null;
    if(consDate) {
      dateForCons = new Date(consDate);
    }

    if(shouldNotRemove) {
      console.log('🔍 Calling addChargeShipments');
      return this.shipmentsService.addChargeShipments(file, subsidiaryId, consNumber, dateForCons);
    }

    console.log('🔍 Calling processFileF2');
    return this.shipmentsService.processFileF2(file, subsidiaryId, consNumber, dateForCons);
  }

  @Post('upload-payment')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Subir archivo Excel para procesar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivo Excel a procesar Cobros',
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
  uploadPaymentFile(
    @UploadedFile() file: Express.Multer.File
  ) {
    return this.shipmentsService.processFileCharges(file);
  }

  @Post('upload-hv')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Subir archivo Excel para procesar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivo Excel a procesar High Values',
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
  uploadHighValueShipment(
    @UploadedFile() file: Express.Multer.File
  ) {
    return this.shipmentsService.processHihValueShipments(file);
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

  @Get('dashboard/kpis')
  getKpis(@Query() query: GetShipmentKpisDto) {
    return this.shipmentsService.getShipmentsKPIsForDashboard(query);
  }

  @Get('charges')
  async getCharges() {
    return await this.shipmentsService.getAllChargesWithStatus();
  }

  @Get('test-email')
  testSendEmail(){
    return this.shipmentsService.sendEmailWithHighPriorities();
  }

  @Get('test-tracking/:trackingNumber')
    @ApiResponse({ type: FedExTrackingResponseDto })
    testTracking(@Param('trackingNumber') trackingNumber: string){
      console.log("🚀 ~ ShipmentsController ~ testTracking ~ trackingNumber:", trackingNumber)
      //return this.shipmentsService.checkStatusOnFedex();
      return this.fedexService.trackPackage(trackingNumber);
    }

  @Get('test-cron')
  async testCronJob() {
    const chargeShipments = await this.shipmentsService.getSimpleChargeShipments();

    const trackingNumbers = chargeShipments.map(shipment => shipment.trackingNumber);

    if (!trackingNumbers.length) {
      this.logger.log('📪 No hay envíos para procesar');
      return;
    }

    this.logger.log(`📦 Procesando ${trackingNumbers.length} trackingNumbers: ${JSON.stringify(trackingNumbers)}`);

    try {
      const result = await this.shipmentsService.checkStatusOnFedexChargeShipment(trackingNumbers);
      return result;
    } catch (err) {
      this.logger.error(`❌ Error en handleCron: ${err.message}`);
    }
  }


  @Get(':trackingNumber')
  async getShipmentById(@Param('trackingNumber') trackingNumber: string) {
    return this.shipmentsService.findByTrackingNumber(trackingNumber);
  }

  @Get(':trackingNumber/history')
  async getShipmentStatusHistory(@Param('trackingNumber') trackingNumber: string) {
    return this.shipmentsService.findStatusHistoryByTrackingNumber(trackingNumber);
  }

  @Post('remove-for-pick-up')
  async getAndRemoveForPickUp(@Body() forPickUp: ForPickUpDto[]) {
    return this.shipmentsService.getAndMoveForPickUp(forPickUp);
  }

  /****************************************** SOLO PRUEBAS *********************************************************/
  
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
    //@UseGuards(JwtAuthGuard)
    validateTracking(@UploadedFile() file: Express.Multer.File/*, @Request() req*/) {
      //console.log("🚀 ~ ShipmentsController ~ validateTracking ~ req:", req)
      return this.shipmentsService.validateDataforTracking(file);
    }

    @Get('normalize-cities')
    normalizeCities() {
      return this.shipmentsService.normalizeCities();
    }


    @Post('test-check-status')
    async checkFedexStatus(@Body() body: CheckFedexStatusDto) {
      const { trackingNumbers, shouldPersist = false } = body;

      return await this.shipmentsService.checkStatusOnFedexBySubsidiaryRulesTesting(
        trackingNumbers,
        shouldPersist,
      );
    }


    @Get('validate-shipment-ontheway/:subsidiaryId')
    async checkShipmentOnTheWayBySubsidiary(@Param('subsidiaryId') subsidiaryId: string) {
      return await this.shipmentsService.checkStatus67OnShipments(subsidiaryId);
    }

    @Get('test-get-status03/:subsidiaryId')
    async testGet03(@Param('subsidiaryId') subsidiaryId: string){
      return await this.shipmentsService.getShipmentsWithStatus03(subsidiaryId);
    }

    @Get('fedex-info/:trackingNumber')
    async getCompleteData(@Param('trackingNumber') trackingNumber: string) {
      return await this.shipmentsService.getCompleteDataForPackage(trackingNumber);
    }

    @Get('search-by-trackingnumber/:trackingNumber')
    async searchByTrackingNumber(@Param('trackingNumber') trackingNumber: string) {
      return await this.shipmentsService.getShipmentDetailsByTrackingNumber(trackingNumber)
    }

  /**************************************************************************************************************** */

}
