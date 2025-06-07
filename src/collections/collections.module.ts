import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Collection } from 'src/entities/collection.entity';
import { CollectionsService } from './collections.service';
import { CollectionsController } from './collections.controller';
import { FedexService } from 'src/shipments/fedex.service';

@Module({
  imports: [TypeOrmModule.forFeature([Collection])],
  controllers: [CollectionsController],
  providers: [CollectionsService, FedexService],
  exports: [CollectionsService],
})
export class CollectionModule {}
