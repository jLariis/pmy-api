import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Public } from 'src/auth/decorators/decorators/public-decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { FedexService } from './fedex.service';

@ApiTags('exercise-api')
@ApiBearerAuth()
@Controller('shipments')
export class ShipmentsController {
  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly fedexService: FedexService
  ) {}

  @Get()
  allShipments(){
    return this.shipmentsService.findAll();
  }

  @Post()
  saveShipments(@Body() createShipmentDto: any) {
    //return this.shipmentsService.create(createShipmentDto);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    return this.shipmentsService.processExcelFile(file);
  }

  @Get('test-tracking')
  testTracking(){
    return this.shipmentsService.checkStatusOnFedex();
    //return this.fedexService.trackPackage("285606643730");
  }


}
