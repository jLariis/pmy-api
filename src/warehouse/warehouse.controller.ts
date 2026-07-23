import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { WarehouseService } from './warehouse.service';
import { SuperAdminGuard } from 'src/auth/guards/super-admin.guard';
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

  /**
   * Descarga el PDF de una salida de bodega (traspaso o salida a ruta) generado
   * por el MISMO código del backend que envía el correo, para que el archivo
   * descargado en el frontend sea idéntico al notificado.
   */
  @Get('outbound/:id/pdf')
  async downloadOutboundPdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.warehouseService.getOutboundPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /** Descarga el Excel de una salida de bodega. Idéntico al del correo. */
  @Get('outbound/:id/excel')
  async downloadOutboundExcel(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.warehouseService.getOutboundExcel(id);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /** Regenera el PDF de una ENTRADA a bodega. */
  @Get('inbound/:id/pdf')
  async downloadInboundPdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.warehouseService.getInboundPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /** Regenera el Excel de una ENTRADA a bodega. */
  @Get('inbound/:id/excel')
  async downloadInboundExcel(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.warehouseService.getInboundExcel(id);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /** Detalle hidratado de una salida (metadata + paquetes) para "Ver detalles". */
  @Get('outbound/:id/details')
  getOutboundDetails(@Param('id') id: string) {
    return this.warehouseService.getOutboundDetails(id);
  }

  /** Detalle hidratado de una entrada (metadata + paquetes) para "Ver detalles". */
  @Get('inbound/:id/details')
  getInboundDetails(@Param('id') id: string) {
    return this.warehouseService.getInboundDetails(id);
  }

  /** Rollback de una SALIDA (solo superadmin). Revierte estatus/sucursal y marca la operación. */
  @Post('outbound/:id/rollback')
  @UseGuards(SuperAdminGuard)
  rollbackOutbound(@Param('id') id: string, @Req() req) {
    return this.warehouseService.rollbackOutbound(id, req.user?.userId);
  }

  /** Rollback de una ENTRADA (solo superadmin). */
  @Post('inbound/:id/rollback')
  @UseGuards(SuperAdminGuard)
  rollbackInbound(@Param('id') id: string, @Req() req) {
    return this.warehouseService.rollbackInbound(id, req.user?.userId);
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
