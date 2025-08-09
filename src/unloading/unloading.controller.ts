import { Controller, Get, Post, Body, Patch, Param, Delete, UploadedFile, UseInterceptors } from '@nestjs/common';
import { UnloadingService } from './unloading.service';
import { CreateUnloadingDto } from './dto/create-unloading.dto';
import { UpdateUnloadingDto } from './dto/update-unloading.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';

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

  @Get('validate-tracking-number/:trackingNumber/:subsidiaryId')
  validateTrackingNumber(@Param('trackingNumber') trackingNumber: string, @Param('subsidiaryId') subsidiaryId: string) {
    return this.unloadingService.validateTrackingNumber(trackingNumber, subsidiaryId);
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
    @UseInterceptors(FileInterceptor('file'))
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
            unloadingId: {
              type: 'string',
              example: '6076326c-f6f6-4004-825d-5419a4e6412f'
            }
          },
        },
      })
    sendEmail(
      @UploadedFile() file: Express.Multer.File,
      @Body('subsidiaryName') subsidiaryName: string,
      @Body('packageDispatchId') unloadingId: string
    ) {
      console.log("🚀 ~ PackageDispatchController ~ sendEmail ~ file:", file)
      console.log("🚀 ~ PackageDispatchController ~ sendEmail ~ subsidiaryName:", subsidiaryName)
      console.log("🚀 ~ PackageDispatchController ~ sendEmail ~ unloadingId:", unloadingId)
      return this.unloadingService.sendByEmail(file, subsidiaryName, unloadingId)
    }
}
