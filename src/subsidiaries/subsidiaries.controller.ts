import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { SubsidiariesService } from './subsidiaries.service';
import { Subsidiary } from 'src/entities';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';


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
  save(@Body() subsidiary: Subsidiary) {
    return this.subsidiariesService.create(subsidiary);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.subsidiariesService.findById(id);
  }

  @Delete(':id')
  deleteById(@Param('id') id: string) {
    return this.subsidiariesService.delete(id)
  }

}
