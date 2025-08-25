import { Controller, Get, Post, Body, Patch, Param, Delete, UploadedFile, UseInterceptors, BadRequestException, UploadedFiles } from '@nestjs/common';
import { UnloadingService } from './unloading.service';
import { CreateUnloadingDto } from './dto/create-unloading.dto';
import { UpdateUnloadingDto } from './dto/update-unloading.dto';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
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

  @Get(':subsidiaryId')
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
    console.log('🚀 ~ PackageDispatchController ~ sendEmail ~ files:', files);
    console.log('🚀 ~ PackageDispatchController ~ sendEmail ~ subsidiaryName:', subsidiaryName);
    console.log('🚀 ~ PackageDispatchController ~ sendEmail ~ unloadingId:', unloadingId);

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
    return await this.unloadingService.getConsolidateToStartUnloading(subsidiaryId)
  }


}
