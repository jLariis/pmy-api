import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { KpiService } from "./kpi.service";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
    constructor(private readonly kpiService: KpiService){}

    @Get('subsidiary-metrics')
    async getSubsidiaryKpis(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
        return this.kpiService.getSubsidiaryKpis(startDate, endDate);
    }


    @Post('subsidiary-metrics-subsidiary')
    async getSubsidiaryKpisSubsidisary(
        @Body() body: {
            startDate: string,
            endDate: string,
            subsidiaryIds: string[]
        }     
    ) {
        return this.kpiService.getSubsidiariesKpis(body.startDate, body.endDate, body.subsidiaryIds);
    }
}