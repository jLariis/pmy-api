import { Module } from '@nestjs/common';
import { UnloadingService } from './unloading.service';
import { UnloadingController } from './unloading.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Unloading } from 'src/entities/unloading.entity';
import { ChargeShipment, Shipment } from 'src/entities';
import { MailService } from 'src/mail/mail.service';

@Module({
  imports: [TypeOrmModule.forFeature([Unloading, Shipment, ChargeShipment])],
  controllers: [UnloadingController],
  providers: [UnloadingService, MailService],
})
export class UnloadingModule {}
