import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';

@ApiTags('drivers')
@ApiBearerAuth()
@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() createDriverDto: CreateDriverDto, @Req() req: any) {
    return this.driversService.create(createDriverDto, req.user?.userId);
  }

  @Get()
  findAll() {
    return this.driversService.findAll();
  }

  @Get('subsidiary/:subsidiaryId')
  findBySubsidiary(@Param('subsidiaryId') subsidiaryId: string) {
    return this.driversService.findBySubsidiary(subsidiaryId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.driversService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() updateDriverDto: UpdateDriverDto) {
    return this.driversService.update(id, updateDriverDto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.driversService.remove(id);
  }
}
