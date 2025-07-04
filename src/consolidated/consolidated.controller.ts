import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ConsolidatedService } from './consolidated.service';
import { CreateConsolidatedDto } from './dto/create-consolidated.dto';
import { UpdateConsolidatedDto } from './dto/update-consolidated.dto';
import { ShipmentsService } from 'src/shipments/shipments.service';

@Controller('consolidated')
export class ConsolidatedController {
  constructor(
    private readonly consolidatedService: ConsolidatedService,
    private readonly shipmentService: ShipmentsService
  ) {}

  @Get('update-fedex-status')
  async updateFedexStatus() {
    console.log("Actualizando estatus de FEDEX!")
    return await this.shipmentService.checkStatusOnFedex();
  }

  @Post()
  create(@Body() createConsolidatedDto: CreateConsolidatedDto) {
    return this.consolidatedService.create(createConsolidatedDto);
  }

  @Get()
  findAll() {
    return this.consolidatedService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.consolidatedService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateConsolidatedDto: UpdateConsolidatedDto) {
    return this.consolidatedService.update(id, updateConsolidatedDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.consolidatedService.remove(id);
  }

}
