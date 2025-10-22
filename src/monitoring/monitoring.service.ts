import { Injectable, Logger } from '@nestjs/common';
import { MailService } from 'src/mail/mail.service';
import { FedexService } from 'src/shipments/fedex.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { PackageDispatchService } from 'src/package-dispatch/package-dispatch.service';
import { UnloadingService } from 'src/unloading/unloading.service';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly fedexService: FedexService,
    private readonly shipmentService: ShipmentsService,
    private readonly packageDispatchService: PackageDispatchService,
    private readonly consolidatedService: ConsolidatedService,
    private readonly unloadingService: UnloadingService
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





}
