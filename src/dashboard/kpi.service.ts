import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, Brackets } from 'typeorm';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ChargeShipment, Expense, Income, Shipment, Subsidiary } from 'src/entities';
import { ChargeRule } from 'src/entities/charge-rule.entity';
import { proratedAmountInRange } from 'src/common/expense-proration.util';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import {
  rollupConsolidatedPackageStats,
  emptyPackageStats,
  ConsolidatedRollupInput,
  SubsidiaryPackageStats,
} from './consolidated-package-rollup';

/**
 * Código de cobro efectivo del ingreso (espejo SQL de `effectiveChargeCode`):
 * 'DELIVERED' si entregado; si no, el código de no-entrega guardado.
 */
const RULE_CODE_EXPR = `(CASE WHEN income.incomeType = 'entregado' THEN 'DELIVERED' ELSE income.nonDeliveryStatus END)`;

/** JOINs a charge_rule: `crs` = override de sucursal, `crg` = default global. */
const CHARGE_RULE_SUB_JOIN = `crs.subsidiaryId = income.subsidiaryId AND crs.carrier = income.shipmentType AND crs.code = ${RULE_CODE_EXPR}`;
const CHARGE_RULE_GLOBAL_JOIN = `crg.subsidiaryId IS NULL AND crg.carrier = income.shipmentType AND crg.code = ${RULE_CODE_EXPR}`;

/**
 * Ingreso "contable" según las reglas de la sucursal (regla ÚNICA, espejo SQL de
 * `isCountableIncome`): traslados solo si countTransfersAsIncome; recolecciones
 * siempre; envíos/cargas según `charge_rule` (override de sucursal → global →
 * fallback 1); manual u otros fuera. Requiere `leftJoin('income.subsidiary','sub')`
 * + los JOINs `crs`/`crg` a charge_rule (ver CHARGE_RULE_*_JOIN).
 */
const COUNTABLE_REVENUE_SQL = `SUM(CASE WHEN (
  CASE
    WHEN income.sourceType IN ('tyco','aeropuerto','special_transfer') THEN sub.countTransfersAsIncome
    WHEN income.sourceType = 'collection' THEN 1
    WHEN income.sourceType IN ('shipment','charge') THEN COALESCE(crs.chargeable, crg.chargeable, 1)
    ELSE 0
  END
) = 1 THEN income.cost ELSE 0 END)`;

@Injectable()
export class KpiService {
  private readonly logger = new Logger(KpiService.name);

  constructor(
    @InjectRepository(Income)
    private incomeRepository: Repository<Income>,
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>,
    @InjectRepository(Subsidiary)
    private subsidiaryRepository: Repository<Subsidiary>,
    @InjectRepository(ChargeShipment)
    private chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(Expense)
    private expenseRepository: Repository<Expense>,
    private readonly consolidatedService: ConsolidatedService,
  ) {}

  // ===================== Welcome Dashboard (resumen de inicio) =====================

  /** Estatus "activos" (no entregados/devueltos) para vencimientos y pendientes. */
  private static readonly WELCOME_ACTIVE_STATUSES = [
    ShipmentStatusType.PENDIENTE,
    ShipmentStatusType.EN_RUTA,
    ShipmentStatusType.EN_BODEGA,
    ShipmentStatusType.RECIBIDO_EN_BODEGA,
    ShipmentStatusType.EN_TRANSITO,
    ShipmentStatusType.RECOLECCION,
    ShipmentStatusType.DESCONOCIDO,
  ];

  private static readonly STATUS_LABELS: Record<string, string> = {
    pendiente: 'Pendiente',
    en_ruta: 'En ruta',
    en_bodega: 'En bodega',
    recibido_en_bodega: 'Recibido en bodega',
    en_transito: 'En tránsito',
    recoleccion: 'Recolección',
    desconocido: 'Desconocido',
  };

  /** Inicio/fin del día de HOY en Hermosillo (UTC-7), expresado en UTC. */
  private hermosilloToday(): { todayStart: Date; todayEnd: Date } {
    const now = new Date();
    const hmo = new Date(now.getTime() - 7 * 3600 * 1000); // hora-pared Hermosillo
    const todayStart = new Date(Date.UTC(hmo.getUTCFullYear(), hmo.getUTCMonth(), hmo.getUTCDate(), 7, 0, 0, 0)); // 00:00 Hermosillo
    const todayEnd = new Date(todayStart.getTime() + 24 * 3600 * 1000 - 1);
    return { todayStart, todayEnd };
  }

