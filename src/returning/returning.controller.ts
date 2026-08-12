import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { ReturningService } from './returning.service';
import { CreateReturningDto } from './dto/create-returning.dto';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';

@ApiTags('returning')
@Controller('returning')
@UseGuards(PermissionsGuard)
@RequirePermission('operaciones.devoluciones')
export class ReturningController {
  constructor(private readonly returningService: ReturningService) {}

  /** Actor (id + nombre legible) del usuario autenticado, para la bitácora de correo. */
  private actorFromReq(req: any): { id?: string; name?: string } {
    const u = req?.user ?? {};
    const name = [u.name, u.lastName].filter(Boolean).join(' ').trim() || u.email || undefined;
    return { id: u.userId, name };
  }

  /** Guardado unificado de una salida (lote de devoluciones + recolecciones). */
  @Post()
  create(@Body() dto: CreateReturningDto, @Req() req: any) {
    return this.returningService.create(dto, req.user?.userId);
  }

  /** KPIs de las salidas de la sucursal (agregados por semana). */
  @Get('kpis/:subsidiaryId')
  getKpis(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.returningService.getKpis(subsidiaryId, { from, to });
  }

  /** Historial de salidas de una sucursal (paginado + filtrado por semana en backend). */
  @Get('subsidiary/:subsidiaryId')
  findBySubsidiary(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    return this.returningService.findBySubsidiary(subsidiaryId, { page, limit, from, to, search });
  }

  /** Detalle de una salida (con sus devoluciones y recolecciones). */
  @Get('detail/:id')
  findOneDetail(@Param('id') id: string) {
    return this.returningService.findOneDetail(id);
  }

  /** Historial de envíos de correo de una salida. */
  @Get(':id/email-history')
  @ApiOperation({ summary: 'Historial de envíos de correo de una salida' })
  getEmailHistory(@Param('id') id: string) {
    return this.returningService.getEmailHistory(id);
  }

  /** Subir PDF+Excel de una salida y enviar/reenviar el correo (con trazabilidad). */
  @Post('upload')
  @UseInterceptors(FilesInterceptor('files'))
  @ApiOperation({ summary: 'Subir PDF/Excel de una salida y enviar por correo' })
  @ApiConsumes('multipart/form-data')
  sendEmail(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('subsidiaryName') subsidiaryName: string,
    @Body('returningHistoryId') returningHistoryId: string,
    @Body('isResend') isResend: string,
    @Req() req: any,
  ) {
    if (!files || files.length !== 2) {
      throw new BadRequestException('Se esperan exactamente dos archivos: un PDF y un Excel.');
    }
    const pdfFile = files.find((f) => f.mimetype === 'application/pdf');
    const excelFile = files.find(
      (f) => f.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    if (!pdfFile || !excelFile) {
      throw new BadRequestException('Se requiere un archivo PDF y un archivo Excel.');
    }
    if (!returningHistoryId) {
      throw new BadRequestException('Falta returningHistoryId para asociar el correo a la salida.');
    }
    const resend = isResend === 'true' || (isResend as any) === true;
    return this.returningService.sendByEmail(
      pdfFile,
      excelFile,
      subsidiaryName,
      returningHistoryId,
      this.actorFromReq(req),
      resend,
    );
  }
}
