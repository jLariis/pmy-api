import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { PickUpService } from './pick-up.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SavePickUpDto } from './dto/save-pick-up.dto';

@ApiTags('pick-up')
@ApiBearerAuth()
@Controller('pick-up')
@UseGuards(JwtAuthGuard)
export class PickUpController {
  constructor(private readonly pickUpService: PickUpService) {}

  @Post('/save')
  create(@Body() savePickUpDto: SavePickUpDto, @Request() req) {
    return this.pickUpService.create(savePickUpDto, req.user?.userId);
  }

  @Get('/tracking-info/:trackingNumber')
  findByTrackingNumber(@Param('trackingNumber') trackingNumber: string) {
    return this.pickUpService.findByTrackingNumber(trackingNumber);
  }

  @Get('/subsidiary/:subsidiaryId')
  findBySubsidiary(
    @Param('subsidiaryId') subsidiaryId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
  ) {
    return this.pickUpService.findBySubsidiary(subsidiaryId, { page, limit, from, to, search, type });
  }
}
