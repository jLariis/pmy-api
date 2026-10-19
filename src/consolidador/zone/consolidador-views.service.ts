import { BadRequestException, Injectable } from '@nestjs/common';
import { ConsolidadorReadService } from '../read/consolidador-read.service';
import { ConsolidadorGroupsService } from '../read/consolidador-groups.service';
import { CobrosAuditService } from '../audit/cobros-audit.service';
import { ChargeGuidesService } from '../audit/charge-guides.service';
import { CollectionsAuditService } from '../audit/collections-audit.service';
import { NoVanAuditService } from '../audit/novan-audit.service';
import { ZONE_VIEWS, type ZoneView } from './zone.types';

/**
 * Despacha una vista del Consolidador para UNA sucursal, con las mismas fechas que sus endpoints
 * por sucursal (YYYY-MM-DD lun–dom → inicio/fin de día). Lo usa el endpoint por zona.
 */
@Injectable()
export class ConsolidadorViewsService {
  constructor(
    private readonly read: ConsolidadorReadService,
    private readonly groups: ConsolidadorGroupsService,
    private readonly cobrosAudit: CobrosAuditService,
    private readonly chargeGuides: ChargeGuidesService,
    private readonly collections: CollectionsAuditService,
    private readonly novan: NoVanAuditService,
  ) {}

  assertView(view: string): ZoneView {
    if (!ZONE_VIEWS.includes(view as ZoneView)) throw new BadRequestException('Vista no válida.');
    return view as ZoneView;
  }

  forSubsidiary(view: ZoneView, subsidiaryId: string, fromDate: string, toDate: string): Promise<unknown> {
    const from = new Date(`${fromDate}T00:00:00.000`);
    const to = new Date(`${toDate}T23:59:59.999`);
    switch (view) {
      case 'week':
        return this.read.getWeek(subsidiaryId, from, to, {} as any);
      case 'by-route':
        return this.groups.getByRoute(subsidiaryId, from, to);
      case 'by-consolidado':
        return this.groups.getByConsolidado(subsidiaryId, from, to);
      case 'cobros-audit':
        return this.cobrosAudit.audit(subsidiaryId, from, to);
      case 'charge-guides':
        return this.chargeGuides.report(subsidiaryId, fromDate, toDate);
      case 'collections':
        return this.collections.report(subsidiaryId, fromDate, toDate);
      case 'novan':
        return this.novan.report(subsidiaryId, fromDate, toDate);
      default:
        throw new BadRequestException('Vista no válida.');
    }
  }
}
