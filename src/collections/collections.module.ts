import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectionsService } from './collections.service';
import { CollectionsController } from './collections.controller';
import { FedexService } from 'src/shipments/fedex.service';
import { Income, Collection, Subsidiary } from 'src/entities';

@Module({
  imports: [TypeOrmModule.forFeature([Collection, Income, Subsidiary])],
  controllers: [CollectionsController],
  providers: [CollectionsService, FedexService],
  exports: [CollectionsService],
})
export class CollectionModule {}
