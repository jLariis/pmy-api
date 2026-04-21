import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { ConsolidatedType } from 'src/common/enums/consolidated-type.enum';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { Charge, ChargeShipment, Consolidated, Expense, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { startOfDay, endOfDay, differenceInDays } from 'date-fns';
import { Frequency } from 'src/common/enums/frequency-enum';

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

  /**
   * Comprehensive KPI: Detailed metrics per subsidiary with organized undelivered packages
   */
  async getSubsidiaryKpisResp2104(startDate: string, endDate: string) {
    // Convertir fechas ISO 8601 a objetos Date
    const startDateObj = startOfDay(new Date(startDate));
    const endDateObj = endOfDay(new Date(endDate));

    // Validar fechas
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      throw new Error('Invalid date format. Please use ISO 8601 format (e.g., YYYY-MM-DD).');
    }

    this.logger.log(`Fetching KPIs for date range: ${startDate} to ${endDate}`);

    // Fetch all subsidiaries
    const subsidiaries = await this.subsidiaryRepository.find();
    this.logger.log(`Found ${subsidiaries.length} subsidiaries`);

    // Fetch all necessary data
    const shipments = await this.shipmentRepository.find({
      where: { createdAt: Between(startDateObj, endDateObj) },
      relations: ['subsidiary', 'statusHistory'],
    });
    this.logger.log(`Found ${shipments.length} shipments`);

    const charges = await this.chargeRepository.find({
      where: { chargeDate: Between(startDateObj, endDateObj) },
      relations: ['subsidiary'],
    });
    this.logger.log(`Found ${charges.length} charges`);

    const consolidations = await this.consolidatedRepository.find({
      where: { date: Between(startDateObj, endDateObj) },
      relations: ['subsidiary'],
    });
    this.logger.log(`Found ${consolidations.length} consolidations`);

    const incomes = await this.incomeRepository.find({
      where: { date: Between(startDateObj, endDateObj) },
      relations: ['subsidiary', 'shipment', 'charge'],
    });
    this.logger.log(`Found ${incomes.length} incomes`);

    const expenses = await this.expenseRepository.find({
      where: { date: Between(startDateObj, endDateObj) },
      relations: ['subsidiary'],
    });
    this.logger.log(`Found ${expenses.length} expenses`);

    const result = subsidiaries.map((subsidiary) => {
      // Total packages (from Shipments and Charges)
      const subsidiaryShipments = shipments.filter((s) => s.subsidiary?.id === subsidiary.id);
      const subsidiaryCharges = charges.filter((c) => c.subsidiary?.id === subsidiary.id);
      const totalPackagesFromShipments = subsidiaryShipments.length;
      const totalPackagesFromCharges = subsidiaryCharges.reduce(
        (sum, charge) => sum + (charge.numberOfPackages || 0),
        0,
      );
      const totalPackages = totalPackagesFromShipments + totalPackagesFromCharges;
      this.logger.debug(`Subsidiary ${subsidiary.name}: ${totalPackages} total packages`);

      // Delivered packages (Pods)
      const deliveredPackages = subsidiaryShipments.filter(
        (s) => s.status === ShipmentStatusType.ENTREGADO,
      ).length;

      // Undelivered packages (status: NO_ENTREGADO) with exception code breakdown
      const undeliveredShipments = subsidiaryShipments.filter(
        (s) => s.status === ShipmentStatusType.NO_ENTREGADO,
      );
      const undeliveredStatusBreakdown = undeliveredShipments.reduce(
        (acc, shipment) => {
          const latestStatusEntry = shipment.statusHistory?.slice(-1)[0];
          const exceptionCode = latestStatusEntry?.exceptionCode || 'Unknown';
          acc.totalUndelivered += 1;
          acc.byExceptionCode[exceptionCode] = (acc.byExceptionCode[exceptionCode] || 0) + 1;
          return acc;
        },
        {
          totalUndelivered: 0,
          byExceptionCode: {
            '07': 0,
            '08': 0,
            '03': 0,
            Unknown: 0,
          },
        },
      );

      // In-transit packages
      const inTransitPackages = subsidiaryShipments.filter(
        (s) => s.status === ShipmentStatusType.EN_RUTA,
      ).length;

      // Number of charges
      const totalCharges = subsidiaryCharges.length;
      this.logger.debug(`Subsidiary ${subsidiary.name}: ${totalCharges} charges`);

      // Consolidations by type
      const subsidiaryConsolidations = consolidations.filter((c) => c.subsidiary?.id === subsidiary.id);
      const ordinaryConsolidations = subsidiaryConsolidations.filter(
        (c) => c.type === ConsolidatedType.ORDINARIA,
      ).length;
      const airConsolidations = subsidiaryConsolidations.filter(
        (c) => c.type === ConsolidatedType.AEREO,
      ).length;
      this.logger.debug(
        `Subsidiary ${subsidiary.name}: ${ordinaryConsolidations} ordinary, ${airConsolidations} air consolidations`,
      );

      // Revenue per package and total revenue
      const subsidiaryIncomes = incomes.filter((i) => i.subsidiary?.id === subsidiary.id);
      const totalRevenue = subsidiaryIncomes.reduce(
        (sum, income) => sum + Number(income.cost || 0),
        0,
      );

      // Calculate average revenue per package using subsidiary-specific costs
      const totalIncomePackages = subsidiaryIncomes.reduce((sum, income) => {
        if (income.shipment) {
          if (income.shipment.shipmentType === ShipmentType.FEDEX) {
            return sum + (subsidiary.fedexCostPackage || 0);
          } else if (income.shipment.shipmentType === ShipmentType.DHL) {
            return sum + (subsidiary.dhlCostPackage || 0);
          }
          return sum + 1; // Fallback for other shipment types
        }
        if (income.charge) {
          const charge = charges.find((c) => c.id === income.charge?.id);
          return sum + (charge?.numberOfPackages || 0);
        }
        return sum;
      }, 0);
      const averageRevenuePerPackage = totalPackages > 0 ? totalRevenue / totalPackages : 0;
      this.logger.debug(
        `Subsidiary ${subsidiary.name}: totalRevenue=${totalRevenue}, totalPackages=${totalPackages}, avgRevenue=${averageRevenuePerPackage}`,
      );

      // Expenses (from Expense entity)
      const subsidiaryExpenses = expenses.filter((e) => e.subsidiary?.id === subsidiary.id);
      const totalExpenses = subsidiaryExpenses.reduce(
        (sum, expense) => sum + Number(expense.amount || 0),
        0,
      );
      this.logger.debug(
        `Subsidiary ${subsidiary.name}: ${subsidiaryExpenses.length} expenses, totalExpenses=${totalExpenses}`,
      );

      // Efficiency (from consolidations)
      const totalEfficiency = subsidiaryConsolidations.reduce(
        (sum, cons) => sum + (cons.efficiency || 0),
        0,
      );

      const averageEfficiency = subsidiaryConsolidations.length > 0 ? (deliveredPackages * 100) / totalPackages : 0;
      console.log("🚀 ~ KpiService ~ getSubsidiaryKpis ~ productivity:", averageEfficiency)

      // Total profit
      const totalProfit = totalRevenue - totalExpenses;

      return {
        subsidiaryId: subsidiary.id,
        subsidiaryName: subsidiary.name,
        totalPackages,
        deliveredPackages,
        undeliveredPackages: undeliveredStatusBreakdown.totalUndelivered,
        undeliveredDetails: {
          total: undeliveredStatusBreakdown.totalUndelivered,
          byExceptionCode: {
            code07: undeliveredStatusBreakdown.byExceptionCode['07'],
            code08: undeliveredStatusBreakdown.byExceptionCode['08'],
            code03: undeliveredStatusBreakdown.byExceptionCode['03'],
            unknown: undeliveredStatusBreakdown.byExceptionCode['Unknown'],
          },
        },
        inTransitPackages,
        totalCharges,
        consolidations: {
          ordinary: ordinaryConsolidations,
          air: airConsolidations,
          total: ordinaryConsolidations + airConsolidations,
        },
        averageRevenuePerPackage,
        totalRevenue,
        totalExpenses,
        averageEfficiency,
        totalProfit,
      };
    });

    return result.sort((a, b) => (b.averageEfficiency || 0) - (a.averageEfficiency || 0));;
  }


  async getSubsidiariesKpisResp2104(startDate: string, endDate: string, subsidiaryIds: string[]) {
    // Convertir fechas ISO 8601 a objetos Date
    const startDateObj = startOfDay(new Date(startDate));
    const endDateObj = endOfDay(new Date(endDate));

    // Validar fechas
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      throw new Error(
        'Invalid date format. Please use ISO 8601 format (e.g., YYYY-MM-DD).',
      );
    }

    this.logger.log(`Fetching KPIs for date range: ${startDate} to ${endDate}`);

    // Fetch subsidiaries (todas o filtradas por IDs si vienen)
    const subsidiaries = await this.subsidiaryRepository.find(
      subsidiaryIds && subsidiaryIds.length > 0
        ? { where: { id: In(subsidiaryIds) } }
        : {}
    );
    this.logger.log(`Found ${subsidiaries.length} subsidiaries`);

    // Fetch all necessary data filtrando solo por esas sucursales
    const shipments = await this.shipmentRepository.find({
      where: {
        createdAt: Between(startDateObj, endDateObj),
        ...(subsidiaryIds && subsidiaryIds.length > 0
          ? { subsidiary: { id: In(subsidiaryIds) } }
          : {}),
      },
      relations: ['subsidiary', 'statusHistory'],
    });
    this.logger.log(`Found ${shipments.length} shipments`);

    const charges = await this.chargeRepository.find({
      where: {
        chargeDate: Between(startDateObj, endDateObj),
        ...(subsidiaryIds && subsidiaryIds.length > 0
          ? { subsidiary: { id: In(subsidiaryIds) } }
          : {}),
      },
      relations: ['subsidiary'],
    });
    this.logger.log(`Found ${charges.length} charges`);

    const consolidations = await this.consolidatedRepository.find({
      where: {
        date: Between(startDateObj, endDateObj),
        ...(subsidiaryIds && subsidiaryIds.length > 0
          ? { subsidiary: { id: In(subsidiaryIds) } }
          : {}),
      },
      relations: ['subsidiary'],
    });
    this.logger.log(`Found ${consolidations.length} consolidations`);

    const incomes = await this.incomeRepository.find({
      where: {
        date: Between(startDateObj, endDateObj),
        ...(subsidiaryIds && subsidiaryIds.length > 0
          ? { subsidiary: { id: In(subsidiaryIds) } }
          : {}),
      },
      relations: ['subsidiary', 'shipment', 'charge'],
    });
    this.logger.log(`Found ${incomes.length} incomes`);

    const expenses = await this.expenseRepository.find({
      where: {
        date: Between(startDateObj, endDateObj),
        ...(subsidiaryIds && subsidiaryIds.length > 0
          ? { subsidiary: { id: In(subsidiaryIds) } }
          : {}),
      },
      relations: ['subsidiary'],
    });
    this.logger.log(`Found ${expenses.length} expenses`);

    // Procesar resultados
    const result = subsidiaries.map((subsidiary) => {
      const subsidiaryShipments = shipments.filter(
        (s) => s.subsidiary?.id === subsidiary.id,
      );
      const subsidiaryCharges = charges.filter(
        (c) => c.subsidiary?.id === subsidiary.id,
      );

      const totalPackagesFromShipments = subsidiaryShipments.length;
      const totalPackagesFromCharges = subsidiaryCharges.reduce(
        (sum, charge) => sum + (charge.numberOfPackages || 0),
        0,
      );
      const totalPackages =
        totalPackagesFromShipments + totalPackagesFromCharges;

      // Delivered packages
      const deliveredPackages = subsidiaryShipments.filter(
        (s) => s.status === ShipmentStatusType.ENTREGADO,
      ).length;

      // Undelivered packages
      const undeliveredShipments = subsidiaryShipments.filter(
        (s) => s.status === ShipmentStatusType.NO_ENTREGADO,
      );
      const undeliveredStatusBreakdown = undeliveredShipments.reduce(
        (acc, shipment) => {
          const latestStatusEntry = shipment.statusHistory?.slice(-1)[0];
          const exceptionCode = latestStatusEntry?.exceptionCode || 'Unknown';
          acc.totalUndelivered += 1;
          acc.byExceptionCode[exceptionCode] =
            (acc.byExceptionCode[exceptionCode] || 0) + 1;
          return acc;
        },
        {
          totalUndelivered: 0,
          byExceptionCode: {
            '07': 0,
            '08': 0,
            '03': 0,
            Unknown: 0,
          },
        },
      );

      // In-transit packages
      const inTransitPackages = subsidiaryShipments.filter(
        (s) => s.status === ShipmentStatusType.EN_RUTA,
      ).length;

      // Charges
      const totalCharges = subsidiaryCharges.length;

      // Consolidations
      const subsidiaryConsolidations = consolidations.filter(
        (c) => c.subsidiary?.id === subsidiary.id,
      );
      const ordinaryConsolidations = subsidiaryConsolidations.filter(
        (c) => c.type === ConsolidatedType.ORDINARIA,
      ).length;
      const airConsolidations = subsidiaryConsolidations.filter(
        (c) => c.type === ConsolidatedType.AEREO,
      ).length;

      // Revenue
      const subsidiaryIncomes = incomes.filter(
        (i) => i.subsidiary?.id === subsidiary.id,
      );
      const totalRevenue = subsidiaryIncomes.reduce(
        (sum, income) => sum + Number(income.cost || 0),
        0,
      );

      // Average revenue per package
      const averageRevenuePerPackage =
        totalPackages > 0 ? totalRevenue / totalPackages : 0;

      // Expenses
      const subsidiaryExpenses = expenses.filter(
        (e) => e.subsidiary?.id === subsidiary.id,
      );
      const totalExpenses = subsidiaryExpenses.reduce(
        (sum, expense) => sum + Number(expense.amount || 0),
        0,
      );

      // Efficiency
      const averageEfficiency =
        totalPackages > 0 ? (deliveredPackages * 100) / totalPackages : 0;

      // Profit
      const totalProfit = totalRevenue - totalExpenses;

      return {
        subsidiaryId: subsidiary.id,
        subsidiaryName: subsidiary.name,
        totalPackages,
        deliveredPackages,
        undeliveredPackages: undeliveredStatusBreakdown.totalUndelivered,
        undeliveredDetails: {
          total: undeliveredStatusBreakdown.totalUndelivered,
          byExceptionCode: {
            code07: undeliveredStatusBreakdown.byExceptionCode['07'],
            code08: undeliveredStatusBreakdown.byExceptionCode['08'],
            code03: undeliveredStatusBreakdown.byExceptionCode['03'],
            unknown: undeliveredStatusBreakdown.byExceptionCode['Unknown'],
          },
        },
        inTransitPackages,
        totalCharges,
        consolidations: {
          ordinary: ordinaryConsolidations,
          air: airConsolidations,
          total: ordinaryConsolidations + airConsolidations,
        },
        averageRevenuePerPackage,
        totalRevenue,
        totalExpenses,
        averageEfficiency,
        totalProfit,
      };
    });

    return result.sort(
      (a, b) => (b.averageEfficiency || 0) - (a.averageEfficiency || 0),
    );
  }

  async getSubsidiariesKpis(startDate: string, endDate: string, subsidiaryIds?: string[]) {
    const startDateObj = startOfDay(new Date(startDate));
    const endDateObj = endOfDay(new Date(endDate));

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      throw new Error('Invalid date format. Please use ISO 8601 format (e.g., YYYY-MM-DD).');
    }

    // Calculamos los días del rango para el prorrateo (+1 para incluir el día actual)
    const daysInDateRange = differenceInDays(endDateObj, startDateObj) + 1;
    this.logger.log(`Fetching Optimized KPIs: ${startDate} to ${endDate} (${daysInDateRange} days)`);

    // 1. Obtener las sucursales base
    const subsidiariesQuery = this.subsidiaryRepository.createQueryBuilder('subsidiary');
    if (subsidiaryIds?.length) {
      subsidiariesQuery.where('subsidiary.id IN (:...subsidiaryIds)', { subsidiaryIds });
    }
    const subsidiaries = await subsidiariesQuery.getMany();

    // Filtro reutilizable para los QueryBuilders
    const hasSubsidiaryFilter = subsidiaryIds?.length > 0;
    const subsidiaryCondition = hasSubsidiaryFilter ? 'subsidiaryId IN (:...subsidiaryIds)' : '1=1';

    // 2. EJECUTAR AGREGACIONES EN PARALELO EN LA BASE DE DATOS
    const [
      shipmentStats,
      chargeStats,
      expenseStats,
      incomeStats,
      consolidatedStats
    ] = await Promise.all([
      
      // -- A. ESTADÍSTICAS DE ENVÍOS (Ahora incluye los códigos de excepción) --
      this.shipmentRepository.createQueryBuilder('shipment')
        .select('shipment.subsidiaryId', 'subsidiaryId')
        .addSelect('COUNT(shipment.id)', 'total')
        .addSelect(`SUM(CASE WHEN shipment.status = '${ShipmentStatusType.ENTREGADO}' THEN 1 ELSE 0 END)`, 'delivered')
        .addSelect(`SUM(CASE WHEN shipment.status = '${ShipmentStatusType.EN_RUTA}' THEN 1 ELSE 0 END)`, 'inTransit')
        .addSelect(`SUM(CASE WHEN shipment.status = '${ShipmentStatusType.NO_ENTREGADO}' THEN 1 ELSE 0 END)`, 'noEntregadoBase')
        .addSelect(`SUM(CASE WHEN shipment.status = '${ShipmentStatusType.RECHAZADO}' THEN 1 ELSE 0 END)`, 'code07')
        .addSelect(`SUM(CASE WHEN shipment.status = '${ShipmentStatusType.CLIENTE_NO_DISPONIBLE}' THEN 1 ELSE 0 END)`, 'code08')
        .addSelect(`SUM(CASE WHEN shipment.status = '${ShipmentStatusType.DIRECCION_INCORRECTA}' THEN 1 ELSE 0 END)`, 'code03')
        .where('shipment.createdAt BETWEEN :startDate AND :endDate', { startDate: startDateObj, endDate: endDateObj })
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

      // -- C. ESTADÍSTICAS DE GASTOS (Agrupados por sucursal y frecuencia) --
      this.expenseRepository.createQueryBuilder('expense')
        .select('expense.subsidiaryId', 'subsidiaryId')
        .addSelect('expense.frequency', 'frequency')
        .addSelect('SUM(expense.amount)', 'totalAmount')
        .addSelect('COUNT(expense.id)', 'txCount')
        .where('expense.date BETWEEN :startDate AND :endDate', { startDate: startDateObj, endDate: endDateObj })
        .andWhere(subsidiaryCondition, { subsidiaryIds })
        .groupBy('expense.subsidiaryId')
        .addGroupBy('expense.frequency')
        .getRawMany(),

      // -- D. INGRESOS TOTALES --
      this.incomeRepository.createQueryBuilder('income')
        .select('income.subsidiaryId', 'subsidiaryId')
        .addSelect('SUM(income.cost)', 'totalRevenue')
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

    // 3. MAPEAR LOS RESULTADOS A LA ESTRUCTURA FINAL
    const result = subsidiaries.map((subsidiary) => {
      // Extraer datos pre-calculados o usar default {} si no hay movimientos
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

      // Desglose de Códigos de Excepción directamente de SQL
      const code07 = Number(sStats.code07 || 0);
      const code08 = Number(sStats.code08 || 0);
      const code03 = Number(sStats.code03 || 0);
      const noEntregadoBase = Number(sStats.noEntregadoBase || 0); // Por si aún usas el estado general
      
      const totalUndelivered = code07 + code08 + code03 + noEntregadoBase;

      // Cálculo de Gastos Prorrateados
      const subExpenses = expenseStats.filter(e => e.subsidiaryId === subsidiary.id);
      const totalExpenses = subExpenses.reduce((sum, e) => {
        const rawAmount = Number(e.totalAmount || 0);
        const txCount = Number(e.txCount || 1);

        // 1. Gastos Únicos o Diarios:
        if (e.frequency === Frequency.UNIQUE || e.frequency === Frequency.DIARIO) {
          return sum + rawAmount;
        }

        // 2. Gastos Fijos (Semanal, Mensual, Anual):
        const baseAmountPerTx = rawAmount / txCount;
        
        // Calculamos el costo por día de ese gasto base
        const dailyExpense = this.calculateDailyExpense(baseAmountPerTx, e.frequency);
        
        // Multiplicamos por los días filtrados
        return sum + (dailyExpense * daysInDateRange);
      }, 0);

      const averageRevenuePerPackage = totalPackages > 0 ? totalRevenue / totalPackages : 0;
      const averageEfficiency = totalPackages > 0 ? (deliveredPackages * 100) / totalPackages : 0;
      const totalProfit = totalRevenue - totalExpenses;

      return {
        subsidiaryId: subsidiary.id,
        subsidiaryName: subsidiary.name,
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

    return result.sort((a, b) => (b.averageEfficiency || 0) - (a.averageEfficiency || 0));
  }

  private calculateDailyExpense(amount: number, frequency: string): number {
    switch (frequency) {
      case Frequency.UNIQUE: // 'Único' - Se asume que el gasto completo pertenece a este periodo
        return amount;
      case Frequency.DIARIO: // 'Diario'
        return amount;
      case Frequency.SEMANAL: // 'Semanal'
        return amount / 7;
      case Frequency.MENSUAL: // 'Mensual'
        return amount / 30.4167; // Promedio contable de días por mes
      case Frequency.ANUAL: // 'Anual'
        return amount / 365;
      default:
        // Fallback de seguridad en caso de datos anómalos
        return amount; 
    }
  }

}