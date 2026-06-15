import { Controller, Get, Post, Body, Patch, Param, Delete, BadRequestException, UploadedFiles, UseInterceptors, ParseArrayPipe, Query } from '@nestjs/common';
import { InventoriesService } from './inventories.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiConsumes, ApiBody, ApiTags } from '@nestjs/swagger';
import { ValidationPayloadDto } from 'src/unloading/dto/validate-payload.dto';

@ApiTags('inventories')
@Controller('inventories')
export class InventoriesController {
  constructor(private readonly inventoriesService: InventoriesService) {}

  @Post()
  create(@Body() createInventoryDto: CreateInventoryDto) {
    console.log("🚀 ~ InventoriesController ~ create ~ createInventoryDto:", createInventoryDto)
    return this.inventoriesService.create(createInventoryDto);
  }

  @Get('detail/:id')
  findOneFull(@Param('id') id: string) {
    return this.inventoriesService.findOneFull(id);
  }

  @Get(':subsidiaryId')
  findAll(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
  ) {
    return this.inventoriesService.findAll(subsidiaryId, { page, limit, from, to, search, type });
  }

  @Get('validate/:trackingNumber')
  validateTrackingNumber(@Param('trackingNumber') trackingNumber: string) {
    return this.inventoriesService.validateTrackingNumber(trackingNumber);
  }

  @Post('validate-tracking-numbers')
  validateTrackingNumbers(
    @Body(
      'trackingNumbers',
      new ParseArrayPipe({ items: ValidationPayloadDto, optional: true }),
    )
    trackingNumbers: ValidationPayloadDto[] = [],
    @Body('subsidiaryId') subsidiaryId?: string,
  ) {
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
          inventoryId: {
            type: 'string',
            example: '6076326c-f6f6-4004-825d-5419a4e6412f'
          }
        },
      },
    })
  sendEmail(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('subsidiaryName') subsidiaryName: string,
    @Body('inventoryId') inventoryId: string
  ) {
    // El id es obligatorio: de él se resuelve la sucursal destinataria del correo.
    if (!inventoryId) {
      throw new BadRequestException('Falta el inventoryId para enviar el correo de inventario.');
    }

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

    return this.inventoriesService.sendByEmail(pdfFile, excelFile, subsidiaryName, inventoryId)
  }
}
