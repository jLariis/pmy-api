import { BadRequestException, Body, Controller, Get, Post, Query, ParseArrayPipe, Req } from "@nestjs/common";
import { KpiService } from "./kpi.service";
import { FedexStatusResolver } from "../fedex-status/fedex-status.resolver";
import { VerifyFedexDto } from "./dto/verify-fedex.dto";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

/** Roles "globales" que ven TODAS las sucursales (espejo del SucursalSelector del front). */
const GLOBAL_ROLES = ['superadmin', 'superamin', 'owner'];

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
    constructor(
        private readonly kpiService: KpiService,
        private readonly fedexStatusResolver: FedexStatusResolver,
    ){}

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
    @ApiOperation({ summary: 'Resumen operativo (pendientes, sin escaneo, vencen hoy) acotado por sucursales visibles.' })
    async getWelcome(
        @Req() req: any,
        // Acepta "id1,id2" -> ["id1","id2"]. Compatibilidad: `subsidiaryId` (singular) sigue funcionando.
        @Query('subsidiaryIds', new ParseArrayPipe({ items: String, separator: ',', optional: true }))
        subsidiaryIds?: string[],
        @Query('subsidiaryId') subsidiaryId?: string,
    ) {
        const requested = (subsidiaryIds?.length ? subsidiaryIds : (subsidiaryId ? [subsidiaryId] : []))
            .map((s) => s?.trim())
            .filter(Boolean) as string[];

        const effectiveIds = this.resolveScopedSubsidiaryIds(req, requested);
        // `null` = sin filtro (todas). `[]` (no-global sin sucursal) = resumen vacío.
        if (effectiveIds !== null && effectiveIds.length === 0) {
            return { stats: { pendingYesterday: 0, withoutDEX: 0, expiringToday: 0 }, pendingPackages: [], withoutDEXPackages: [], expiringPackages: [] };
        }
        return this.kpiService.getWelcomeDashboard(effectiveIds ?? undefined);
    }

    @Post('welcome/verify-fedex')
    @ApiOperation({ summary: 'Re-verifica (read-only) el último estatus de las guías contra FedEx.' })
    async verifyFedex(@Body() dto: VerifyFedexDto) {
        const results = await this.fedexStatusResolver.getLatestStatusBatch(dto.trackingNumbers);
        // Payload acotado: solo lo que la UI necesita para comparar y mostrar.
        return results.map((r) => ({
            trackingNumber: r.trackingNumber,
            found: r.found,
            status: r.status,
            description: r.description,
            isDelivered: r.isDelivered,
            lastEvent: r.lastEvent
                ? { description: r.lastEvent.description, date: r.lastEvent.date, location: r.lastEvent.location, exceptionCode: r.lastEvent.exceptionCode }
                : null,
            fetchedAt: r.fetchedAt,
            error: r.error,
        }));
    }

    /**
     * Resuelve las sucursales EFECTIVAS según el rol (espejo del SubsidiaryScopeGuard):
     * - Globales (superadmin/owner): `requested` tal cual, o `null` (todas) si no pidieron nada.
     * - No-globales: intersección de `requested` con sus `subsidiaryIds` (main + adicionales);
     *   si no pidieron nada (o la intersección queda vacía) → todo su set permitido.
     *   Sin sucursal asignada → `[]` (no se expone TODO).
     */
    private resolveScopedSubsidiaryIds(req: any, requested: string[]): string[] | null {
        const role = (req.user?.role || '').toString().toLowerCase();
        const isGlobal = GLOBAL_ROLES.includes(role);
        if (isGlobal) {
            return requested.length ? requested : null;
        }
        const allowed: string[] = Array.isArray(req.user?.subsidiaryIds) ? req.user.subsidiaryIds.filter(Boolean) : [];
        if (!allowed.length) return [];
        if (!requested.length) return allowed;
        const intersection = requested.filter((id) => allowed.includes(id));
        return intersection.length ? intersection : allowed;
    }
}