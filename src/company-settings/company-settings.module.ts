import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanySettings } from 'src/entities';
import { CompanySettingsService } from './company-settings.service';
import { CompanySettingsController } from './company-settings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CompanySettings])],
  controllers: [CompanySettingsController],
  providers: [CompanySettingsService],
  exports: [CompanySettingsService],
})
export class CompanySettingsModule {}
