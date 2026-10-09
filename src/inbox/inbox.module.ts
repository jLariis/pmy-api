import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxMessage } from '../entities/inbox-message.entity';
import { InboxAttachment } from '../entities/inbox-attachment.entity';
import { InboxDetection } from '../entities/inbox-detection.entity';
import { InboxConsolidation } from '../entities/inbox-consolidation.entity';
import { InboxSignalAlias } from '../entities/inbox-signal-alias.entity';
import { InboxSyncState } from '../entities/inbox-sync-state.entity';
import { SubsidiaryZipCoverage } from '../entities/subsidiary-zip-coverage.entity';
import { InboxController } from './inbox.controller';
import { ImapReaderService } from './imap-reader.service';
import { KnowledgeService } from './knowledge.service';
import { ZipCoverageService } from './zip-coverage.service';
import { InboxIngestService } from './inbox-ingest.service';
import { InboxLinkService } from './inbox-link.service';
import { InboxReviewService } from './inbox-review.service';
import { InboxQueryService } from './inbox-query.service';
import { InboxCrons } from './inbox.crons';
import { InboxPasteService } from './inbox-paste.service';
import { SystemMatchService } from './system-match.service';
import { WhatsappGatewayModule } from '../whatsapp-gateway/whatsapp-gateway.module';
import { OpsAlertsModule } from '../ops-alerts/ops-alerts.module';

/** Bandeja de correos FedEx: lectura IMAP, detección de sucursal y recibido vs subido. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      InboxMessage,
      InboxAttachment,
      InboxDetection,
      InboxConsolidation,
      InboxSignalAlias,
      InboxSyncState,
      SubsidiaryZipCoverage,
    ]),
    WhatsappGatewayModule,
    OpsAlertsModule,
  ],
  controllers: [InboxController],
  providers: [
    ImapReaderService,
    KnowledgeService,
    ZipCoverageService,
    InboxIngestService,
    InboxLinkService,
    InboxReviewService,
    InboxQueryService,
    InboxCrons,
    InboxPasteService,
    SystemMatchService,
  ],
  exports: [InboxIngestService, KnowledgeService, ZipCoverageService],
})
export class InboxModule {}
