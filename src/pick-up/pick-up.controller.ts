import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { PickUpService } from './pick-up.service';
import { UpdatePickUpDto } from './dto/update-pick-up.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ForPickUp } from 'src/entities/for-pick-up.entity';

@ApiTags('pick-up')
@ApiBearerAuth()
@Controller('pick-up')
@UseGuards(JwtAuthGuard)
export class PickUpController {
  constructor(private readonly pickUpService: PickUpService) {}

  @Post('/save')
  create(@Body() createPickUpDto: ForPickUp[], @Request() req) {
    const userId = req.user?.userId;

    createPickUpDto.forEach(item => {
      item.createdById = userId;
      item.date = new Date();
    });

    console.log("🚀 ~ PickUpController ~ create ~ createPickUpDto:", createPickUpDto)

    return this.pickUpService.create(createPickUpDto);
  }

  @Get()
  findAll() {
    return this.pickUpService.findAll();
  }

  @Get('/tracking-info/:trackingNumber')
  findByTrackingNumber(@Param('trackingNumber') trackingNumber: string) {
    return this.pickUpService.findByTrackingNumber(trackingNumber);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.pickUpService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePickUpDto: UpdatePickUpDto) {
    return this.pickUpService.update(+id, updatePickUpDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.pickUpService.remove(+id);
  }
}
