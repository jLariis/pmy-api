import { Module } from '@nestjs/common';
import { DevolutionsService } from './devolutions.service';
import { DevolutionsController } from './devolutions.controller';
import { Devolution } from 'src/entities/devolution.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChargeShipment, Income, Shipment, Subsidiary } from 'src/entities';
import { MailService } from 'src/mail/mail.service';

@Module({
  imports: [TypeOrmModule.forFeature([Devolution, Shipment, Income, ChargeShipment, Subsidiary])],
  controllers: [DevolutionsController],
  providers: [DevolutionsService, MailService],
})
export class DevolutionsModule {}
