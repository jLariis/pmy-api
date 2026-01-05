import { Injectable, Logger } from '@nestjs/common';
import { MailService } from 'src/mail/mail.service';
import { FedexService } from 'src/shipments/fedex.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { PackageDispatchService } from 'src/package-dispatch/package-dispatch.service';
import { UnloadingService } from 'src/unloading/unloading.service';
import { InventoriesService } from 'src/inventories/inventories.service';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly fedexService: FedexService,
    private readonly shipmentService: ShipmentsService,
    private readonly packageDispatchService: PackageDispatchService,
    private readonly consolidatedService: ConsolidatedService,
    private readonly unloadingService: UnloadingService,
    private readonly inventoryService: InventoriesService,
  ) {}

  async getConsolidatedsBySubsidiary(subdiaryId: string) {
    const consolidateds  = await this.consolidatedService.findBySubsidiary(subdiaryId)
    return consolidateds;
  }

  async getPackageDispatchBySubsidiary(subdiaryId: string) {
    const packageDispatchs = await this.packageDispatchService.findBySubsidiary(subdiaryId);
    return packageDispatchs;
  }

  async getUnloadingsBySubsidiary(subdiaryId: string) {
    const unloadings = await this.unloadingService.findBySubsidiaryId(subdiaryId);
    return unloadings;
  }

  async getInfoFromPackageDispatch(packageDispatchId: string) {
    const packageDispatch = await this.packageDispatchService.findShipmentsByDispatchId(packageDispatchId);
    return packageDispatch;
  }

  async getInfoFromConsolidated(consolidatedId: string) {
    const packages = await this.consolidatedService.findShipmentsByConsolidatedId(consolidatedId);
    return packages;
  }

  async getInfoFromUnloading(unloadingId: string) {
    const packages = await this.unloadingService.findShipmentsByUnloadingId(unloadingId);
    return packages; 
  }

  async updateFedexFromConsolidated(consolidatedId: string) {
    const updatedPackages = await this.consolidatedService.updateFedexDataByConsolidatedId(consolidatedId);
    return updatedPackages;
  }

  async updateFedexFromUnloading(unloadingId: string) {
    const updatedPackages = await this.unloadingService.updateFedexDataByUnloadingId(unloadingId);
    return updatedPackages;
  }

  async updateFedexFromPackageDispatch(packageDispatchId: string) {
    const updatedPackages = await this.packageDispatchService.updateFedexDataByPackageDispatchId(packageDispatchId);
    return updatedPackages;
  }

  async getShipmentsWithout67(consolidatedId: string){
    const shipments = await this.consolidatedService.getShipmentsWithout67ByConsolidated(consolidatedId);
    return shipments;
  }

  async getShipmentsWithout67ByUnloading(unloadingId: string){
    const shipments = await this.unloadingService.getShipmentsWithout67ByUnloading(unloadingId);
    return shipments;
  }

  async getShipmentsWithout67ByPackageDispatch(packageDispatchId: string){
    const shipments = await this.packageDispatchService.getShipmentsWithout67ByPackageDispatch(packageDispatchId);
    return shipments;
  }

  async checkInventory67(subsidiaryId: string){
    const shipments = await this.inventoryService.checkInventory67BySubsidiary(subsidiaryId);
    return shipments;
  }

  async generateInventory67Excel(subsidiaryId: string, subsidiaryName?: string){
    return this.inventoryService.downloadExcelReport(subsidiaryId, subsidiaryName);
  }


}
