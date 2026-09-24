import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  MaintenanceFolioCounter, MaintenanceQuote, MaintenanceQuoteItem, MaintenanceRequest, MaintenanceService,
  MaintenanceServiceCategory, PurchaseOrder, PurchaseOrderDispatch, PurchaseOrderItem, Supplier, SupplierContact, Vehicle,
} from 'src/entities';
import { FolioService } from './folio.service';
import { CatalogService } from './catalog/catalog.service';
import { CatalogController } from './catalog/catalog.controller';
import { VehicleKmsModule } from './vehicle-kms.module';
import { SuppliersService } from './suppliers/suppliers.service';
import { SuppliersController } from './suppliers/suppliers.controller';
import { ScheduleService } from './schedule/schedule.service';
import { ScheduleController } from './schedule/schedule.controller';
import { RequestsService } from './requests/requests.service';
import { QuotesService } from './requests/quotes.service';
import { RequestsController } from './requests/requests.controller';
import { PurchaseOrdersService } from './purchase-orders/purchase-orders.service';
import { PurchaseOrdersController } from './purchase-orders/purchase-orders.controller';
import { PoDispatchService } from './dispatch/po-dispatch.service';
import { HistoryService } from './schedule/history.service';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { DocumentsModule } from 'src/documents/documents.module';
import { EmailLogModule } from 'src/email-log/email-log.module';
import { WhatsappGatewayModule } from 'src/whatsapp-gateway/whatsapp-gateway.module';
import { MailService } from 'src/mail/mail.service';

/** Mantenimiento de vehículos: catálogos, solicitudes/cotizaciones, órdenes de compra, programación e historial. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      MaintenanceServiceCategory, MaintenanceService, Supplier, SupplierContact, MaintenanceRequest, MaintenanceQuote,
      MaintenanceQuoteItem, PurchaseOrder, PurchaseOrderItem, PurchaseOrderDispatch, MaintenanceFolioCounter, Vehicle,
    ]),
    VehicleKmsModule,
    NotificationsModule,
    DocumentsModule,
    EmailLogModule,
    WhatsappGatewayModule,
  ],
  controllers: [CatalogController, SuppliersController, ScheduleController, RequestsController, PurchaseOrdersController],
  providers: [
    FolioService, CatalogService, SuppliersService, ScheduleService, RequestsService, QuotesService,
    PurchaseOrdersService, PoDispatchService, HistoryService, MailService,
  ],
})
export class MaintenanceModule {}