  /**
   * Resumen de inicio de sesión: pendientes de días anteriores, sin DEX/67 y
   * paquetes que vencen hoy. Acotado por sucursal (si se pasa) y por tamaño.
   */
  async getWelcomeDashboard(subsidiaryIds?: string[]) {
    const { todayStart, todayEnd } = this.hermosilloToday();
    const now = new Date();
    const LIST_LIMIT = 100;
    // Scoping por sucursal: una o varias (In). Sin lista → todas (el controller ya
    // resolvió el alcance por rol antes de llegar aquí).
    const ids = (subsidiaryIds || []).filter(Boolean);
    const subFilter: any = ids.length ? { subsidiary: { id: ids.length === 1 ? ids[0] : In(ids) } } : {};

    // Datos de contacto/logística compartidos por las tres secciones (para el Excel).
    const carrierOf = (s: any): 'DHL' | 'FedEx' => (String(s.shipmentType || '').toUpperCase() === 'DHL' ? 'DHL' : 'FedEx');
    const contactFields = (s: any) => ({
      recipientAddress: s.recipientAddress || '',
      recipientCity: s.recipientCity || '',
      recipientZip: s.recipientZip || '',
      recipientPhone: s.recipientPhone || '',
      consNumber: s.consNumber || '',
      carrier: carrierOf(s),
      commitDateTime: s.commitDateTime ? new Date(s.commitDateTime).toISOString() : null,
    });

    // --- 1. Vencen hoy: commitDateTime dentro de HOY + activos ---
    const expWhere: any = { ...subFilter, status: In(KpiService.WELCOME_ACTIVE_STATUSES), commitDateTime: Between(todayStart, todayEnd) };
    const [expShipments, expShipTotal] = await this.shipmentRepository.findAndCount({
      where: expWhere, relations: ['subsidiary'], order: { commitDateTime: 'ASC' }, take: LIST_LIMIT,
    });
    const [expCharges, expChargeTotal] = await this.chargeShipmentRepository.findAndCount({
      where: expWhere, relations: ['subsidiary'], order: { commitDateTime: 'ASC' }, take: LIST_LIMIT,
    });
    const expiringPackages = [...expShipments, ...expCharges].slice(0, LIST_LIMIT).map((s: any) => {
      const expiry = s.commitDateTime ? new Date(s.commitDateTime) : now;
      return {
        id: s.id,
        trackingNumber: s.trackingNumber,
        recipientName: s.recipientName || '—',
        expiryDate: expiry.toISOString(),
        subsidiaryName: s.subsidiary?.name || '—',
        hoursRemaining: Math.max(0, Math.round((expiry.getTime() - now.getTime()) / 3600000)),
        status: KpiService.STATUS_LABELS[String(s.status)] || String(s.status),
        ...contactFields(s),
      };
    });

    // --- 2. Pendientes de días anteriores: commit < hoy + activos (últimos 60 días) ---
    const overdueFrom = new Date(todayStart.getTime() - 60 * 24 * 3600 * 1000);
    const penWhere: any = { ...subFilter, status: In(KpiService.WELCOME_ACTIVE_STATUSES), commitDateTime: Between(overdueFrom, new Date(todayStart.getTime() - 1)) };
    const [penShipments, penShipTotal] = await this.shipmentRepository.findAndCount({
      where: penWhere, relations: ['subsidiary'], order: { commitDateTime: 'DESC' }, take: LIST_LIMIT,
    });
    const [penCharges, penChargeTotal] = await this.chargeShipmentRepository.findAndCount({
      where: penWhere, relations: ['subsidiary'], order: { commitDateTime: 'DESC' }, take: LIST_LIMIT,
    });
    const pendingPackages = [...penShipments, ...penCharges].slice(0, LIST_LIMIT).map((s: any) => ({
      id: s.id,
      trackingNumber: s.trackingNumber,
      recipientName: s.recipientName || '—',
      status: KpiService.STATUS_LABELS[String(s.status)] || String(s.status),
      subsidiaryName: s.subsidiary?.name || '—',
      createdAt: (s.commitDateTime ? new Date(s.commitDateTime) : s.createdAt || now).toISOString(),
      ...contactFields(s),
    }));

    // --- 3. Sin escaneo local: paquetes ACTIVOS cuyo historial NO tiene el código que
    // MONITOREA SU sucursal — 67 por default, o 44 si `monitorFedexCode44` (mismo criterio que
    // MonitoringService / getMissingScanReportMulti). Así las sucursales de 44 ven lo del 44 y
    // las de 67 lo del 67.
    //
    // Antes se acotaba a [PENDIENTE, EN_BODEGA], lo que SUBCONTABA: sucursales como
    // Caborca/Santa Ana/Sonoyta/Puerto Peñasco tienen guías sin escaneo en otros estatus
    // activos (EN_RUTA, EN_TRANSITO, RECIBIDO_EN_BODEGA, RECOLECCION, DESCONOCIDO) y no
    // aparecían. Ahora se usa el mismo set activo que las secciones 1 y 2. ---
    const scanStatuses = KpiService.WELCOME_ACTIVE_STATUSES;
    const scanCodeOf = (s: any): '67' | '44' => (s.subsidiary?.monitorFedexCode44 === true ? '44' : '67');
    const [sScan, cScan] = await Promise.all([
      this.shipmentRepository.find({ where: { ...subFilter, status: In(scanStatuses) }, relations: ['statusHistory', 'subsidiary'], take: 500 }),
      this.chargeShipmentRepository.find({ where: { ...subFilter, status: In(scanStatuses) }, relations: ['statusHistory', 'subsidiary'], take: 500 }),
    ]);
    const withoutScan = [...sScan, ...cScan].filter((s: any) => {
      const code = scanCodeOf(s);
      return !(s.statusHistory || []).some((h: any) => h.exceptionCode === code);
    });
    const withoutDEXPackages = withoutScan.slice(0, LIST_LIMIT).map((s: any) => ({
      id: s.id,
      trackingNumber: s.trackingNumber,
      recipientName: s.recipientName || '—',
      subsidiaryName: s.subsidiary?.name || '—',
      missingDocument: `Código ${scanCodeOf(s)}`,
      status: KpiService.STATUS_LABELS[String(s.status)] || String(s.status),
      ...contactFields(s),
    }));

    return {
      stats: {
        pendingYesterday: penShipTotal + penChargeTotal,
        withoutDEX: withoutScan.length,
        expiringToday: expShipTotal + expChargeTotal,
      },
      pendingPackages,
      withoutDEXPackages,
      expiringPackages,
    };
  }

