import { Controller, Get, Post, Body, Patch, Param, Delete, UseInterceptors, UploadedFile, BadRequestException, UploadedFiles } from '@nestjs/common';
import { PackageDispatchService } from './package-dispatch.service';
import { CreatePackageDispatchDto } from './dto/create-package-dispatch.dto';
import { UpdatePackageDispatchDto } from './dto/update-package-dispatch.dto';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation, ApiBody } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';

@ApiTags('package-dispatchs')
@ApiBearerAuth()
@Controller('package-dispatchs')
export class PackageDispatchController {
  constructor(private readonly packageDispatchService: PackageDispatchService) {}

  @Get('info/:packageDispatchId')
  async getShipmentsByPackageDispatchId(@Param('packageDispatchId') packageDispatchId: string) {
    // 1. Limpia cualquier posible rastro de caché del navegador enviando headers
    // (Opcional: puedes inyectar @Res() para esto, pero Nest lo hace con interceptores)
    
    console.log("=> PETICIÓN RECIBIDA ID:", packageDispatchId);
    
    const result = await this.packageDispatchService.getShipmentsByPackageDispatchId(packageDispatchId);
    
    console.log("=> ENVIANDO RESPUESTA PARA ID:", result?.id);
    
    return result;
  }

  @Post()
  create(@Body() createPackageDispatchDto: CreatePackageDispatchDto) {
    console.log("🚀 ~ PackageDispatchController ~ create ~ createPackageDispatchDto:", createPackageDispatchDto)
    return this.packageDispatchService.create(createPackageDispatchDto);
  }

  @Get()
  findAll() {
    return this.packageDispatchService.findAll();
  }

  @Get('subsidiary/:subsidiaryId')
  findBySubsidiary(@Param('subsidiaryId') subsidiaryId: string) {
    return this.packageDispatchService.findAllBySubsidiary(subsidiaryId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.packageDispatchService.findOne(id);
  }

  @Get('validate-tracking-number/:trackingNumber/:subsidiaryId')
  validateTrackingNumber(@Param('trackingNumber') trackingNumber: string, @Param('subsidiaryId') subsidiaryId: string) {
    return this.packageDispatchService.validateTrackingNumber(trackingNumber, subsidiaryId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePackageDispatchDto: UpdatePackageDispatchDto) {
    return this.packageDispatchService.update(id, updatePackageDispatchDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.packageDispatchService.remove(id);
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
          },
          packageDispatchId: {
            type: 'string',
            example: '6076326c-f6f6-4004-825d-5419a4e6412f'
          }
        },
      },
    })
  sendEmail(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('subsidiaryName') subsidiaryName: string,
    @Body('packageDispatchId') packageDispatchId: string
  ) {
    console.log('🚀 ~ PackageDispatchController ~ sendEmail ~ files:', files);
        console.log('🚀 ~ PackageDispatchController ~ sendEmail ~ subsidiaryName:', subsidiaryName);
        console.log('🚀 ~ PackageDispatchController ~ sendEmail ~ packageDispatchId:', packageDispatchId);
    
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
    return this.packageDispatchService.sendByEmail(pdfFile, excelFile, subsidiaryName, packageDispatchId)
  }
}
