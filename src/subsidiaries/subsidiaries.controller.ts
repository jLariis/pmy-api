import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { SubsidiariesService } from './subsidiaries.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from 'src/auth/guards/admin.guard';
import { CreateSubsidiaryDto } from './dto/create-subsidiary.dto';
import { UpdateSubsidiaryDto } from './dto/update-subsidiary.dto';

@ApiTags('subsidiaries')
@ApiBearerAuth()
@Controller('subsidiaries')
export class SubsidiariesController {
  constructor(private readonly subsidiariesService: SubsidiariesService) {}

  @Get()
  getAll(){
    return this.subsidiariesService.findAll();
  }

  @Post()
  @UseGuards(AdminGuard)
  save(@Body() dto: CreateSubsidiaryDto, @Req() req: any) {
    return this.subsidiariesService.create(dto, req.user?.userId);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateSubsidiaryDto) {
    return this.subsidiariesService.update(id, dto);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.subsidiariesService.findById(id);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  deleteById(@Param('id') id: string) {
    return this.subsidiariesService.delete(id)
  }
}
