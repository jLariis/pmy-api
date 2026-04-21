import { Controller, Get, Query, ParseArrayPipe } from "@nestjs/common";
import { KpiService } from "./kpi.service";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
    constructor(private readonly kpiService: KpiService){}

    @Get('subsidiary-metrics')
    async getSubsidiaryKpis(
        @Query('startDate') startDate: string, 
        @Query('endDate') endDate: string,
        // Este Pipe mágico de NestJS convierte "id1,id2" -> ["id1", "id2"]
        @Query('subsidiaryIds', new ParseArrayPipe({ items: String, separator: ',', optional: true })) 
        subsidiaryIds?: string[]
    ) {
        return this.kpiService.getSubsidiariesKpis(startDate, endDate, subsidiaryIds);
    }
}