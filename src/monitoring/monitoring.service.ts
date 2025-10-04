import { Injectable, Logger } from '@nestjs/common';
import { MailService } from 'src/mail/mail.service';
import { FedexService } from 'src/shipments/fedex.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { PackageDispatchService } from 'src/package-dispatch/package-dispatch.service';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly fedexService: FedexService,
    private readonly shipmentService: ShipmentsService,
    private readonly packageDispatchService: PackageDispatchService,
    private readonly consolidatedService: ConsolidatedService
  ) {}

  async getConsolidatedsBySubsidiary(subdiaryId: string) {
    const consolidateds  = await this.consolidatedService.findBySubsidiary(subdiaryId)
    return consolidateds;
  }

  async getPackageDispatchBySubsidiary(subdiaryId: string) {
    const packageDispatchs = await this.packageDispatchService.findAllBySubsidiary(subdiaryId);
    return packageDispatchs;
  }

  async getDriversBySubsidiary(subdiaryId) {

  }

  async getInfoFromConsolidated(consolidatedId: string) {

  }

  async getInfoFromConsolidateds() {
    
  }





}