  async getSubsidiariesKpis(startDate: string, endDate: string, subsidiaryIds?: string[]) {
    // 1. Manejo de fechas en Zona Horaria Hermosillo (UTC-7 constante)
    const baseStartDate = startDate.split('T')[0];
    const baseEndDate = endDate.split('T')[0];

    const startDateObj = new Date(`${baseStartDate}T00:00:00.000-07:00`);
    const endDateObj = new Date(`${baseEndDate}T23:59:59.999-07:00`);

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      throw new Error('Invalid date format. Please use ISO 8601 format (e.g., YYYY-MM-DD).');
    }

    this.logger.log(`Fetching KPIs: ${baseStartDate} to ${baseEndDate} (conteos desde consolidados)`);

    // 1. Obtener las sucursales base
    const subsidiariesQuery = this.subsidiaryRepository.createQueryBuilder('subsidiary');
    if (subsidiaryIds?.length) {
      subsidiariesQuery.where('subsidiary.id IN (:...subsidiaryIds)', { subsidiaryIds });
    }
    const subsidiaries = await subsidiariesQuery.getMany();

    const hasSubsidiaryFilter = subsidiaryIds?.length > 0;
    // Calificamos la columna por alias: la query de ingresos hace JOIN a `sub`, `crs` y `crg`
    // (todas con columna `subsidiaryId`), por lo que la columna sin calificar es ambigua (ER_NON_UNIQ_ERROR).
    const subsidiaryCondition = (alias: string) =>
      hasSubsidiaryFilter ? `${alias}.subsidiaryId IN (:...subsidiaryIds)` : '1=1';

    // 2. CONTEOS DE PAQUETES: fuente unica = consolidados (mismo motor que la pantalla
    //    de Consolidados). Fechas construidas igual que el controller de consolidados
    //    (new Date('YYYY-MM-DD') -> medianoche UTC) para dar identico.
    const consFrom = new Date(baseStartDate);
    const consTo = new Date(baseEndDate);
    const consolidatedDtos = await this.consolidatedService.findAll(
      hasSubsidiaryFilter ? { subsidiaryIds } : {},
      consFrom,
      consTo,
      { summaryOnly: true },
    );
    const rollupRows: ConsolidatedRollupInput[] = consolidatedDtos.map((c) => ({
      subsidiaryId: c.subsidiary?.id,
      type: c.type,
      numberOfPackages: c.numberOfPackages,
      entregado: c.shipmentCounts?.entregado ?? 0,
      dex03: c.shipmentCounts?.dex03 ?? 0,
      dex07: c.shipmentCounts?.dex07 ?? 0,
      dex08: c.shipmentCounts?.dex08 ?? 0,
      en_ruta: c.shipmentCounts?.en_ruta ?? 0,
      otros: c.shipmentCounts?.otros ?? 0,
      countF2: c.shipmentCounts?.countF2 ?? 0,
    }));
    const packageStatsBySub = rollupConsolidatedPackageStats(rollupRows);

