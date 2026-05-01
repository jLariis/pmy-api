import { Controller, Get, Post, Param, UseGuards, UseInterceptors, UploadedFile, BadRequestException, InternalServerErrorException, Request, UploadedFiles, Query, Body, Logger, Res, HttpStatus, HttpCode, HttpException, ParseBoolPipe, Req } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiProduces, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { FedexService } from './fedex.service';
import { FedExTrackingResponseDto } from './dto/fedex/fedex-tracking-response.dto';
import { GetShipmentKpisDto } from './dto/get-shipment-kpis.dto';
import { CheckFedexStatusDto } from './dto/check-status-fedex-test';
import { ForPickUpDto } from './dto/for-pick-up.dto';
import { ShipmentToSaveDto } from './dto/shipment-to-save.dto';
import { PendingShipmentsQueryDto } from './dto/pendending-shipments.dto';
import { UploadShipmentDto } from './dto/upload-shipment.dto';
import { Response } from 'express';
import * as dayjs from 'dayjs'; 
import { UniversalAuditDto } from './dto/audit-entity-type.dto';

@ApiTags('shipments')
@ApiBearerAuth()
@Controller('shipments')
export class ShipmentsController {
  private readonly logger = new Logger(ShipmentsController.name);

  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly fedexService: FedexService
  ) {}

  @Get('test-new-cron')
  async testNewCronJob() {
    const globalStart = Date.now();    
    this.logger.log('🕐 Iniciando verificación de envíos (Normales y F2)...');
    
    try {
      // 1. Obtención de datos en paralelo
      const [shipments, chargeShipments] = await Promise.all([
        this.shipmentsService.getShipmentsToValidate(),
        this.shipmentsService.getSimpleChargeShipments()
      ]);

      if (shipments.length === 0 && chargeShipments.length === 0) {
        this.logger.log('📪 No hay envíos ni F2 para procesar.');
        return;
      }

      this.logger.log(`📊 Total a procesar: ${shipments.length} normales y ${chargeShipments.length} F2`);

      // 2. FASE 1: Envíos Normales
      if (shipments.length > 0) {
        const startF1 = Date.now();
        this.logger.log('🚀 [FASE 1] Iniciando actualización de Envíos Normales...');
        
        await this.shipmentsService.processMasterFedexUpdate(shipments);
        
        const durationF1 = ((Date.now() - startF1) / 1000 / 60).toFixed(2);
        this.logger.log(`✅ [FASE 1] Finalizada en ${durationF1} minutos.`);
      }

      // 3. FASE 2: ChargeShipments (F2)
      if (chargeShipments.length > 0) {
        const startF2 = Date.now();
        this.logger.log('🚀 [FASE 2] Iniciando actualización de ChargeShipments (F2)...');
        this.logger.log(`📝 Nota: Se generará historial en shipment_status para ${chargeShipments.length} cargos.`);
        
        await this.shipmentsService.processChargeFedexUpdate(chargeShipments); 
        
        const durationF2 = ((Date.now() - startF2) / 1000 / 60).toFixed(2);
        this.logger.log(`✅ [FASE 2] Finalizada en ${durationF2} minutos.`);
      }

      // Resumen Final
      const totalDurationMin = ((Date.now() - globalStart) / 1000 / 60).toFixed(2);
      //const totalCount = trackingNumbers.length + trackingNumbersF2.length;
      
      this.logger.log(`🏁 Sincronización TOTAL finalizada con éxito.`);
      //this.logger.log(`✅ Detalle final: ${totalCount} trackings procesados en ${totalDurationMin} minutos.`);

    } catch (err) {
      this.logger.error(`❌ Error fatal en handleCron: ${err.message}`);
    }
  }

  @Get('pendings')
  @ApiOperation({
    summary: 'Obtener envíos pendientes',
    description: `
      Devuelve la lista de envíos pendientes.
      Puede filtrarse por sucursal y rango de fechas.
      `
  })
  @ApiOkResponse({
    description: 'Lista de envíos pendientes obtenida correctamente'
  })
  @ApiBadRequestResponse({
    description: 'Parámetros inválidos'
  })
  async getPendingShipments(
    @Query() query: PendingShipmentsQueryDto
  ) {
    return this.shipmentsService.getPendingShipmentsBySubsidiary(
      query.subsidiaryId
    );
  }

  @Get('pendings/excel')
  async downloadPendingShipmentsExcel(
    @Query() query: PendingShipmentsQueryDto,
    @Res() res: any
  ) {
    const buffer = await this.shipmentsService.getPendingShipmentsExcel(
      query.subsidiaryId
    );

    const fileName = `envios_pendientes_${Date.now()}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`
    );

    res.end(buffer);
  }


  @Get(':subsidiaryId')
  @ApiOperation({ summary: 'Consultar todos los envios' })
  allShipments(@Param('subsidiaryId') subsidiaryId: string){
    return this.shipmentsService.findAllShipmentsAndCharges(subsidiaryId);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Subir archivo Excel para procesar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivo Excel a procesar (Envios, Cargas, F2 o Cobros)',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        subsidiaryId: {
          type: 'string'
        }
      },
    },
  })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File, 
    @Body() dto: UploadShipmentDto, // <-- Usamos el DTO completo
    @Res() res: Response
  ) {
    try {
      const isAereoBoolean = String(dto.isAereo).toLowerCase() === 'true';
      let dateForCons = dto.consDate ? new Date(dto.consDate) : null;

      // Llamamos al servicio normalmente
      const result = await this.shipmentsService.addConsMasterBySubsidiary(
        file, 
        dto.subsidiaryId, 
        dto.consNumber || '', 
        dateForCons, 
        isAereoBoolean
      );

      return res.status(HttpStatus.OK).json(result);

  } catch (error) {
      // Extraemos el estatus (400, 500, etc.)
      const status = error instanceof HttpException 
        ? error.getStatus() 
        : HttpStatus.INTERNAL_SERVER_ERROR;

      const responseError = error instanceof HttpException 
        ? error.getResponse() 
        : null;

      // Buscamos el mensaje real: "El número de consolidado ya existe..."
      let realMessage = error.message;
      if (responseError && typeof responseError === 'object') {
        realMessage = responseError['apiMessage'] || responseError['message'] || realMessage;
      }

      // IMPORTANTE: Al usar res.status().json() aquí, 
      // el "Global Exception Filter" (el de la "E") es ignorado por completo.
      return res.status(status).json({
        domain: "generic",
        message: realMessage, // Aquí mandamos el texto completo
        status: status,
        id: "m-" + Date.now(),
        timestamp: new Date().toISOString()
      });
    }
  }

  @Post('upload-charge')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Subir archivo Excel para procesar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivo Excel a procesar Cargas o F2',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        subsidiaryId: {
          type: 'string'
        }
      },
    },
  })
  uploadChargeFile(
    @UploadedFile() file: Express.Multer.File, 
    @Body('subsidiaryId') subsidiaryId: string,
    @Body('consNumber') consNumber: string,
    @Body('consDate') consDate?: string,
    @Body('notRemoveCharge') notRemoveCharge: any = false,
  ) {
      console.log("🚀 ~ Raw notRemoveCharge:", notRemoveCharge);
  
    // Conversión robusta a boolean
    const shouldNotRemove = 
      notRemoveCharge === 'true' || 
      notRemoveCharge === true || 
      notRemoveCharge === '1' || 
      notRemoveCharge === 1;
    
    console.log("🚀 ~ Parsed notRemoveCharge:", shouldNotRemove);
    
    let dateForCons = null;
    if(consDate) {
      dateForCons = new Date(consDate);
    }

    if(shouldNotRemove) {
      console.log('🔍 Calling addChargeShipments');
      return this.shipmentsService.addChargeShipments(file, subsidiaryId, consNumber, dateForCons);
    }

    console.log('🔍 Calling processFileF2');
    return this.shipmentsService.processFileF2(file, subsidiaryId, consNumber, dateForCons);
  }

  @Post('upload-payment')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Subir archivo Excel para procesar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivo Excel a procesar Cobros',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        subsidiaryId: {
          type: 'string'
        }
      },
    },
  })
  uploadPaymentFile(
    @UploadedFile() file: Express.Multer.File
  ) {
    return this.shipmentsService.processFileCharges(file);
  }

  @Post('upload-hv')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Subir archivo Excel para procesar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivo Excel a procesar High Values',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        subsidiaryId: {
          type: 'string'
        }
      },
    },
  })
  uploadHighValueShipment(
    @UploadedFile() file: Express.Multer.File
  ) {
    return this.shipmentsService.processHihValueShipments(file);
  }

  @Post('upload-dhl')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Subir archivo Excel para procesar envíos de DHL' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Archivo Excel y datos adicionales para el consolidado',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        subsidiaryId: {
          type: 'string',
          description: 'ID de la sucursal',
        },
        consDate: {
          type: 'string',
          description: 'Fecha del consolidado (opcional)',
          nullable: true,
        },
        consNumber: {
          type: 'string',
          description: 'Número de consolidado (opcional)',
          nullable: true,
        }
      },
      required: ['file', 'subsidiaryId'] // El archivo y la sucursal son obligatorios
    },
  })
  async uploadDhlFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('subsidiaryId') subsidiaryId: string,
    @Body('consDate') consDate?: string,
    @Body('consNumber') consNumber?: string,
    @Req() req?: any // Inyectamos la request para obtener el usuario autenticado
  ) {
    
    // Validación básica desde el controlador
    if (!subsidiaryId) {
      throw new BadRequestException('El subsidiaryId es requerido para procesar el archivo.');
    }

    try {
      // Obtenemos el ID del usuario si tienes un Guard de autenticación (ej. JWT)
      // Ajusta 'req.user.id' dependiendo de cómo guardes el usuario en tu request
      const userId = req?.user?.userId;

      console.log("🚀 ~ ShipmentsController ~ uploadDhlFile ~ userId:", userId)

      // Llamamos al nuevo método del servicio con todos sus parámetros
      const result = await this.shipmentsService.processDhlExcelFile(
        file,
        subsidiaryId,
        consDate,
        userId,
        consNumber
      );

      return {
        success: true,
        message: 'Archivo DHL procesado y consolidado creado correctamente',
        ...result,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException({
        errorId: 'DHL_UPLOAD_ERROR',
        message: 'Error al procesar el archivo Excel de DHL',
        details: error.message,
      });
    }
  }

  
  @Get('kpis')
  async getKPIs(
    @Query('date') date: string,
    @Query('subsidiaryId') subsidiaryId?: string
  ) {
    return await this.shipmentsService.getShipmentKPIs(date, subsidiaryId)
  }

  @Get('dashboard/kpis')
  getKpis(@Query() query: GetShipmentKpisDto) {
    return this.shipmentsService.getShipmentsKPIsForDashboard(query);
  }

  @Get('charges/:subdidiaryId')
  async getCharges(@Param('subdidiaryId') subsidiaryId: string) {
    return await this.shipmentsService.getAllChargesWithStatus(subsidiaryId);
  }

  @Get('test-email')
  testSendEmail(){
    return this.shipmentsService.sendEmailWithHighPriorities();
  }

  @Get('test-tracking/:trackingNumber')
    @ApiResponse({ type: FedExTrackingResponseDto })
    testTracking(@Param('trackingNumber') trackingNumber: string){
      console.log("🚀 ~ ShipmentsController ~ testTracking ~ trackingNumber:", trackingNumber)
      //return this.shipmentsService.checkStatusOnFedex();
      return this.fedexService.trackPackage(trackingNumber);
    }
  
  @Get(':trackingNumber')
  async getShipmentById(@Param('trackingNumber') trackingNumber: string) {
    return this.shipmentsService.findByTrackingNumber(trackingNumber);
  }

  @Get(':trackingNumber/history')
  async getShipmentStatusHistory(@Param('trackingNumber') trackingNumber: string) {
    return this.shipmentsService.findStatusHistoryByTrackingNumber(trackingNumber);
  }

  @Post('remove-for-pick-up')
  async getAndRemoveForPickUp(@Body() forPickUp: ForPickUpDto[]) {
    return this.shipmentsService.getAndMoveForPickUp(forPickUp);
  }

  /****************************************** SOLO PRUEBAS *********************************************************/
  
    @Post('validate-tracking')
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
    validateTracking(@UploadedFile() file: Express.Multer.File/*, @Request() req*/) {
      //console.log("🚀 ~ ShipmentsController ~ validateTracking ~ req:", req)
      return this.shipmentsService.validateDataforTracking(file);
    }

    @Get('normalize-cities')
    normalizeCities() {
      return this.shipmentsService.normalizeCities();
    }


    @Post('test-check-status')
    async checkFedexStatus(@Body() body: CheckFedexStatusDto) {
      const { trackingNumbers, shouldPersist = false } = body;

      return await this.shipmentsService.checkStatusOnFedexBySubsidiaryRulesTesting(
        trackingNumbers,
        shouldPersist,
      );
    }

    @Get('validate-shipment-ontheway/:subsidiaryId')
    async checkShipmentOnTheWayBySubsidiary(@Param('subsidiaryId') subsidiaryId: string) {
      return await this.shipmentsService.checkStatus67OnShipments(subsidiaryId);
    }

    @Get('report-no67/:subsidiaryId')
    async getNo67Report(@Param('subsidiaryId') subsidiaryId: string, @Res() res: any) {
      try {
        // Usa el nuevo nombre del método
        const result = await this.shipmentsService.validateCode67BySubsidiary(subsidiaryId);
        
        // Verificar que result existe y tiene details
        if (!result || !result.details) {
          return res.status(404).json({
            message: 'No se encontraron datos para exportar',
          });
        }
        
        // Verificar que hay datos
        if (result.details.length === 0) {
          return res.status(404).json({
            message: 'No hay shipments sin código 67 para exportar',
          });
        }
        
        // Generar el Excel
        await this.shipmentsService.exportNo67Shipments(result.details, res);
        
      } catch (error) {
        return res.status(500).json({
          message: 'Error generando reporte',
          error: error.message
        });
      }
    }

    @Get('test-get-status03/:subsidiaryId')
    async testGet03(@Param('subsidiaryId') subsidiaryId: string){
      return await this.shipmentsService.getShipmentsWithStatus03(subsidiaryId);
    }

    @Get('fedex-info/:trackingNumber')
    async getCompleteData(@Param('trackingNumber') trackingNumber: string) {
      return await this.shipmentsService.getCompleteDataForPackage(trackingNumber);
    }

    @Get('search-by-trackingnumber/:trackingNumber')
    async searchByTrackingNumber(@Param('trackingNumber') trackingNumber: string) {
      return await this.shipmentsService.getShipmentDetailsByTrackingNumber(trackingNumber)
    }

    @Get('history/:id')
    async getHistoryById(@Param('id') id: string, @Query('isCharge') isCharge?: string) {
      const isChargeBool = isCharge === 'true';
      return this.shipmentsService.getShipmentHistoryFromFedex(id, isChargeBool);
    }

  /**************************************************************************************************************** */

  @Post("add-shipment")
  async addSingleShipment(@Body() dto: ShipmentToSaveDto) {
    return this.shipmentsService.addShipment(dto);
  }  

  @Post('dispatch/sync-status/:trackingNumber')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Sincroniza estatus de shipments según historial',
    description: 'Busca una salida a ruta por su tracking, obtiene sus paquetes y corrige el estatus del maestro si no coincide con el último registro de su historial.' 
  })
  @ApiResponse({ status: 200, description: 'Sincronización completada exitosamente.' })
  @ApiResponse({ status: 404, description: 'No se encontró el despacho.' })
  async syncDispatchStatus(@Param('trackingNumber') trackingNumber: string) {
    if (!trackingNumber) {
      throw new BadRequestException('El número de rastreo del despacho es requerido');
    }

    try {
      await this.shipmentsService.syncShipmentsStatusByDispatchTracking(trackingNumber);
      
      return {
        message: 'Proceso de sincronización finalizado',
        dispatchTracking: trackingNumber,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      // El error ya viene con mensaje desde el service
      throw new BadRequestException(error.message);
    }
  }

  @Post('fedex-direct')
  async getFedexDirect(@Body('trackingNumbers') trackingNumbers: string[]) {
    console.log("🚀 ~ ShipmentsController ~ getFedexDirect ~ trackingNumbers:", trackingNumbers);

    if (!trackingNumbers || trackingNumbers.length === 0) {
      throw new BadRequestException('Se requieren números de guía');
    }
    return await this.shipmentsService.trackFedexDirect(trackingNumbers);
  }

  @Post('audit-universal')
  @ApiOperation({ 
    summary: '🛡️ Auditoría Forense Universal (Titanium)', 
    description: 'Ejecuta el proceso de auditoría y recuperación de ingresos para múltiples entidades. Soporta UUIDs nativos o Folios Públicos.'
  })
  @ApiQuery({
    name: 'applyFix',
    required: false,
    type: Boolean,
    description: 'Si es true, aplica las correcciones y genera ingresos en BD. Si es false, solo simula.',
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Auditoría ejecutada correctamente. Devuelve el reporte detallado.',
    schema: {
      example: {
        summary: { total_processed: 5, healthy: 4, issues_found: 1, fixed: 0 },
        details: []
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos (DTO falló).' })
  @ApiResponse({ status: 404, description: 'No se encontraron guías para la entidad proporcionada.' })
  async universalAudit(
    @Body() body: UniversalAuditDto, // ✅ Usamos el DTO blindado
    @Query('applyFix', new ParseBoolPipe({ optional: true })) applyFix: boolean = false
  ) {
    return await this.shipmentsService.auditByEntity(
      body.entityType,
      body.identifier,
      applyFix
    );
  }

  @Get('undelivered/:subsidiaryId')
  async getNonDeliveredShipments(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('date') date: string
  ) {
    const parsedDate = dayjs(date).toDate();
    return await this.shipmentsService.findNonDeliveredShipments(subsidiaryId, parsedDate);
  }

  @Post('check-44-status')
  async checkStatus44ForShipments(@Body('trackingNumbers') trackingNumbers: string[]) {
    
    // 1. Validación de la entrada
    if (!trackingNumbers || !Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
      throw new BadRequestException('Se requiere una lista válida y no vacía de números de rastreo (trackingNumbers).');
    }

    try {
      // 2. Ejecutar el método directamente con la lista recibida
      const results = await this.shipmentsService.check44ByTrackingNumbers(trackingNumbers);

      // 3. Contar los que dieron positivo para el estatus 44
      const shipmentsWith44 = results.filter(r => r.has44);

      // 4. Retornar la respuesta estructurada
      return {
        success: true,
        message: 'Verificación de estatus 44 completada',
        totalReceived: trackingNumbers.length,
        totalWith44: shipmentsWith44.length,
        data: results, 
      };

    } catch (error) {
      // Manejo de errores
      this.logger.error(`Error verificando estatus 44 para la lista proporcionada: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Ocurrió un problema interno al verificar los estatus en FedEx.');
    }
  }
}

