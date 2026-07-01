import { Body, Controller, Get, HttpCode, Param, ParseArrayPipe, Post, Req, UseGuards } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { CollectionDto } from './dto/collection.dto';
import { ApiOperation, ApiBody, ApiCreatedResponse, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Collection } from 'src/entities/collection.entity';
import { PermissionsGuard } from 'src/auth/guards/permissions.guard';
import { SubsidiaryScopeGuard } from 'src/auth/guards/subsidiary-scope.guard';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';

@ApiTags('collections')
@ApiBearerAuth()
@Controller('collections')
// Recolecciones viven dentro del flujo de Devoluciones → mismo permiso.
@UseGuards(PermissionsGuard)
@RequirePermission('operaciones.devoluciones')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Get(':subsidiaryId')
  @UseGuards(SubsidiaryScopeGuard)
  getIncomeBySucursal(@Param('subsidiaryId') subsidiaryId: string) {
    return this.collectionsService.getAll(subsidiaryId);
  }

  @Post()
  @HttpCode(201) // Código HTTP 201 para creación exitosa
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
  async save(
    @Body(new ParseArrayPipe({ items: CollectionDto })) collectionDto: CollectionDto[],
    @Req() req: any,
  ) {
    return this.collectionsService.save(collectionDto, req.user?.userId);
  }

  @Get('validate/:trackingNumber')
  validateHavePickUpStatus(@Param('trackingNumber') trackingNumber: string){
    return this.collectionsService.validateHavePickUpEvent(trackingNumber);
  }

}
