import { Controller, Get, Post, Body, Patch, Param, Delete, UseInterceptors, UploadedFile } from '@nestjs/common';
import { PackageDispatchService } from './package-dispatch.service';
import { CreatePackageDispatchDto } from './dto/create-package-dispatch.dto';
import { UpdatePackageDispatchDto } from './dto/update-package-dispatch.dto';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';

@ApiTags('package-dispatchs')
@ApiBearerAuth()
@Controller('package-dispatchs')
export class PackageDispatchController {
  constructor(private readonly packageDispatchService: PackageDispatchService) {}

  @Post()
  create(@Body() createPackageDispatchDto: CreatePackageDispatchDto) {
    console.log("🚀 ~ PackageDispatchController ~ create ~ createPackageDispatchDto:", createPackageDispatchDto)
    return this.packageDispatchService.create(createPackageDispatchDto);
  }

  @Get()
  findAll() {
    return this.packageDispatchService.findAll();
  }

  @Get(':subsidiaryId')
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
          packageDispatchId: {
            type: 'string',
            example: '6076326c-f6f6-4004-825d-5419a4e6412f'
          }
        },
      },
    })
  sendEmail(
    @UploadedFile() file: Express.Multer.File,
    @Body('subsidiaryName') subsidiaryName: string,
    @Body('packageDispatchId') packageDispatchId: string
  ) {
    console.log("🚀 ~ PackageDispatchController ~ sendEmail ~ file:", file)
    console.log("🚀 ~ PackageDispatchController ~ sendEmail ~ subsidiaryName:", subsidiaryName)
    console.log("🚀 ~ PackageDispatchController ~ sendEmail ~ packageDispatchId:", packageDispatchId)
    return this.packageDispatchService.sendByEmail(file, subsidiaryName, packageDispatchId)
  }
}
