import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappSettings } from 'src/entities';
import { WhatsappSettingsService } from './whatsapp-settings.service';
import { WhatsappSettingsController } from './whatsapp-settings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WhatsappSettings])],
  controllers: [WhatsappSettingsController],
  providers: [WhatsappSettingsService],
  exports: [WhatsappSettingsService],
})
export class WhatsappSettingsModule {}
