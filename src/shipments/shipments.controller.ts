import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, UseInterceptors, UploadedFile, BadRequestException, HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Public } from 'src/auth/decorators/decorators/public-decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { FedexService } from './fedex.service';
import { TrackingResponseDto } from './dto/fedex/tracking-response.dto';
import { TrackRequestDto } from './dto/tracking-request.dto';

@ApiTags('exercise-api')
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
    return this.shipmentsService.findAll();
  }

  @Post('upload')
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
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    if(file.originalname.toLowerCase().includes('cobro')){
      console.log("Incluye cobro: ", file.originalname);
      return this.shipmentsService.processFileCharges(file);
    }


    return this.shipmentsService.validateShipmentFedex(file);
  }

  @Post('upload-dhl')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Subir archivo txt para procesar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivo txt a procesar',
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
  async uploadDhlFile(@UploadedFile() file: Express.Multer.File) {
    try {
      const fileContent = file.buffer.toString('utf-8');
      const result = await this.shipmentsService.processDhlTxtFile(fileContent);

      return {
        success: true,
        message: 'Archivo DHL procesado correctamente',
        ...result
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException({
        errorId: 'DHL_UPLOAD_ERROR',
        message: 'Error al procesar el archivo DHL',
        details: error.message
      });
    }
  }



  /****************************************** SOLO PRUEBAS *********************************************************/
  
    @Get('test-tracking/:trackingNumber')
    @ApiResponse({ type: TrackingResponseDto })
    testTracking(@Param('trackingNumber') trackingNumber: string){
      console.log("🚀 ~ ShipmentsController ~ testTracking ~ trackingNumber:", trackingNumber)
      //return this.shipmentsService.checkStatusOnFedex();
      return this.fedexService.trackPackage(trackingNumber);
    }

    @Get('validate-tracking/:trackingNumber')
    validateTracking(@Param('trackingNumber') trackigNumber: string) {
      return this.shipmentsService.validateDataforTracking(trackigNumber);
    }

    @Post('tracking')
    @ApiBody({ type: TrackRequestDto })
    async track(@Body() body: TrackRequestDto): Promise<TrackingResponseDto[] | TrackingResponseDto> {
      let trackingNumbers: string[] = [];

      if (body.trackingNumber) {
        trackingNumbers = [body.trackingNumber];
      } else if (body.trackingNumbers && body.trackingNumbers.length > 0) {
        trackingNumbers = body.trackingNumbers;
      } else {
        throw new BadRequestException('Debes proporcionar al menos un número de rastreo.');
      }

      // Aquí haces la lógica para procesar cada trackingNumber
      const results = await Promise.all(
        trackingNumbers.map((tn) => this.fedexService.trackPackage(tn)),
      );

      return trackingNumbers.length === 1 ? results[0] : results;
    }
  /**************************************************************************************************************** */

}
