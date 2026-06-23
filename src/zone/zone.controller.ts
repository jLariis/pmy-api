import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { ZoneService } from './zone.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';

@ApiTags('zones')
@ApiBearerAuth()
@Controller('zone')
export class ZoneController {
  constructor(private readonly zoneService: ZoneService) {}

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() createZoneDto: CreateZoneDto, @Req() req: any) {
    return this.zoneService.create(createZoneDto, req.user?.userId);
  }

  @Get()
  findAll() {
    return this.zoneService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.zoneService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() updateZoneDto: UpdateZoneDto) {
    return this.zoneService.update(id, updateZoneDto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.zoneService.remove(id);
  }
}
