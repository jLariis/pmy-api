import { Controller, Get, Post, Body, Patch, Param, Delete, Header, Query, Res } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('monitoring')
@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get('consolidated/:subdiaryId')
  findConsolidatedsBySubsidiary(@Param('subdiaryId') subdiaryId: string) {
    return this.monitoringService.getConsolidatedsBySubsidiary(subdiaryId);
  }

  @Get('package-dispatch/:subdiaryId')
  findPackageDispatchsBySubsidiary(@Param('subdiaryId') subdiaryId: string) {
    return this.monitoringService.getPackageDispatchBySubsidiary(subdiaryId);
  }

  @Get('unloading/:subdiaryId')
  findUnloadingBySubsidiary(@Param('subdiaryId') subdiaryId: string) {
    console.log("🚀 ~ MonitoringController ~ findUnloadingBySubsidiary ~ subdiaryId:", subdiaryId)
    return this.monitoringService.getUnloadingsBySubsidiary(subdiaryId);
  }

  @Get('package-dispatch-info/:packageDispatchId')
  findInfoFromPackageDispatch(@Param('packageDispatchId') packageDispatchId: string) {
    return this.monitoringService.getInfoFromPackageDispatch(packageDispatchId);
  }

  @Get('unloading-info/:unloadingId')
  findInfoFromUnloading(@Param('unloadingId') unloadingId: string) {
    return this.monitoringService.getInfoFromUnloading(unloadingId);
  }

  @Get('consolidated-info/:consolidatedId')
  findInfoFromConsolidated(@Param('consolidatedId') consolidatedId: string) {
    return this.monitoringService.getInfoFromConsolidated(consolidatedId);
  }

  @Get('update-by-package-dispatch/:packageDispatchId')
  updateFedexFromPackageDispatch(@Param('packageDispatchId') packageDispatchId: string) {
    return this.monitoringService.updateFedexFromPackageDispatch(packageDispatchId);
  }

  @Get('update-by-unloading/:unloadingId')
  updateFedexFromUnloading(@Param('unloadingId') unloadingId: string) {
    return this.monitoringService.updateFedexFromUnloading(unloadingId);
  }

  @Get('update-by-consolidated/:consolidatedId')
  updateFedexFromConsolidated(@Param('consolidatedId') consolidatedId: string) {
    return this.monitoringService.updateFedexFromConsolidated(consolidatedId);
  }

  @Get('consolidated/no-67/:consolidatedId')
  getNo67ShipmentsByConsolidated(@Param('consolidatedId') consolidatedId: string, @Query('subsidiaryId') subsidiaryId: string) {
    return this.monitoringService.getShipmentsWithout67(consolidatedId, subsidiaryId);
  }

  @Get('unloading/no-67/:unloadingId')
  getNo67ShipmentsByUnloading(@Param('unloadingId') unloadingId: string, @Query('subsidiaryId') subsidiaryId: string) {
    return this.monitoringService.getShipmentsWithout67ByUnloading(unloadingId, subsidiaryId);
  }

  @Get('package-dispatch/no-67/:packageDispatchId')
  getNo67ShipmentsByPackageDispatch(@Param('packageDispatchId') packageDispatchId: string, @Query('subsidiaryId') subsidiaryId: string) {
    return this.monitoringService.getShipmentsWithout67ByPackageDispatch(packageDispatchId, subsidiaryId);
  }

  @Get('inventory/67/:subsidiaryId')
  checkInventory67(@Param('subsidiaryId') subsidiaryId: string) {
    return this.monitoringService.checkInventory67(subsidiaryId);
  }

  /**
   * Endpoint para descargar Excel directamente
   */
  @Get('inventory-67/:subsidiaryId/excel')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async downloadInventory67Excel(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('nombre') subsidiaryName: string,
    @Res() res: any
  ): Promise<void> {
    try {
      const excelResult = await this.monitoringService.generateInventory67Excel(
        subsidiaryId, 
        subsidiaryName
      );
      
      // Configurar headers para descarga
      res.setHeader('Content-Disposition', `attachment; filename="${excelResult.fileName}"`);
      res.setHeader('Content-Length', excelResult.buffer.length);
      
      // Enviar el archivo
      res.send(excelResult.buffer);
      
    } catch (error) {
      res.status(500).json({
        error: 'Error generando Excel',
        message: error.message
      });
    }
  }

}
