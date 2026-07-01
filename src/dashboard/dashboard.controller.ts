import { BadRequestException, Controller, Get, Query, ParseArrayPipe, Req } from "@nestjs/common";
import { KpiService } from "./kpi.service";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
    constructor(private readonly kpiService: KpiService){}

    @Get('subsidiary-metrics')
    async getSubsidiaryKpis(
        @Req() req: any,
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
        // Este Pipe mágico de NestJS convierte "id1,id2" -> ["id1", "id2"]
        @Query('subsidiaryIds', new ParseArrayPipe({ items: String, separator: ',', optional: true }))
        subsidiaryIds?: string[]
    ) {
        // Validación: fechas requeridas y válidas → 400 claro en vez de 500 desde el service.
        const valid = (d?: string) => !!d && !Number.isNaN(new Date(d).getTime());
        if (!valid(startDate) || !valid(endDate)) {
            throw new BadRequestException('startDate y endDate son obligatorios y deben ser fechas válidas (YYYY-MM-DD).');
        }

        const elevated = (req.user?.role || '').toString().toLowerCase().includes('admin');

        // SCOPING POR SUCURSAL: los NO elevados solo ven SU sucursal. Se ignora
        // cualquier `subsidiaryIds` recibido del cliente (no podrían consultar
        // otras sucursales). Los elevados sí pueden filtrar libremente (o ver todas).
        let effectiveIds = subsidiaryIds;
        if (!elevated) {
            const sub = req.user?.subsidiary;
            const userSubId = typeof sub === 'string' ? sub : sub?.id;
            // Sin sucursal asignada → no se exponen TODAS; devuelve vacío.
            if (!userSubId) return [];
            effectiveIds = [userSubId];
        }

        const metrics = await this.kpiService.getSubsidiariesKpis(startDate, endDate, effectiveIds);

        // SEGURIDAD: solo roles elevados ven INGRESOS/UTILIDAD. Los demás reciben
        // datos operativos + gastos, con los montos de ingreso en 0 (no se filtran
        // ni siquiera por la red). Los gastos sí se permiten.
        if (elevated) return metrics;

        return (metrics as any[]).map((m) => ({
            ...m,
            totalRevenue: 0,
            totalProfit: 0,
            averageRevenuePerPackage: 0,
            generalSummary: m.generalSummary
                ? { totalExpenses: m.generalSummary.totalExpenses, totalIncome: 0, totalProfit: 0 }
                : m.generalSummary,
        }));
    }

    @Get('welcome')
    async getWelcome(@Query('subsidiaryId') subsidiaryId?: string) {
        return this.kpiService.getWelcomeDashboard(subsidiaryId);
    }
}