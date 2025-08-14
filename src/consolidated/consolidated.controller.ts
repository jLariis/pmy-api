import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ConsolidatedService } from './consolidated.service';
import { CreateConsolidatedDto } from './dto/create-consolidated.dto';
import { UpdateConsolidatedDto } from './dto/update-consolidated.dto';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('consolidated')
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

  @Get('')
  findAll(
    @Query('subsidiaryId') subsidiaryId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    const fDate = new Date(fromDate);
    const tDate = new Date(toDate);

    return this.consolidatedService.findAll(subsidiaryId, fDate, tDate);
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

  @Get('lastConsolidated/:subdiaryId')
  getLastConsolidated(@Param('subsidiaryId') subsidiaryId: string) {
    console.log("🚀 ~ ConsolidatedController ~ getLastConsolidated ~ subsidiaryId:", subsidiaryId)
    return this.consolidatedService.lastConsolidatedBySucursal(subsidiaryId);
  }

}
