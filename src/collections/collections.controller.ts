import { Body, Controller, Get, HttpCode, Param, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { CollectionDto } from './dto/collection.dto';
import { ApiOperation, ApiBody, ApiCreatedResponse, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Collection } from 'src/entities/collection.entity';

@ApiTags('collections')
@ApiBearerAuth()
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Get(':subsidiary')
  getIncomeBySucursal(@Param('subsidiary') subsidiary: string) {
    return this.collectionsService.getAll(subsidiary);
  }

  @Post()
  @HttpCode(201) // Código HTTP 201 para creación exitosa
  @UsePipes(new ValidationPipe({ transform: true })) // Valida y transforma el cuerpo
  @ApiOperation({ summary: 'Save a single collection or multiple collections' })
  @ApiBody({ 
    description: 'A single CollectionDto or an array of CollectionDto',
    type: CollectionDto,
  })
  @ApiCreatedResponse({ 
    description: 'The collection(s) has been successfully saved.',
    type: Collection, // Tipo de retorno para documentación
    isArray: true, // Indica que puede ser un array
  })
  async save(@Body() collectionDto: CollectionDto[]) {
    return this.collectionsService.save(collectionDto);
  }

  @Get('validate/:trackingNumber')
  validateHavePickUpStatus(@Param('trackingNumber') trackingNumber: string){ 
    return this.collectionsService.validateHavePickUpEvent(trackingNumber);
  }

}
