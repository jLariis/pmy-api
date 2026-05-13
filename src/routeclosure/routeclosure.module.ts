import { Module } from '@nestjs/common';
import { RouteclosureService } from './routeclosure.service';
import { RouteclosureController } from './routeclosure.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { MailService } from 'src/mail/mail.service';
import { Income } from 'src/entities/income.entity';
import { FedexService } from 'src/shipments/fedex.service';

@Module({
  imports: [TypeOrmModule.forFeature([RouteClosure, PackageDispatch, Income])],
  controllers: [RouteclosureController],
  providers: [RouteclosureService, MailService, FedexService],
})
export class RouteclosureModule {}
