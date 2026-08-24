import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportFile } from 'src/entities/import-file.entity';
import { Consolidated } from 'src/entities/consolidated.entity';
import { ImportFilesService } from './import-files.service';
import { ImportFilesController } from './import-files.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ImportFile, Consolidated])],
  controllers: [ImportFilesController],
  providers: [ImportFilesService],
  exports: [ImportFilesService],
})
export class ImportFilesModule {}
