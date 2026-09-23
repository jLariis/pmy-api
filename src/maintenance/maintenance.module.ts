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

/** Mantenimiento de vehículos: catálogos, solicitudes/cotizaciones, órdenes de compra, programación e historial. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      MaintenanceServiceCategory, MaintenanceService, Supplier, SupplierContact, MaintenanceRequest, MaintenanceQuote,
      MaintenanceQuoteItem, PurchaseOrder, PurchaseOrderItem, PurchaseOrderDispatch, MaintenanceFolioCounter, Vehicle,
    ]),
    VehicleKmsModule,
  ],
  controllers: [CatalogController],
  providers: [FolioService, CatalogService],
})
export class MaintenanceModule {}
