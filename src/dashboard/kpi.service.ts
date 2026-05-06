import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, Brackets } from 'typeorm';
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

  async getSubsidiariesKpisResp0205(startDate: string, endDate: string, subsidiaryIds?: string[]) {
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

    // 2. EJECUTAR AGREGACIONES EN PARALELO EN LA BASE DE DATOS
    const [
      shipmentStats,
      chargeStats,
      expenseStats,
      incomeStats,
      consolidatedStats
    ] = await Promise.all([
      
      // -- A. ESTADÍSTICAS DE ENVÍOS --
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

      // -- C. ESTADÍSTICAS DE GASTOS --
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
      const totalExpenses = subExpenses.reduce((sum, e) => {
        const rawAmount = Number(e.totalAmount || 0);
        const txCount = Number(e.txCount || 1);

        if (e.frequency === Frequency.UNIQUE || e.frequency === Frequency.DIARIO) {
          return sum + rawAmount;
        }

        const baseAmountPerTx = rawAmount / txCount;
        const dailyExpense = this.calculateDailyExpense(baseAmountPerTx, e.frequency);
        
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

    const sortedSubsidiaries = result.sort((a, b) => (b.averageEfficiency || 0) - (a.averageEfficiency || 0));

    // 4. CALCULAR TOTALES GENERALES DE TODA LA EMPRESA
    const generalTotalIncome = sortedSubsidiaries.reduce((sum, sub) => sum + sub.totalRevenue, 0);
    const generalTotalExpenses = sortedSubsidiaries.reduce((sum, sub) => sum + sub.totalExpenses, 0);
    const generalTotalProfit = generalTotalIncome - generalTotalExpenses;

    // 5. REGRESAMOS EL ARREGLO COMO ANTES, PERO INYECTAMOS EL SUMARIO EN CADA ELEMENTO
    return sortedSubsidiaries.map(sub => ({
      ...sub,
      generalSummary: {
        totalIncome: generalTotalIncome,
        totalExpenses: generalTotalExpenses,
        totalProfit: generalTotalProfit
      }
    }));
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

      // -- C. ESTADÍSTICAS DE GASTOS --
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
      const totalExpenses = subExpenses.reduce((sum, e) => {
        const rawAmount = Number(e.totalAmount || 0);
        const txCount = Number(e.txCount || 1);

        if (e.frequency === Frequency.UNIQUE || e.frequency === Frequency.DIARIO) {
          return sum + rawAmount;
        }

        const baseAmountPerTx = rawAmount / txCount;
        const dailyExpense = this.calculateDailyExpense(baseAmountPerTx, e.frequency);
        
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