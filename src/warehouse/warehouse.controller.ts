import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { ScannedShipment } from './dto/scanned-shipment.dto';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { CreateOutboundDto } from './dto/create-outbound.dto';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';

@ApiTags('warehouses')
@ApiBearerAuth()
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  /**
   * Valida un paquete por su número de tracking.
   * Se usa @HttpCode(HttpStatus.OK) para asegurar que siempre responda 200 
   * incluso si el paquete no existe (ya que el servicio retorna un objeto de error controlado).
   */
  @Get('validate-package')
  @HttpCode(HttpStatus.OK)
  async validatePackage(
    @Query('trackingNumber') trackingNumber: string,
    @Query('subsidiaryId') subsidiaryId?: string,
    @Query('context') context?: 'inbound' | 'outbound',
  ): Promise<ScannedShipment | { isValid: false; trackingNumber: string; reason: string }> {
    // subsidiaryId se recibe por compatibilidad con el contrato HTTP existente,
    // pero no se usa: validateTrackingNumber ya no filtra por sucursal (tarea 4, limpieza).
    return await this.warehouseService.validateTrackingNumber(trackingNumber, context);
  }

  @Get('inbound/subsidiary/:subsidiaryId')
  findInbound(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.warehouseService.findInboundBySubsidiary(subsidiaryId, { page, limit, from, to });
  }

  @Get('outbound/subsidiary/:subsidiaryId')
  findOutbound(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.warehouseService.findOutboundBySubsidiary(subsidiaryId, { page, limit, from, to });
  }

  @Post()
  create(@Body() createWarehouseDto: CreateWarehouseDto, @Req() req) {
    const userId = req.user?.userId;

    return this.warehouseService.create(createWarehouseDto, userId);
  }

  @Post('outbound')
  createOutbound(@Body() createOutboundDto: CreateOutboundDto, @Req() req) {
    const userId = req.user?.userId;

    return this.warehouseService.outbound(createOutboundDto, userId);
  }

  @Post('notification')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiOperation({ summary: 'Enviar notificación por correo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
      description: 'Enviar notificación por correo con archivos adjuntos',
      schema: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            format: 'binary',
          },
          excelFile: {
            type: 'string',
            format: 'binary',
          },
          subsidiaryName: {
            type: 'string',
            example: 'Cd. Obregon'
          },
          type: {
            type: 'string',
            example: 'inbound'
          },
          id: {
            type: 'string',
            example: '6076326c-f6f6-4004-825d-5419a4e6412f'
          }
        },
      },
    })
  sendEmailNotification(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('warehouseName') warehouseName: string,
    @Body('type') type: string,
    @Body('id') id: string
  ) {
    // 1. Validar que el tipo sea correcto antes de pasarlo al servicio
    const validTypes = ['inbound', 'outbound'];
    
    if (!validTypes.includes(type)) {
      throw new BadRequestException('El tipo de notificación debe ser "inbound" o "outbound".');
    }

    // 2. Realizar la validación de archivos...
    if (!files || files.length !== 2) {
      throw new BadRequestException('Se esperan exactamente dos archivos: un PDF y un Excel.');
    }

    const pdfFile = files.find((file) => file.mimetype === 'application/pdf');
    const excelFile = files.find((file) =>
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    if (!pdfFile || !excelFile) {
      throw new BadRequestException('Se requiere un archivo PDF y un archivo Excel.');
    }

    // 3. Pasamos el tipo haciendo un "Type Assertion" seguro
    // Ahora TypeScript sabe que 'type' es una de las opciones permitidas
    return this.warehouseService.sendEmailNotification(
      pdfFile, 
      excelFile, 
      warehouseName, 
      type as "inbound" | "outbound", 
      id
    );
  }
}
