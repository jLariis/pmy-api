import { Controller, Get, Post, Body, Param, Delete, BadRequestException, UploadedFiles, UseInterceptors, Req } from '@nestjs/common';
import { RouteclosureService } from './routeclosure.service';
import { CreateRouteclosureDto } from './dto/create-routeclosure.dto';
import { ValidateTrackingsForClosureDto } from './dto/validate-trackings-for-closure';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { NoAudit } from 'src/audit/audit.decorator';

@Controller('route-closure')
export class RouteclosureController {
  constructor(private readonly routeclosureService: RouteclosureService) {}

  @Post()
  create(@Body() createRouteclosureDto: CreateRouteclosureDto, @Req() req: any) {
    return this.routeclosureService.create(createRouteclosureDto, req.user?.userId);
  }

  @Get(':subsidiryId')
  findAll(@Param('subsidiaryId') subsidiaryId: string) {
    return this.routeclosureService.findAll(subsidiaryId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.routeclosureService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.routeclosureService.remove(id);
  }

  @NoAudit() // Validación por escaneo durante el cierre: ruido, no auditable.
  @Post('validateTrackingsForClosure')
  validateTrackingsForClosure(
    @Body() validateTrackingForClosure: ValidateTrackingsForClosureDto
  ) {
    return this.routeclosureService.validateTrackingNumbersForClosure(validateTrackingForClosure);
  }

  // Se llama AL ABRIR el cierre a ruta: reconcilia y persiste el último estatus FedEx de
  // todas las guías (shipments + F2), para que los buckets del cierre reflejen la realidad
  // y el `en_ruta` interno no le gane al estatus real del mismo día.
  @Post('reconcile/:packageDispatchId')
  reconcileRouteWithFedex(
    @Param('packageDispatchId') packageDispatchId: string,
    @Req() req: any,
  ) {
    return this.routeclosureService.reconcileRouteWithFedex(packageDispatchId, {
      userId: req.user?.userId,
      userName: req.user?.name ?? req.user?.userName,
      role: req.user?.role,
    });
  }

  @NoAudit() // Validación por escaneo durante el cierre: ruido, no auditable.
  @Post('validateNoVanTrackings')
  validateNoVanTrackings(
    @Body('noVanTrackingNumbers') noVanTrackingNumbers: string[]
  ) {
    console.log("🚀 ~ RouteclosureController ~ validateNoVanTrackings ~ noVanTrackingNumbers:", noVanTrackingNumbers)
    return this.routeclosureService.validateTrackingNumbersNoVan(noVanTrackingNumbers);
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
      @Body('routeClosureId') routeClosureId: string
    ) {
      console.log('🚀 ~ PackageDispatchController ~ sendEmail ~ files:', files);
          console.log('🚀 ~ PackageDispatchController ~ sendEmail ~ routeClosureId:', routeClosureId);
      
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
      return this.routeclosureService.sendByEmail(pdfFile, excelFile, routeClosureId)
    }
}
