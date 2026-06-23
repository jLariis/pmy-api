import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { RoutesService } from './routes.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';

@ApiTags('routes')
@ApiBearerAuth()
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() createRouteDto: CreateRouteDto, @Req() req: any) {
    return this.routesService.create(createRouteDto, req.user?.userId);
  }

  @Get('subsidiary/:subsidiaryId')
  findBySubsidiary(@Param('subsidiaryId') subsidiaryId: string) {
    return this.routesService.findBySubsidiary(subsidiaryId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.routesService.findOne(id);
  }

  @Get()
  findAll() {
    return this.routesService.findAll();
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() updateRouteDto: UpdateRouteDto) {
    return this.routesService.update(id, updateRouteDto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.routesService.remove(id);
  }
}
