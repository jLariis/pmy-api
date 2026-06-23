import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';

@ApiTags('vehicles')
@ApiBearerAuth()
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() createVehicleDto: CreateVehicleDto, @Req() req: any) {
    return this.vehiclesService.create(createVehicleDto, req.user?.userId);
  }

  @Get()
  findAll() {
    return this.vehiclesService.findAll();
  }

  @Get('subsidiary/:subsidiaryId')
  findBySubsidiary(@Param('subsidiaryId') subsidiaryId: string) {
    return this.vehiclesService.findBySubsidiary(subsidiaryId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vehiclesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() updateVehicleDto: UpdateVehicleDto) {
    return this.vehiclesService.update(id, updateVehicleDto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.vehiclesService.remove(id);
  }
}
