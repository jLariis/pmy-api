import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, Brackets } from 'typeorm';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ChargeShipment, Expense, Income, Shipment, Subsidiary } from 'src/entities';
import { ChargeRule } from 'src/entities/charge-rule.entity';
import { proratedAmountInRange } from 'src/common/expense-proration.util';
import { effectiveLocalDaySql, rawUtcBounds } from 'src/common/income-window.util';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { buildMissingScanReport, MissingScanDetail, missingScanWhere } from 'src/inventories/missing-scan-report';
import { localScanLabel } from 'src/utils/local-scan-visibility.util';
import { DHL_INCIDENT_BY_STATUS } from 'src/utils/dhl.utils';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import {
  emptyPackageStats,
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
 * Condición "contable" según las reglas de la sucursal (regla ÚNICA, espejo SQL de
 * `isCountableIncome`): traslados solo si countTransfersAsIncome; recolecciones
 * siempre; envíos/cargas según `charge_rule` (override de sucursal → global →
 * fallback 1); manual u otros fuera. Requiere `leftJoin('income.subsidiary','sub')`
 * + los JOINs `crs`/`crg` a charge_rule (ver CHARGE_RULE_*_JOIN).
 */
const COUNTABLE_COND = `(
  CASE
    WHEN income.sourceType IN ('tyco','aeropuerto','special_transfer') THEN sub.countTransfersAsIncome
    WHEN income.sourceType = 'collection' THEN 1
    WHEN income.sourceType IN ('shipment','charge') THEN COALESCE(crs.chargeable, crg.chargeable, 1)
    ELSE 0
  END
) = 1`;

/** Suma del `cost` contable acotada a un predicado de tipo (para el desglose por tipo). */
const countableRevenue = (extra?: string) =>
  `SUM(CASE WHEN ${COUNTABLE_COND}${extra ? ` AND (${extra})` : ''} THEN income.cost ELSE 0 END)`;

/** Ingreso contable TOTAL (todos los tipos). */
const COUNTABLE_REVENUE_SQL = countableRevenue();

/**
 * Desglose de ingreso contable por tipo — MISMOS buckets que la tabla de ingresos
 * (`formatIncomesNew`): fedex/dhl = solo envíos; cargas = charge; recolecciones;
 * traslados = tyco/aeropuerto/especial. La suma de los cinco == totalRevenue.
 */
const REVENUE_FEDEX_SQL = countableRevenue(`income.sourceType = 'shipment' AND income.shipmentType = 'fedex'`);
const REVENUE_DHL_SQL = countableRevenue(`income.sourceType = 'shipment' AND income.shipmentType = 'dhl'`);
const REVENUE_CARGAS_SQL = countableRevenue(`income.sourceType = 'charge'`);
const REVENUE_COLLECTIONS_SQL = countableRevenue(`income.sourceType = 'collection'`);
// Traslados DESGLOSADOS (nada de "otros" genérico): tyco / aéreo / especial por separado.
const REVENUE_TYCO_SQL = countableRevenue(`income.sourceType = 'tyco'`);
const REVENUE_AEROPUERTO_SQL = countableRevenue(`income.sourceType = 'aeropuerto'`);
const REVENUE_SPECIAL_SQL = countableRevenue(`income.sourceType = 'special_transfer'`);

/**
 * Paquetes FACTURADOS: # de ingresos contables (los que suman al total), con su desglose
 * por desenlace. Sirve para explicar el dinero en la tarjeta: total$ = Σ costos de estos
 * N paquetes (anclados a la fecha de COBRO, no al mes del consolidado — por eso puede
 * diferir de "entregados" del conteo operativo por consolidado).
 */
const billedCount = (extra?: string) =>
  `SUM(CASE WHEN ${COUNTABLE_COND}${extra ? ` AND (${extra})` : ''} THEN 1 ELSE 0 END)`;
const BILLED_TOTAL_SQL = billedCount();
const BILLED_DELIVERED_SQL = billedCount(`income.incomeType = 'entregado'`);
const BILLED_DEX07_SQL = billedCount(`income.incomeType = 'no_entregado' AND income.nonDeliveryStatus = '07'`);
const BILLED_DEX08_SQL = billedCount(`income.incomeType = 'no_entregado' AND income.nonDeliveryStatus = '08'`);

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

    // FedEx y DHL NUNCA se mezclan: cada sección se consulta por paquetería (conteo y lista
    // propios, hasta LIST_LIMIT por paquetería) y el front las muestra por separado.
    const CARRIERS = [ShipmentType.FEDEX, ShipmentType.DHL] as const;
    type CarrierKey = (typeof CARRIERS)[number];
    /** findAndCount en envíos + cargas de UNA paquetería; devuelve filas (≤ limit) y total. */
    const byCarrierQuery = async (carrier: CarrierKey, where: any, order: any) => {
      const w = { ...where, shipmentType: carrier };
      const [[ships, shipTotal], [charges, chargeTotal]] = await Promise.all([
        this.shipmentRepository.findAndCount({ where: w, relations: ['subsidiary'], order, take: LIST_LIMIT }),
        this.chargeShipmentRepository.findAndCount({ where: w, relations: ['subsidiary'], order, take: LIST_LIMIT }),
      ]);
      return { rows: [...ships, ...charges].slice(0, LIST_LIMIT) as any[], total: shipTotal + chargeTotal };
    };

    // --- 1. Vencen hoy: commitDateTime dentro de HOY + activos ---
    const expWhere: any = { ...subFilter, status: In(KpiService.WELCOME_ACTIVE_STATUSES), commitDateTime: Between(todayStart, todayEnd) };
    const [expFedex, expDhl] = await Promise.all(CARRIERS.map((c) => byCarrierQuery(c, expWhere, { commitDateTime: 'ASC' })));
    const expiringPackages = [...expFedex.rows, ...expDhl.rows].map((s: any) => {
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
    const [penFedex, penDhl] = await Promise.all(CARRIERS.map((c) => byCarrierQuery(c, penWhere, { commitDateTime: 'DESC' })));
    const pendingPackages = [...penFedex.rows, ...penDhl.rows].map((s: any) => ({
      id: s.id,
      trackingNumber: s.trackingNumber,
      recipientName: s.recipientName || '—',
      status: KpiService.STATUS_LABELS[String(s.status)] || String(s.status),
      subsidiaryName: s.subsidiary?.name || '—',
      createdAt: (s.commitDateTime ? new Date(s.commitDateTime) : s.createdAt || now).toISOString(),
      ...contactFields(s),
    }));

    // --- 2.b DHL: incidencias con SUS códigos (NH/BA/RD/CM). DHL no tiene escaneo local 44/67;
    // lo que hay que atender son los intentos fallidos. Alta en los últimos 60 días. ---
    const dhlIncidentWhere: any = {
      ...subFilter,
      status: In(Object.keys(DHL_INCIDENT_BY_STATUS)),
      createdAt: Between(overdueFrom, todayEnd),
    };
    const dhlInc = await byCarrierQuery(ShipmentType.DHL, dhlIncidentWhere, { createdAt: 'DESC' });
    // Conteo por código: agregado aparte (la lista va acotada, el conteo no).
    const incidentCountRows: { status: string; n: string }[] = (
      await Promise.all([this.shipmentRepository, this.chargeShipmentRepository].map((repo: Repository<any>) => {
        const qb = repo.createQueryBuilder('p')
          .select('p.status', 'status').addSelect('COUNT(*)', 'n')
          .where('p.shipmentType = :dhl', { dhl: ShipmentType.DHL })
          .andWhere('p.status IN (:...st)', { st: Object.keys(DHL_INCIDENT_BY_STATUS) })
          .andWhere('p.createdAt BETWEEN :from AND :to', { from: overdueFrom, to: todayEnd })
          .groupBy('p.status');
        if (ids.length) qb.andWhere('p.subsidiaryId IN (:...ids)', { ids });
        return qb.getRawMany();
      }))
    ).flat();
    const dhlIncidentsByCode: Record<string, { label: string; count: number }> = {};
    for (const { status, n } of incidentCountRows) {
      const inc = DHL_INCIDENT_BY_STATUS[status];
      if (!inc) continue;
      dhlIncidentsByCode[inc.code] = { label: inc.label, count: (dhlIncidentsByCode[inc.code]?.count ?? 0) + Number(n) };
    }
    const dhlIncidentPackages = dhlInc.rows.map((s: any) => {
      const inc = DHL_INCIDENT_BY_STATUS[String(s.status)];
      return {
        id: s.id,
        trackingNumber: s.trackingNumber,
        recipientName: s.recipientName || '—',
        subsidiaryName: s.subsidiary?.name || '—',
        dhlCode: inc?.code ?? '',
        incident: inc ? `${inc.code} · ${inc.label}` : KpiService.STATUS_LABELS[String(s.status)] || String(s.status),
        status: KpiService.STATUS_LABELS[String(s.status)] || String(s.status),
        createdAt: new Date(s.createdAt).toISOString(),
        ...contactFields(s),
      };
    });

    // --- 3. Sin escaneo local: MISMO motor que el reporte "Sin código 44 por sucursal/zona"
    // (missing-scan-report.ts) para que el welcome y el reporte empaten guía por guía: mismos
    // estatus (pendiente/en bodega), solo FedEx, misma ventana, deduplicado por guía y sin tope.
    // El código lo dice FedEx (44 o 67, cualquiera cuenta) y "sin escaneo" = NO está al día:
    // nunca escaneada o con días completos sin escaneo (hora Hermosillo). ---
    const scanSubs = await this.subsidiaryRepository.find({
      where: ids.length ? { id: In(ids) } : {},
      select: ['id', 'name', 'monitorFedexCode44'],
    });
    const scanSubIds = scanSubs.map((s) => s.id);
    let withoutScan: MissingScanDetail[] = [];
    if (scanSubIds.length) {
      const scanWhere = missingScanWhere(scanSubIds);
      const [sScan, cScan] = await Promise.all([
        this.shipmentRepository.find({ where: scanWhere, relations: ['statusHistory', 'subsidiary'] }),
        this.chargeShipmentRepository.find({ where: scanWhere, relations: ['statusHistory', 'subsidiary'] }),
      ]);
      const { details } = buildMissingScanReport(
        [...sScan.map((s) => ({ s, isCharge: false })), ...cScan.map((s) => ({ s, isCharge: true }))],
        scanSubs,
        now,
      );
      // Lo más grave primero: nunca escaneadas, luego más días sin escaneo.
      const severity = (d: MissingScanDetail) => (d.daysSinceLastCode == null ? Number.MAX_SAFE_INTEGER : d.daysSinceLastCode);
      withoutScan = details.filter((d) => d.category !== 'hoy').sort((a, b) => severity(b) - severity(a));
    }
    const withoutDEXPackages = withoutScan.slice(0, LIST_LIMIT).map((d) => ({
      id: d.id,
      trackingNumber: d.trackingNumber,
      recipientName: d.recipientName || '—',
      subsidiaryName: d.subsidiaryName || '—',
      missingDocument: `Código ${d.scanCode} · ${localScanLabel(d.daysSinceLastCode)}`,
      scanCode: d.scanCode,
      daysSinceLastCode: d.daysSinceLastCode,
      lastCodeDate: d.lastCodeDate,
      status: KpiService.STATUS_LABELS[String(d.status)] || String(d.status),
      ...contactFields(d),
    }));

    const dhlIncidents = Object.values(dhlIncidentsByCode).reduce((a, b) => a + b.count, 0);
    return {
      // Totales (compatibilidad). El front muestra SIEMPRE por paquetería (`byCarrier`).
      stats: {
        pendingYesterday: penFedex.total + penDhl.total,
        withoutDEX: withoutScan.length,
        expiringToday: expFedex.total + expDhl.total,
      },
      byCarrier: {
        fedex: { expiringToday: expFedex.total, pendingYesterday: penFedex.total, withoutScan: withoutScan.length },
        dhl: { expiringToday: expDhl.total, pendingYesterday: penDhl.total, incidents: dhlIncidents, incidentsByCode: dhlIncidentsByCode },
      },
      pendingPackages,
      withoutDEXPackages,
      expiringPackages,
      dhlIncidentPackages,
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

    // Cotas UTC generosas para el prefiltro por índice de la query de ingresos (el corte
    // fino por día local lo hace `effectiveLocalDaySql`).
    const { rawStart, rawEnd } = rawUtcBounds(baseStartDate, baseEndDate);

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

    // 2. CONTEOS DE PAQUETES: por sucursal OPERATIVA (considera traspasos entre sucursales).
    //    El total sale del `numberOfPackages` declarado por dueño y se AJUSTA por traspaso;
    //    POD/DEX/en proceso/cargas se cuentan donde físicamente está la guía; los
    //    consolidados (ordinario/aéreo) quedan con el dueño. NO se filtra por dueño (los
    //    traspasos cruzan sucursales); abajo el `result.map` acota a las sucursales visibles.
    //    Fechas como el controller de consolidados (new Date('YYYY-MM-DD') -> medianoche UTC).
    const consFrom = new Date(baseStartDate);
    const consTo = new Date(baseEndDate);
    const packageStatsBySub = await this.consolidatedService.getOperationalPackageStats(consFrom, consTo);

    // 3. FINANCIEROS (SIN CAMBIO): gastos (C) e ingresos (D) en paralelo.
    const [expenseStats, incomeStats] = await Promise.all([
      // -- C. GASTOS (entidades que traslapan el rango; se prorratean en JS por periodo) --
      // Join a categoría para el desglose de gastos por categoría (mismo prorrateo que el total).
      this.expenseRepository.createQueryBuilder('expense')
        .leftJoinAndSelect('expense.category', 'category')
        .where(new Brackets(qb => {
          qb.where('expense.periodStart IS NOT NULL AND expense.periodEnd IS NOT NULL AND expense.periodStart <= :endDay AND expense.periodEnd >= :startDay', { startDay: baseStartDate, endDay: baseEndDate })
            .orWhere('(expense.periodStart IS NULL OR expense.periodEnd IS NULL) AND expense.date BETWEEN :startDay AND :endDay', { startDay: baseStartDate, endDay: baseEndDate });
        }))
        .andWhere(subsidiaryCondition('expense'), { subsidiaryIds })
        .getMany(),

      // -- D. INGRESOS (total + desglose por tipo) --
      // Ventana por DÍA LOCAL canónico (mismo criterio que la tabla de ingresos y el
      // dashboard financiero): cargas a 00:00Z y traslados a 07:00Z caen en su día correcto.
      // El prefiltro crudo por `income.date` conserva el uso de índice; el corte fino lo hace
      // la expresión de día local. Se excluyen los ingresos anulados (`active = 1`).
      this.incomeRepository.createQueryBuilder('income')
        .leftJoin('income.subsidiary', 'sub')
        .leftJoin(ChargeRule, 'crs', CHARGE_RULE_SUB_JOIN)
        .leftJoin(ChargeRule, 'crg', CHARGE_RULE_GLOBAL_JOIN)
        .select('income.subsidiaryId', 'subsidiaryId')
        .addSelect(COUNTABLE_REVENUE_SQL, 'totalRevenue')
        .addSelect(REVENUE_FEDEX_SQL, 'revenueFedex')
        .addSelect(REVENUE_DHL_SQL, 'revenueDhl')
        .addSelect(REVENUE_CARGAS_SQL, 'revenueCargas')
        .addSelect(REVENUE_COLLECTIONS_SQL, 'revenueCollections')
        .addSelect(REVENUE_TYCO_SQL, 'revenueTyco')
        .addSelect(REVENUE_AEROPUERTO_SQL, 'revenueAeropuerto')
        .addSelect(REVENUE_SPECIAL_SQL, 'revenueSpecial')
        .addSelect(BILLED_TOTAL_SQL, 'billedTotal')
        .addSelect(BILLED_DELIVERED_SQL, 'billedDelivered')
        .addSelect(BILLED_DEX07_SQL, 'billedDex07')
        .addSelect(BILLED_DEX08_SQL, 'billedDex08')
        .where('income.active = 1')
        .andWhere('income.date BETWEEN :rawStart AND :rawEnd', { rawStart, rawEnd })
        .andWhere(`${effectiveLocalDaySql('income')} BETWEEN :startDay AND :endDay`, { startDay: baseStartDate, endDay: baseEndDate })
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
      const inProcessPackages = pkg.inProcessPackages;
      const otherPackages = pkg.otherPackages;
      const totalUndelivered = pkg.undeliveredPackages;
      const totalCharges = pkg.totalCharges;
      const totalRevenue = Number(iStats.totalRevenue || 0);
      // Desglose por tipo EXPLÍCITO (la suma == totalRevenue). Traslados separados.
      const revenueBreakdown = {
        fedex: Number(iStats.revenueFedex || 0),
        dhl: Number(iStats.revenueDhl || 0),
        cargas: Number(iStats.revenueCargas || 0),
        collections: Number(iStats.revenueCollections || 0),
        tyco: Number(iStats.revenueTyco || 0),
        aeropuerto: Number(iStats.revenueAeropuerto || 0),
        especial: Number(iStats.revenueSpecial || 0),
      };
      // Paquetes FACTURADOS (explican el dinero): total = # ingresos contables; el resto
      // del desglose por desenlace. `otros` = facturados que no son entregado/DEX07/DEX08.
      const billedTotal = Number(iStats.billedTotal || 0);
      const billedDelivered = Number(iStats.billedDelivered || 0);
      const billedDex07 = Number(iStats.billedDex07 || 0);
      const billedDex08 = Number(iStats.billedDex08 || 0);
      const billed = {
        total: billedTotal,
        delivered: billedDelivered,
        dex07: billedDex07,
        dex08: billedDex08,
        other: Math.max(0, billedTotal - billedDelivered - billedDex07 - billedDex08),
      };

      const subExpenses = expenseStats.filter(e => e.subsidiaryId === subsidiary.id);
      // Desglose de gastos por categoría (mismo prorrateo que el total → cuadra con totalExpenses).
      const expenseBreakdown: Record<string, number> = {};
      let totalExpenses = 0;
      for (const e of subExpenses) {
        const prorated = proratedAmountInRange(
          { amount: e.amount, date: e.date, periodStart: e.periodStart, periodEnd: e.periodEnd },
          baseStartDate,
          baseEndDate,
        );
        if (!prorated) continue;
        totalExpenses += prorated;
        const cat = (e as any).category?.name || 'Sin categoría';
        expenseBreakdown[cat] = (expenseBreakdown[cat] || 0) + prorated;
      }

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
        inProcessPackages,
        otherPackages,
        totalCharges,
        consolidations: {
          ordinary: pkg.consolidations.ordinary,
          air: pkg.consolidations.air,
          total: pkg.consolidations.total,
        },
        averageRevenuePerPackage,
        totalRevenue,
        revenueBreakdown,
        billed,
        totalExpenses,
        expenseBreakdown,
        averageEfficiency,
        totalProfit,
      };
    });

    const sortedSubsidiaries = result.sort((a, b) => (b.averageEfficiency || 0) - (a.averageEfficiency || 0));

    // 5. CALCULAR TOTALES GENERALES DE TODA LA EMPRESA
    const generalTotalIncome = sortedSubsidiaries.reduce((sum, sub) => sum + sub.totalRevenue, 0);
    const generalTotalExpenses = sortedSubsidiaries.reduce((sum, sub) => sum + sub.totalExpenses, 0);
    const generalTotalProfit = generalTotalIncome - generalTotalExpenses;
    const sumBucket = (k: keyof (typeof sortedSubsidiaries)[number]['revenueBreakdown']) =>
      sortedSubsidiaries.reduce((sum, sub) => sum + (sub.revenueBreakdown?.[k] || 0), 0);
    const generalRevenueBreakdown = {
      fedex: sumBucket('fedex'),
      dhl: sumBucket('dhl'),
      cargas: sumBucket('cargas'),
      collections: sumBucket('collections'),
      tyco: sumBucket('tyco'),
      aeropuerto: sumBucket('aeropuerto'),
      especial: sumBucket('especial'),
    };
    // Desglose general de gastos por categoría (suma de todas las sucursales).
    const generalExpenseBreakdown: Record<string, number> = {};
    for (const sub of sortedSubsidiaries) {
      for (const [cat, amount] of Object.entries(sub.expenseBreakdown || {})) {
        generalExpenseBreakdown[cat] = (generalExpenseBreakdown[cat] || 0) + amount;
      }
    }
    const generalBilled = sortedSubsidiaries.reduce(
      (acc, sub) => ({
        total: acc.total + (sub.billed?.total || 0),
        delivered: acc.delivered + (sub.billed?.delivered || 0),
        dex07: acc.dex07 + (sub.billed?.dex07 || 0),
        dex08: acc.dex08 + (sub.billed?.dex08 || 0),
        other: acc.other + (sub.billed?.other || 0),
      }),
      { total: 0, delivered: 0, dex07: 0, dex08: 0, other: 0 },
    );

    // 6. REGRESAMOS EL ARREGLO COMO ANTES, PERO INYECTAMOS EL SUMARIO EN CADA ELEMENTO
    return sortedSubsidiaries.map(sub => ({
      ...sub,
      generalSummary: {
        totalIncome: generalTotalIncome,
        totalExpenses: generalTotalExpenses,
        totalProfit: generalTotalProfit,
        revenueBreakdown: generalRevenueBreakdown,
        expenseBreakdown: generalExpenseBreakdown,
        billed: generalBilled,
      }
    }));
  }

}