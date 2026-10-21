import { VehicleKmsModule } from 'src/maintenance/vehicle-kms.module';
import { Module } from '@nestjs/common';
import { RouteclosureService } from './routeclosure.service';
import { RouteclosureController } from './routeclosure.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { RouteClosureManualStatus } from 'src/entities/route-closure-manual-status.entity';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { MailService } from 'src/mail/mail.service';
import { Income } from 'src/entities/income.entity';
import { FedexService } from 'src/shipments/fedex.service';
import { DocumentsModule } from 'src/documents/documents.module';
import { TrackingSyncModule } from 'src/tracking-sync/tracking-sync.module';
import { ClosureDoctorService } from './closure-doctor.service';
import { RouteRiskReportService } from './risk-report/route-risk-report.service';
import { PreClosureContextService } from './pre-closure/pre-closure-context.service';

@Module({
  imports: [TypeOrmModule.forFeature([RouteClosure, PackageDispatch, Income, RouteClosureManualStatus]), DocumentsModule, TrackingSyncModule, VehicleKmsModule],
  controllers: [RouteclosureController],
  providers: [RouteclosureService, ClosureDoctorService, RouteRiskReportService, PreClosureContextService, MailService, FedexService],
})
export class RouteclosureModule {}