    // 3. FINANCIEROS (SIN CAMBIO): gastos (C) e ingresos (D) en paralelo.
    const [expenseStats, incomeStats] = await Promise.all([
      // -- C. GASTOS (entidades que traslapan el rango; se prorratean en JS por periodo) --
      this.expenseRepository.createQueryBuilder('expense')
        .where(new Brackets(qb => {
          qb.where('expense.periodStart IS NOT NULL AND expense.periodEnd IS NOT NULL AND expense.periodStart <= :endDay AND expense.periodEnd >= :startDay', { startDay: baseStartDate, endDay: baseEndDate })
            .orWhere('(expense.periodStart IS NULL OR expense.periodEnd IS NULL) AND expense.date BETWEEN :startDay AND :endDay', { startDay: baseStartDate, endDay: baseEndDate });
        }))
        .andWhere(subsidiaryCondition('expense'), { subsidiaryIds })
        .getMany(),

      // -- D. INGRESOS TOTALES --
      this.incomeRepository.createQueryBuilder('income')
        .leftJoin('income.subsidiary', 'sub')
        .leftJoin(ChargeRule, 'crs', CHARGE_RULE_SUB_JOIN)
        .leftJoin(ChargeRule, 'crg', CHARGE_RULE_GLOBAL_JOIN)
        .select('income.subsidiaryId', 'subsidiaryId')
        .addSelect(COUNTABLE_REVENUE_SQL, 'totalRevenue')
        .where('income.date BETWEEN :startDate AND :endDate', { startDate: startDateObj, endDate: endDateObj })
        .andWhere(subsidiaryCondition('income'), { subsidiaryIds })
        .groupBy('income.subsidiaryId')
        .getRawMany(),
    ]);

    // 4. MAPEAR LOS RESULTADOS A LA ESTRUCTURA FINAL
    const result = subsidiaries.map((subsidiary) => {
      const iStats = incomeStats.find(i => i.subsidiaryId === subsidiary.id) || {};
      const pkg: SubsidiaryPackageStats = packageStatsBySub.get(subsidiary.id) || emptyPackageStats();

      const totalPackages = pkg.totalPackages;
      const deliveredPackages = pkg.deliveredPackages;
      const inTransitPackages = pkg.inTransitPackages;
      const totalUndelivered = pkg.undeliveredPackages;
      const totalCharges = pkg.totalCharges;
      const totalRevenue = Number(iStats.totalRevenue || 0);

      const subExpenses = expenseStats.filter(e => e.subsidiaryId === subsidiary.id);
      const totalExpenses = subExpenses.reduce(
        (sum, e) => sum + proratedAmountInRange(
          { amount: e.amount, date: e.date, periodStart: e.periodStart, periodEnd: e.periodEnd },
          baseStartDate,
          baseEndDate,
        ),
        0,
      );

      const averageRevenuePerPackage = totalPackages > 0 ? totalRevenue / totalPackages : 0;
      const averageEfficiency = totalPackages > 0 ? (deliveredPackages * 100) / totalPackages : 0;
      const totalProfit = totalRevenue - totalExpenses;

      return {
        subsidiaryId: subsidiary.id,
        subsidiaryName: subsidiary.name,
        state: subsidiary.state || '',
        latitude: subsidiary.latitude != null ? Number(subsidiary.latitude) : null,
        longitude: subsidiary.longitude != null ? Number(subsidiary.longitude) : null,
        totalPackages,
        deliveredPackages,
        undeliveredPackages: totalUndelivered,
        undeliveredDetails: {
          total: totalUndelivered,
          byExceptionCode: {
            code07: pkg.byExceptionCode.code07,
            code08: pkg.byExceptionCode.code08,
            code03: pkg.byExceptionCode.code03,
            unknown: pkg.byExceptionCode.unknown,
          },
        },
        inTransitPackages,
        totalCharges,
        consolidations: {
          ordinary: pkg.consolidations.ordinary,
          air: pkg.consolidations.air,
          total: pkg.consolidations.total,
        },
        averageRevenuePerPackage,
        totalRevenue,
        totalExpenses,
        averageEfficiency,
        totalProfit,
      };
    });

    const sortedSubsidiaries = result.sort((a, b) => (b.averageEfficiency || 0) - (a.averageEfficiency || 0));

    // 5. CALCULAR TOTALES GENERALES DE TODA LA EMPRESA
    const generalTotalIncome = sortedSubsidiaries.reduce((sum, sub) => sum + sub.totalRevenue, 0);
    const generalTotalExpenses = sortedSubsidiaries.reduce((sum, sub) => sum + sub.totalExpenses, 0);
    const generalTotalProfit = generalTotalIncome - generalTotalExpenses;

    // 6. REGRESAMOS EL ARREGLO COMO ANTES, PERO INYECTAMOS EL SUMARIO EN CADA ELEMENTO
    return sortedSubsidiaries.map(sub => ({
      ...sub,
      generalSummary: {
        totalIncome: generalTotalIncome,
        totalExpenses: generalTotalExpenses,
        totalProfit: generalTotalProfit
      }
    }));
  }

}