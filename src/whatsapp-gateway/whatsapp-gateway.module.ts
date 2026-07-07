import { Module } from '@nestjs/common';
import { WhatsappGatewayService } from './whatsapp-gateway.service';
import { WhatsappGatewayController } from './whatsapp-gateway.controller';
import { WhatsappSettingsModule } from 'src/whatsapp-settings/whatsapp-settings.module';

@Module({
  imports: [WhatsappSettingsModule],
  controllers: [WhatsappGatewayController],
  providers: [WhatsappGatewayService],
  exports: [WhatsappGatewayService],
})
export class WhatsappGatewayModule {}
