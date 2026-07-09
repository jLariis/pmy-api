import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, Brackets } from 'typeorm';
import { ConsolidatedType } from 'src/common/enums/consolidated-type.enum';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { Charge, ChargeShipment, Consolidated, Expense, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { startOfDay, endOfDay, differenceInDays } from 'date-fns';
import { proratedAmountInRange } from 'src/common/expense-proration.util';

/**
 * Ingreso "contable" según las reglas de la sucursal (regla ÚNICA, espejo SQL de
 * `isCountableIncome`): traslados solo si countTransfersAsIncome; envíos/cargas
 * por estatus (entregado / DEX 03·07·08 según su flag); recolecciones siempre;
 * manual u otros fuera. Requiere `leftJoin('income.subsidiary','sub')`.
 */
const COUNTABLE_REVENUE_SQL = `SUM(CASE WHEN (
  CASE
    WHEN income.sourceType IN ('tyco','aeropuerto','special_transfer') THEN sub.countTransfersAsIncome
    WHEN income.sourceType = 'collection' THEN 1
    WHEN income.sourceType IN ('shipment','charge') THEN
      CASE
        WHEN income.incomeType = 'entregado' THEN sub.chargeDelivered
        WHEN income.incomeType = 'no_entregado' AND income.nonDeliveryStatus = '03' THEN sub.chargeDex03
        WHEN income.incomeType = 'no_entregado' AND income.nonDeliveryStatus = '07' THEN sub.chargeDex07
        WHEN income.incomeType = 'no_entregado' AND income.nonDeliveryStatus = '08' THEN sub.chargeDex08
        ELSE 1
      END
    ELSE 0
  END
) = 1 THEN income.cost ELSE 0 END)`;

@Injectable()
export class KpiService {
  private readonly logger = new Logger(KpiService.name);

  constructor(
    @InjectRepository(Charge)
    private chargeRepository: Repository<Charge>,
    @InjectRepository(Consolidated)
    private consolidatedRepository: Repository<Consolidated>,
    @InjectRepository(Income)
    private incomeRepository: Repository<Income>,
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>,
    @InjectRepository(Subsidiary)
    private subsidiaryRepository: Repository<Subsidiary>,
    @InjectRepository(ChargeShipment)
    private chargeShipmentRepository: Repository<ChargeShipment>,
    @InjectRepository(ShipmentStatus)
    private shipmentStatusRepository: Repository<ShipmentStatus>,
    @InjectRepository(Expense)
    private expenseRepository: Repository<Expense>,
  ) {}

  // ===================== Welcome Dashboard (resumen de inicio) =====================

  /** Estatus "activos" (no entregados/devueltos) para vencimientos y pendientes. */
  private readonly WELCOME_ACTIVE_STATUSES = [
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
  async getWelcomeDashboard(subsidiaryId?: string) {
    const { todayStart, todayEnd } = this.hermosilloToday();
    const now = new Date();
    const LIST_LIMIT = 100;
    const subFilter: any = subsidiaryId ? { subsidiary: { id: subsidiaryId } } : {};

    // --- 1. Vencen hoy: commitDateTime dentro de HOY + activos ---
    const expWhere: any = { ...subFilter, status: In(this.WELCOME_ACTIVE_STATUSES), commitDateTime: Between(todayStart, todayEnd) };
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
      };
    });

    // --- 2. Pendientes de días anteriores: commit < hoy + activos (últimos 60 días) ---
    const overdueFrom = new Date(todayStart.getTime() - 60 * 24 * 3600 * 1000);
    const penWhere: any = { ...subFilter, status: In(this.WELCOME_ACTIVE_STATUSES), commitDateTime: Between(overdueFrom, new Date(todayStart.getTime() - 1)) };
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
    }));

    // --- 3. Sin DEX/67: PENDIENTE o EN_BODEGA cuyo historial NO tiene exceptionCode '67' ---
    const code67Statuses = [ShipmentStatusType.PENDIENTE, ShipmentStatusType.EN_BODEGA];
    const [s67, c67] = await Promise.all([
      this.shipmentRepository.find({ where: { ...subFilter, status: In(code67Statuses) }, relations: ['statusHistory', 'subsidiary'], take: 500 }),
      this.chargeShipmentRepository.find({ where: { ...subFilter, status: In(code67Statuses) }, relations: ['statusHistory', 'subsidiary'], take: 500 }),
    ]);
    const without67 = [...s67, ...c67].filter((s: any) => !(s.statusHistory || []).some((h: any) => h.exceptionCode === '67'));
    const withoutDEXPackages = without67.slice(0, LIST_LIMIT).map((s: any) => ({
      id: s.id,
      trackingNumber: s.trackingNumber,
      recipientName: s.recipientName || '—',
      subsidiaryName: s.subsidiary?.name || '—',
      carrier: String(s.shipmentType || '').toUpperCase() === 'DHL' ? 'DHL' : 'FedEx',
      missingDocument: 'Código 67',
    }));

    return {
      stats: {
        pendingYesterday: penShipTotal + penChargeTotal,
        withoutDEX: without67.length,
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

    const msPerDay = 1000 * 60 * 60 * 24;
    const daysInDateRange = Math.floor((endDateObj.getTime() - startDateObj.getTime()) / msPerDay) + 1;

    this.logger.log(`Fetching Optimized KPIs: ${baseStartDate} to ${baseEndDate} (${daysInDateRange} days) in Hermosillo TZ`);

    // 1. Obtener las sucursales base
    const subsidiariesQuery = this.subsidiaryRepository.createQueryBuilder('subsidiary');
    if (subsidiaryIds?.length) {
      subsidiariesQuery.where('subsidiary.id IN (:...subsidiaryIds)', { subsidiaryIds });
    }
    const subsidiaries = await subsidiariesQuery.getMany();

    const hasSubsidiaryFilter = subsidiaryIds?.length > 0;
    const subsidiaryCondition = hasSubsidiaryFilter ? 'subsidiaryId IN (:...subsidiaryIds)' : '1=1';

    // 2. Definimos los estatus FINALES (los que ya no son Backlog)
    // Todo lo que NO esté en esta lista, se considera un paquete "Vivo" (Bodega, Pendiente, En Ruta, etc.)
    const finalStatuses = [
      ShipmentStatusType.ENTREGADO,
      ShipmentStatusType.RECHAZADO,
      ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
      ShipmentStatusType.DIRECCION_INCORRECTA,
      ShipmentStatusType.NO_ENTREGADO // Asumiendo que este es un estado de cierre
    ];

    // 3. EJECUTAR AGREGACIONES EN PARALELO EN LA BASE DE DATOS
    const [
      shipmentStats,
      chargeStats,
      expenseStats,
      incomeStats,
      consolidatedStats
    ] = await Promise.all([

      // -- A. ESTADÍSTICAS DE ENVÍOS (CON BACKLOG OPERATIVO) --
      this.shipmentRepository.createQueryBuilder('shipment')
        .select('shipment.subsidiaryId', 'subsidiaryId')
        .addSelect('COUNT(shipment.id)', 'total')
        .addSelect(`SUM(CASE WHEN shipment.status = '${ShipmentStatusType.ENTREGADO}' THEN 1 ELSE 0 END)`, 'delivered')
        .addSelect(`SUM(CASE WHEN shipment.status = '${ShipmentStatusType.EN_RUTA}' THEN 1 ELSE 0 END)`, 'inTransit')
        .addSelect(`SUM(CASE WHEN shipment.status = '${ShipmentStatusType.NO_ENTREGADO}' THEN 1 ELSE 0 END)`, 'noEntregadoBase')
        .addSelect(`SUM(CASE WHEN shipment.status = '${ShipmentStatusType.RECHAZADO}' THEN 1 ELSE 0 END)`, 'code07')
        .addSelect(`SUM(CASE WHEN shipment.status = '${ShipmentStatusType.CLIENTE_NO_DISPONIBLE}' THEN 1 ELSE 0 END)`, 'code08')
        .addSelect(`SUM(CASE WHEN shipment.status = '${ShipmentStatusType.DIRECCION_INCORRECTA}' THEN 1 ELSE 0 END)`, 'code03')
        .where(new Brackets(qb => {
          // Condición 1: Los que nacieron en este mes
          qb.where('shipment.createdAt BETWEEN :startDate AND :endDate', { startDate: startDateObj, endDate: endDateObj })
          // Condición 2: El Backlog (Nacieron antes de este mes, pero siguen vivos hoy)
            .orWhere('shipment.createdAt < :startDate AND shipment.status NOT IN (:...finalStatuses)', { startDate: startDateObj, finalStatuses });
        }))
        .andWhere(subsidiaryCondition, { subsidiaryIds })
        .groupBy('shipment.subsidiaryId')
        .getRawMany(),

      // -- B. ESTADÍSTICAS DE CARGOS --
      this.chargeRepository.createQueryBuilder('charge')
        .select('charge.subsidiaryId', 'subsidiaryId')
        .addSelect('COUNT(charge.id)', 'totalCharges')
        .addSelect('SUM(charge.numberOfPackages)', 'totalPackagesFromCharges')
        .where('charge.chargeDate BETWEEN :startDate AND :endDate', { startDate: startDateObj, endDate: endDateObj })
        .andWhere(subsidiaryCondition, { subsidiaryIds })
        .groupBy('charge.subsidiaryId')
        .getRawMany(),

      // -- C. GASTOS (entidades que traslapan el rango; se prorratean en JS por periodo) --
      this.expenseRepository.createQueryBuilder('expense')
        .where(new Brackets(qb => {
          qb.where('expense.periodStart IS NOT NULL AND expense.periodEnd IS NOT NULL AND expense.periodStart <= :endDay AND expense.periodEnd >= :startDay', { startDay: baseStartDate, endDay: baseEndDate })
            .orWhere('(expense.periodStart IS NULL OR expense.periodEnd IS NULL) AND expense.date BETWEEN :startDay AND :endDay', { startDay: baseStartDate, endDay: baseEndDate });
        }))
        .andWhere(subsidiaryCondition, { subsidiaryIds })
        .getMany(),

      // -- D. INGRESOS TOTALES --
      this.incomeRepository.createQueryBuilder('income')
        .leftJoin('income.subsidiary', 'sub')
        .select('income.subsidiaryId', 'subsidiaryId')
        .addSelect(COUNTABLE_REVENUE_SQL, 'totalRevenue')
        .where('income.date BETWEEN :startDate AND :endDate', { startDate: startDateObj, endDate: endDateObj })
        .andWhere(subsidiaryCondition, { subsidiaryIds })
        .groupBy('income.subsidiaryId')
        .getRawMany(),

      // -- E. CONSOLIDADOS --
      this.consolidatedRepository.createQueryBuilder('cons')
        .select('cons.subsidiaryId', 'subsidiaryId')
        .addSelect(`SUM(CASE WHEN cons.type = '${ConsolidatedType.ORDINARIA}' THEN 1 ELSE 0 END)`, 'ordinary')
        .addSelect(`SUM(CASE WHEN cons.type = '${ConsolidatedType.AEREO}' THEN 1 ELSE 0 END)`, 'air')
        .where('cons.date BETWEEN :startDate AND :endDate', { startDate: startDateObj, endDate: endDateObj })
        .andWhere(subsidiaryCondition, { subsidiaryIds })
        .groupBy('cons.subsidiaryId')
        .getRawMany()
    ]);

    // 4. MAPEAR LOS RESULTADOS A LA ESTRUCTURA FINAL
    const result = subsidiaries.map((subsidiary) => {
      const sStats = shipmentStats.find(s => s.subsidiaryId === subsidiary.id) || {};
      const cStats = chargeStats.find(c => c.subsidiaryId === subsidiary.id) || {};
      const iStats = incomeStats.find(i => i.subsidiaryId === subsidiary.id) || {};
      const consStats = consolidatedStats.find(c => c.subsidiaryId === subsidiary.id) || {};
      
      const totalPackagesFromShipments = Number(sStats.total || 0);
      const totalPackagesFromCharges = Number(cStats.totalPackagesFromCharges || 0);
      const totalPackages = totalPackagesFromShipments + totalPackagesFromCharges;
      
      const deliveredPackages = Number(sStats.delivered || 0);
      const inTransitPackages = Number(sStats.inTransit || 0);
      const totalCharges = Number(cStats.totalCharges || 0);
      const totalRevenue = Number(iStats.totalRevenue || 0);

      const code07 = Number(sStats.code07 || 0);
      const code08 = Number(sStats.code08 || 0);
      const code03 = Number(sStats.code03 || 0);
      const noEntregadoBase = Number(sStats.noEntregadoBase || 0); 
      
      const totalUndelivered = code07 + code08 + code03 + noEntregadoBase;

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
            code07,
            code08,
            code03,
            unknown: noEntregadoBase,
          },
        },
        inTransitPackages,
        totalCharges,
        consolidations: {
          ordinary: Number(consStats.ordinary || 0),
          air: Number(consStats.air || 0),
          total: Number(consStats.ordinary || 0) + Number(consStats.air || 0),
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