import { Module } from '@nestjs/common';
import { WhatsappGatewayService } from './whatsapp-gateway.service';
import { WhatsappGatewayController } from './whatsapp-gateway.controller';

@Module({
  controllers: [WhatsappGatewayController],
  providers: [WhatsappGatewayService],
  exports: [WhatsappGatewayService],
})
export class WhatsappGatewayModule {}
