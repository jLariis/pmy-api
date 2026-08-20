import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';
import { HolidaysService } from './holidays.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';

@ApiTags('holidays')
@ApiBearerAuth()
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly service: HolidaysService) {}

  /** Lectura: cualquier autenticado (para mostrar en Configuración). */
  @Get()
  getAll() {
    return this.service.getAll();
  }

  /** Escritura: solo admin. */
  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateHolidayDto, @Req() req: any) {
    return this.service.create(dto, req?.user?.userId ?? null);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
