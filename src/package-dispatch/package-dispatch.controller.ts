import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { PackageDispatchService } from './package-dispatch.service';
import { CreatePackageDispatchDto } from './dto/create-package-dispatch.dto';
import { UpdatePackageDispatchDto } from './dto/update-package-dispatch.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('package-dispatchs')
@ApiBearerAuth()
@Controller('package-dispatchs')
export class PackageDispatchController {
  constructor(private readonly packageDispatchService: PackageDispatchService) {}

  @Post()
  create(@Body() createPackageDispatchDto: CreatePackageDispatchDto) {
    console.log("🚀 ~ PackageDispatchController ~ create ~ createPackageDispatchDto:", createPackageDispatchDto)
    return this.packageDispatchService.create(createPackageDispatchDto);
  }

  @Get()
  findAll() {
    return this.packageDispatchService.findAll();
  }

  @Get(':subsidiaryId')
  findBySubsidiary(@Param('subsidiaryId') subsidiaryId: string) {
    return this.packageDispatchService.findAllBySubsidiary(subsidiaryId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.packageDispatchService.findOne(id);
  }

  @Get('validate-tracking-number/:trackingNumber/:subsidiaryId')
  validateTrackingNumber(@Param('trackingNumber') trackingNumber: string, @Param('subsidiaryId') subsidiaryId: string) {
    return this.packageDispatchService.validateTrackingNumber(trackingNumber, subsidiaryId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePackageDispatchDto: UpdatePackageDispatchDto) {
    return this.packageDispatchService.update(id, updatePackageDispatchDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.packageDispatchService.remove(id);
  }
}
