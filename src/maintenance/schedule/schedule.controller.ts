import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { SubsidiaryScopeGuard } from 'src/auth/guards/subsidiary-scope.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { ScheduleService } from './schedule.service';
import { UpdateScheduleDto } from './dto/schedule.dto';
import { MTTO } from '../maintenance.permissions';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance/schedule')
@UseGuards(PermissionsGuard)
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  @Get('subsidiary/:subsidiaryId')
  @UseGuards(SubsidiaryScopeGuard)
  @RequirePermission(MTTO.programacion)
  bySubsidiary(@Param('subsidiaryId') subsidiaryId: string) {
    return this.schedule.bySubsidiary(subsidiaryId);
  }

  @Patch('vehicle/:vehicleId')
  @RequirePermission(MTTO.programacion)
  updateVehicle(@Param('vehicleId') vehicleId: string, @Body() dto: UpdateScheduleDto) {
    return this.schedule.updateVehicle(vehicleId, dto);
  }
}
