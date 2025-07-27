import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { DevolutionsService } from './devolutions.service';
import { CreateDevolutionDto } from './dto/create-devolution.dto';

@Controller('devolutions')
export class DevolutionsController {
  constructor(private readonly devolutionsService: DevolutionsService) {}

  @Post()
  create(@Body() createDevolutionDto: CreateDevolutionDto[]) {
    return this.devolutionsService.create(createDevolutionDto);
  }

  @Get(':subsidirayId')
  findAll(@Param('subsidiaryId') subsidiaryId: string) {
    return this.devolutionsService.findAll(subsidiaryId);
  }

  @Get('validate/:trackingNumber')
  findOne(@Param('trackingNumber') trackingNumber: string) {
    return this.devolutionsService.validateOnShipment(trackingNumber);
  }

}
