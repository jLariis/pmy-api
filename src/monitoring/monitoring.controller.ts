import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
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

}
