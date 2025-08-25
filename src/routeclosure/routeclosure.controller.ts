import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { RouteclosureService } from './routeclosure.service';
import { CreateRouteclosureDto } from './dto/create-routeclosure.dto';

@Controller('routeclosure')
export class RouteclosureController {
  constructor(private readonly routeclosureService: RouteclosureService) {}

  @Post()
  create(@Body() createRouteclosureDto: CreateRouteclosureDto) {
    return this.routeclosureService.create(createRouteclosureDto);
  }

  @Get(':subsidiryId')
  findAll(@Param('subsidiaryId') subsidiaryId: string) {
    return this.routeclosureService.findAll(subsidiaryId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.routeclosureService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.routeclosureService.remove(id);
  }
}
