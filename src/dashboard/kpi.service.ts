import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { ConsolidatedType } from 'src/common/enums/consolidated-type.enum';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { Charge, ChargeShipment, Consolidated, Expense, Income, Shipment, ShipmentStatus, Subsidiary } from 'src/entities';
import { startOfDay, endOfDay } from 'date-fns';

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
  async getSubsidiaryKpis(startDate: string, endDate: string) {
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


  async getSubsidiariesKpis(startDate: string, endDate: string, subsidiaryIds: string[]) {
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

}