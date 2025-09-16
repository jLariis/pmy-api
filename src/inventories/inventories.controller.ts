import { Controller, Get, Post, Body, Patch, Param, Delete, BadRequestException, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { InventoriesService } from './inventories.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { ValidateTrackingNumbersDto } from 'src/unloading/dto/validate-tracking-numbers.dto';

@Controller('inventories')
export class InventoriesController {
  constructor(private readonly inventoriesService: InventoriesService) {}

  @Post()
  create(@Body() createInventoryDto: CreateInventoryDto) {
    console.log("🚀 ~ InventoriesController ~ create ~ createInventoryDto:", createInventoryDto)
    return this.inventoriesService.create(createInventoryDto);
  }

  @Get(':subsidiaryId')
  findAll(@Param('subsidiaryId') subsidiaryId: string) {
    console.log("🚀 ~ InventoriesController ~ findAll ~ subsidiaryId:", subsidiaryId)
    return this.inventoriesService.findAll(subsidiaryId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.inventoriesService.findOne(id);
  }

  @Get('validate/:trackingNumber')
  validateTrackingNumber(@Param('trackingNumber') trackingNumber: string) {
    return this.inventoriesService.validateTrackingNumber(trackingNumber);
  }

  @Post('validate-tracking-numbers')
  validateTrackingNumbers(@Body() body: ValidateTrackingNumbersDto) {
    const { trackingNumbers, subsidiaryId } = body;
    return this.inventoriesService.validateTrackingNumbers(trackingNumbers, subsidiaryId);
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

    return this.inventoriesService.sendByEmail(pdfFile, excelFile, subsidiaryName, packageDispatchId)
  }
}
