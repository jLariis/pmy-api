import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SuperAdminGuard } from 'src/audit/super-admin.guard';
import { TrackingCompareService } from './tracking-compare.service';

/**
 * Panel experimental (solo superadmin): comparación en vivo contra FedEx y corrección
 * manual de estatus. Read-only salvo POST /apply.
 */
@ApiTags('tracking-sync')
@UseGuards(SuperAdminGuard)
@Controller('tracking-sync')
export class TrackingSyncController {
  constructor(private readonly compare: TrackingCompareService) {}

  @Get('compare/tracking/:trackingNumber')
  @ApiOperation({ summary: 'Compara una guía contra FedEx (en vivo)' })
  compareTracking(@Param('trackingNumber') trackingNumber: string) {
    return this.compare.compareByTracking(trackingNumber);
  }

  @Get('compare/route/:routeId')
  @ApiOperation({ summary: 'Compara todas las guías de una salida a ruta' })
  compareRoute(@Param('routeId') routeId: string) {
    return this.compare.compareByRoute(routeId);
  }

  @Get('compare/consolidated/:consolidatedId')
  @ApiOperation({ summary: 'Compara todas las guías de un consolidado/devolución' })
  compareConsolidated(@Param('consolidatedId') consolidatedId: string) {
    return this.compare.compareByConsolidated(consolidatedId);
  }

  @Post('apply')
  @ApiOperation({ summary: 'Aplica el estatus de FedEx (status-only) a las guías indicadas' })
  apply(@Body() body: { shipmentIds: string[] }, @Req() req: any) {
    const actor = { userId: req.user?.id, userName: req.user?.name, role: req.user?.role };
    return this.compare.applyMany(body?.shipmentIds ?? [], actor);
  }
}
