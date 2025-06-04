import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, UseInterceptors, UploadedFile, BadRequestException, HttpStatus } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Public } from 'src/auth/decorators/decorators/public-decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { FedexService } from './fedex.service';
import { TrackingResponseDto } from './dto/fedex/tracking-response.dto';
import { TrackRequestDto } from './dto/tracking-request.dto';
import { ParseDhlDto } from './dto/dhl/parse-dhl.dto';

@ApiTags('exercise-api')
@ApiBearerAuth()
@Controller('shipments')
export class ShipmentsController {
  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly fedexService: FedexService
  ) {}

  @Get()
  allShipments(){
    return this.shipmentsService.findAll();
  }

  @Post()
  saveShipments(@Body() createShipmentDto: any) {
    //return this.shipmentsService.create(createShipmentDto);
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
    return this.shipmentsService.validateShipmentFedex(file);
  }

  @Post('upload-dhl-file')
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
    const rawText = file.buffer.toString('utf8');
    return this.shipmentsService.createFromParsedDto(rawText);
  }

  @Get('test-tracking/:trackingNumber')
  @ApiResponse({ type: TrackingResponseDto })
  testTracking(@Param('trackingNumber') trackingNumber: string){
    console.log("🚀 ~ ShipmentsController ~ testTracking ~ trackingNumber:", trackingNumber)
    //return this.shipmentsService.checkStatusOnFedex();
    return this.fedexService.trackPackage(trackingNumber);
  }


  /*** Mejor realizar un consulta para multiples trackings */
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

}
