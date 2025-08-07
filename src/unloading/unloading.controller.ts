import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { UnloadingService } from './unloading.service';
import { CreateUnloadingDto } from './dto/create-unloading.dto';
import { UpdateUnloadingDto } from './dto/update-unloading.dto';

@Controller('unloadings')
export class UnloadingController {
  constructor(private readonly unloadingService: UnloadingService) {}

  @Post()
  create(@Body() createUnloadingDto: CreateUnloadingDto) {
    return this.unloadingService.create(createUnloadingDto);
  }

  @Get(':subsidiaryId')
  findBySubsidiary(@Param('subsidiaryId') subsidiaryId: string) {
    return this.unloadingService.findAllBySubsidiary(subsidiaryId);
  }

  @Get()
  findAll() {
    return this.unloadingService.findAll();
  }

  @Get('validate-tracking-number/:trackingNumber/:subsidiaryId')
  validateTrackingNumber(@Param('trackingNumber') trackingNumber: string, @Param('subsidiaryId') subsidiaryId: string) {
    return this.unloadingService.validateTrackingNumber(trackingNumber, subsidiaryId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUnloadingDto: UpdateUnloadingDto) {
    return this.unloadingService.update(+id, updateUnloadingDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.unloadingService.remove(+id);
  }
}
