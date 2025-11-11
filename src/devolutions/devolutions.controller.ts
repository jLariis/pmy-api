import { Controller, Get, Post, Body, Param, UploadedFiles, BadRequestException, UseInterceptors } from '@nestjs/common';
import { DevolutionsService } from './devolutions.service';
import { CreateDevolutionDto } from './dto/create-devolution.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';

@Controller('devolutions')
export class DevolutionsController {
  constructor(private readonly devolutionsService: DevolutionsService) {}

  @Post()
  create(@Body() createDevolutionDto: CreateDevolutionDto[]) {
    return this.devolutionsService.create(createDevolutionDto);
  }

  @Get(':subsidirayId')
  findAll(@Param('subsidiaryId') subsidiaryId: string) {
    return this.devolutionsService.findAll(subsidiaryId);
  }

  @Get('validate/:trackingNumber')
  findOne(@Param('trackingNumber') trackingNumber: string) {
    return this.devolutionsService.validateOnShipment(trackingNumber);
  }

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiOperation({ summary: 'Subir archivo Pdf y enviar por correo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
      description: 'Archivo Pdf a enviar por correo',
      schema: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            format: 'binary',
          },
          subsidiaryName: {
            type: 'string',
            example: 'Cd. Obregon'
          }
        },
      },
    })
  sendEmail(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('subsidiaryName') subsidiaryName: string
  ) {
    console.log('🚀 ~ PackageDispatchController ~ sendEmail ~ files:', files);
        console.log('🚀 ~ PackageDispatchController ~ sendEmail ~ subsidiaryName:', subsidiaryName);
    
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
    return this.devolutionsService.sendByEmail(pdfFile, excelFile, subsidiaryName)
  }

}
