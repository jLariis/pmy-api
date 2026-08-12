import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReturningService } from './returning.service';
import { ReturningController } from './returning.controller';
import { ReturningHistory } from 'src/entities/returning-history.entity';
import { Devolution, Collection } from 'src/entities';
import { DevolutionsModule } from 'src/devolutions/devolutions.module';
import { CollectionModule } from 'src/collections/collections.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReturningHistory, Devolution, Collection]),
    DevolutionsModule,
    CollectionModule,
  ],
  controllers: [ReturningController],
  providers: [ReturningService],
})
export class ReturningModule {}
