import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { Expense, Income, Shipment } from 'src/entities';
import { formatCurrency } from 'src/utils/format.util';
import { Between, In, Raw, Repository } from 'typeorm';
import { IncomeDto } from './dto/income.dto';
import { Collection } from 'src/entities/collection.entity';
import { FormatIncomesDto } from './dto/format-incomes.dto';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { DailyExpenses } from './dto/daily-expenses.dto';
import { format, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { BadRequestException } from '@nestjs/common';
import { groupBy } from 'lodash';
import { endOfDay, parseISO, startOfDay } from 'date-fns';

@Injectable()
export class IncomeService {
  private readonly logger = new Logger(Income.name);

  constructor(
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>,
    @InjectRepository(Expense)
    private expenseRepository: Repository<Expense>,
    @InjectRepository(Collection)
    private collectionRepository: Repository<Collection>,
    @InjectRepository(Income)
    private incomeRepository: Repository<Income>
  ){}

    private async getTotalShipmentsIncome(subsidiaryId: string, fromDate: Date, toDate: Date){      
        const incomes = await this.incomeRepository.find({
          where: {
            subsidiary: { id: subsidiaryId },
            date: Between(fromDate, toDate),
            sourceType: In([
              IncomeSourceType.SHIPMENT,
              IncomeSourceType.CHARGE,
              IncomeSourceType.COLLECTION,
            ]),
          },
          relations: ['subsidiary'],
        });

        const totalShipmentIncome = incomes.reduce(
          (acc, income) => acc + parseFloat(income.cost.toString()),
          0
        );

        return {
          totalIncome: totalShipmentIncome,
          incomes,
        };
    }

    private async getTotalExpenses(
      subsidiaryId: string,
      fromDate: Date,
      toDate: Date
    ): Promise<{
      totalExpenses: number;
      daily: DailyExpenses[];
    }> {
      // 1) Traer todos los gastos en el rango
      const expenses = await this.expenseRepository.find({
        where: {
          subsidiary: { id: subsidiaryId },
          date: Between(fromDate, toDate),
        },
        order: { date: 'ASC' },
      });

      // 2) Sumar total global
      const totalExpenses = expenses.reduce((sum, g) => {
        const amount =
          typeof g.amount === 'number'
            ? g.amount
            : parseFloat(String(g.amount)) || 0;
        return sum + amount;
      }, 0);

      // 3) Agrupar por día
      const grouped: Record<string, Expense[]> = {};
      expenses.forEach((g) => {
        // formateamos la fecha a YYYY-MM-DD
        const dayKey = g.date.toISOString().slice(0, 10);
        if (!grouped[dayKey]) grouped[dayKey] = [];
        grouped[dayKey].push(g);
      });

      // 4) Convertir a array con sumas diarias
      const daily: DailyExpenses[] = Object.entries(grouped).map(
        ([date, items]) => {
          const total = items.reduce((sum, g) => {
            const amount =
              typeof g.amount === 'number'
                ? g.amount
                : parseFloat(String(g.amount)) || 0;
            return sum + amount;
          }, 0);
          return { date, total, items };
        }
      );

      return { totalExpenses, daily };
    }


    async getFinantialDataForDashboard(subsidiaryId: string, startDay: Date, endDay: Date){
      //const today = new Date();
      
      //Obtener primer y último día del mes
      //const { start, end } = getStartAndEndOfMonth(today);

      // Incluir toda la fecha final (hasta las 23:59:59.999 del día 22)
      const adjustedToDate = new Date(endDay);
      adjustedToDate.setHours(23, 59, 59, 999);

      const incomes = await this.incomeRepository.find({
        where: {
          subsidiary: { id: subsidiaryId},
          date: Between(startDay, adjustedToDate),
        },
        order: {
          date: 'ASC',
        },
      });

      const income = await this.getTotalShipmentsIncome(subsidiaryId, startDay, adjustedToDate)
      
      const formattedIncome = await this.formatIncomesNew(incomes, startDay, adjustedToDate);
      const { totalExpenses, daily } = await this.getTotalExpenses(subsidiaryId, startDay, adjustedToDate)
      const balance = income.totalIncome - totalExpenses;

      console.log("Finalizo y retorna: ",  balance);

      return {
        incomes: formattedIncome,
        expenses: daily,
        finantial: {
          income: income.totalIncome,
          expenses: totalExpenses,
          balance: balance,
          period: `${format(startDay, 'dd/MM/yyyy')} - ${format(adjustedToDate, 'dd/MM/yyyy')}`
        }
      }
    }

    /******* DE AQUI EMPIEZA PARA GENERAR LOS INGRESOS */
    async formatIncomesNewRespaldo(
      incomes: Income[],
      fromDate: Date,
      toDate: Date
    ): Promise<FormatIncomesDto[]> {
      const report: FormatIncomesDto[] = [];
      const pad = (n: number) => String(n).padStart(2, '0');

      // Función que, dado un Date ISO, devuelve la clave "yyyy-MM-dd" en zona MX.
      const localKey = (d: Date) =>
        d.toLocaleDateString('sv', { timeZone: 'America/Mexico_City' });

      // Función para mostrar "dd-MM-yyyy" en zona MX.
      const localDisplay = (d: Date) =>
        d.toLocaleDateString('es-MX', {
          timeZone: 'America/Mexico_City',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });

      // 1) Agrupamos todos los incomes POR SU FECHA LOCAL.
      const grouped = groupBy(incomes, inc => localKey(new Date(inc.date)));

      // 2) Construimos startDate/endDate en *medianoche MX* explicitando la zona.
      //    Para ello montamos un ISO con -07:00.
      const buildMidnightMX = (d: Date): Date => {
        const yyyy = d.getUTCFullYear();
        const mm = pad(d.getUTCMonth() + 1);
        const dd = pad(d.getUTCDate());
        // 00:00:00 zona -07
        return new Date(`${yyyy}-${mm}-${dd}T00:00:00-07:00`);
      };
      let cursor = buildMidnightMX(fromDate);
      const endCursor = buildMidnightMX(toDate);

      const oneDayMs = 24 * 60 * 60 * 1000;
      while (cursor.getTime() <= endCursor.getTime()) {
        const key   = localKey(cursor);      // "2025-06-16"
        const label = localDisplay(cursor);  // "16-06-2025"

        const dayIncomes     = grouped[key] || [];
        const dayShipments   = dayIncomes.filter(i => i.sourceType === 'shipment');
        const dayCollections = dayIncomes.filter(i => i.sourceType === 'collection');
        console.log("🚀 ~ IncomeService ~ dayCollections:", dayCollections)
        const dayCharges     = dayIncomes.filter(i => i.sourceType === 'charge');

        // ---- FEDEx / DHL ----
        const fedexIncomes = dayShipments.filter(i => i.shipmentType === 'fedex');
        const dhlIncomes   = dayShipments.filter(i => i.shipmentType === 'dhl');

        const fedexDelivered    = fedexIncomes.filter(i => i.incomeType === 'entregado').length;
        const fedexNotDelivered = fedexIncomes.filter(i =>
          i.incomeType === 'no_entregado' &&
          ['07','08','17','03'].includes(i.notDeliveryStatus || '')
        ).length;
        const fedexTotalIncome = fedexIncomes.reduce((s,i) => s + parseFloat(i.cost||'0'), 0);

        const dhlDelivered    = dhlIncomes.filter(i => i.deliveryStatus === 'BA').length;
        const dhlNotDelivered = dhlIncomes.filter(i => i.deliveryStatus === 'NE').length;
        const dhlTotalIncome  = dhlIncomes.reduce((s,i) => s + parseFloat(i.cost||'0'), 0);

        // ---- CARGAS ----
        const chargeTotalIncome = dayCharges.reduce((s,i) => s + parseFloat(i.cost||'0'), 0);

        // ---- RESUMEN ----
        const collectionsCount = dayCollections.length;
        const cargasCount      = dayCharges.length;
        const totalCount       = fedexDelivered + fedexNotDelivered
                              + dhlDelivered + dhlNotDelivered
                              + collectionsCount + cargasCount;
        const totalIncome      = fedexTotalIncome + dhlTotalIncome + chargeTotalIncome;

        // ---- ITEMS ----
        const incomeItems = dayShipments.map(i => ({
          type: 'shipment' as const,
          trackingNumber: i.trackingNumber,
          shipmentType: i.shipmentType,
          status: i.incomeType,
          date: new Date(i.date).toISOString(),
          cost: parseFloat(i.cost || '0'),
        }));
        const collectionItems = dayCollections.map(i => ({
          type: 'collection' as const,
          trackingNumber: i.trackingNumber,
          date: new Date(i.date).toISOString(),
        }));
        const cargaItems = dayCharges.map(i => ({
          type: 'carga' as const,
          trackingNumber: i.trackingNumber,
          shipmentType: i.shipmentType,
          date: new Date(i.date).toISOString(),
          cost: parseFloat(i.cost || '0'),
        }));

        report.push({
          date: label,
          fedex: {
            pod: fedexDelivered,
            dex: fedexNotDelivered,
            total: fedexDelivered + fedexNotDelivered,
            totalIncome: formatCurrency(fedexTotalIncome),
          },
          dhl: {
            ba: dhlDelivered,
            ne: dhlNotDelivered,
            total: dhlDelivered + dhlNotDelivered,
            totalIncome: formatCurrency(dhlTotalIncome),
          },
          collections: collectionsCount,
          cargas: cargasCount,
          total: totalCount,
          totalIncome: formatCurrency(totalIncome),
          items: [...incomeItems, ...collectionItems, ...cargaItems],
        });

        // Avanzar 1 día (milisegundos) SIN depender de getDate()/UTC
        cursor = new Date(cursor.getTime() + oneDayMs);
      }

      return report;
    }

    async getIncomeRespaldo(subsidiaryId: string, fromDate: Date, toDate: Date) {
      this.logger.log(`📊 Iniciando getIncome para subsidiaryId=${subsidiaryId}, fromDate=${fromDate.toISOString()}, toDate=${toDate.toISOString()}`);

      // Validate input dates
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        const reason = `Fechas inválidas: fromDate=${fromDate}, toDate=${toDate}`;
        this.logger.error(`❌ ${reason}`);
        throw new BadRequestException(reason);
      }

      // Normalize to start and end of day in UTC
      const utcFromDate = startOfDay(new Date(fromDate));
      const utcToDate = endOfDay(new Date(toDate));

      this.logger.log(`📅 Fechas ajustadas: fromDate=${utcFromDate.toISOString()}, toDate=${utcToDate.toISOString()}`);

      // Query incomes
      const incomes = await this.incomeRepository.find({
        where: {
          subsidiary: { id: subsidiaryId },
          date: Raw(alias => `${alias} >= :from AND ${alias} <= :to`, { from: utcFromDate, to: utcToDate }),
        },
        order: {
          date: 'ASC',
        },
      });

      this.logger.log(`📈 Encontrados ${incomes.length} incomes para el rango`);
      if (incomes.length > 0) {
        this.logger.log(`📄 Muestra de ingresos: ${JSON.stringify(incomes.slice(0, 3), null, 2)}`);
        this.logger.log(`📄 Ingresos para 5-6 de julio: ${JSON.stringify(
          incomes.filter(i => {
            const date = typeof i.date === 'string' ? parseISO(i.date) : new Date(i.date);
            return date.toISOString().startsWith('2025-07-05') || date.toISOString().startsWith('2025-07-06');
          }), null, 2
        )}`);
      }

      const incomeData = await this.formatIncomesNew(incomes, utcFromDate, utcToDate);

      this.logger.log(`✅ Finalizado getIncome con ${incomeData.length} entradas en el reporte`);
      return incomeData;
    }

    async formatIncomesNewRespaldo12072025(
      incomes: Income[],
      fromDate: Date,
      toDate: Date
    ): Promise<FormatIncomesDto[]> {
      this.logger.log(`📊 Iniciando formatIncomesNew para rango ${fromDate.toISOString()} a ${toDate.toISOString()}`);
      const report: FormatIncomesDto[] = [];
      const timeZone = 'America/Mexico_City';
      const oneDayMs = 24 * 60 * 60 * 1000;

      // Validate input dates
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        const reason = `Fechas inválidas: fromDate=${fromDate}, toDate=${toDate}`;
        this.logger.error(`❌ ${reason}`);
        throw new BadRequestException(reason);
      }

      // Filter out FedEx shipments with nonDeliveryStatus '03'
      const filteredIncomes = incomes.filter(i => {
        if (i.sourceType === 'shipment' && i.shipmentType === 'fedex' && i.incomeType === 'no_entregado' && i.nonDeliveryStatus === '03') {
          this.logger.log(`📅 Excluyendo ingreso: tracking=${i.trackingNumber}, nonDeliveryStatus=${i.nonDeliveryStatus}`);
          return false;
        }
        return true;
      });

      this.logger.log(`📈 Ingresos filtrados: ${filteredIncomes.length} de ${incomes.length} originales`);

      // Group by UTC date (yyyy-MM-dd in UTC)
      const utcKey = (utcDate: Date): string => {
        if (isNaN(utcDate.getTime())) {
          this.logger.error(`❌ Invalid date in utcKey: ${utcDate}`);
          return 'invalid';
        }
        const key = format(utcDate, 'yyyy-MM-dd', { timeZone: 'UTC' });
        this.logger.log(`📅 utcKey input: ${utcDate.toISOString()}, output: ${key}`);
        return key;
      };

      // Format date for display in yyyy-MM-dd format (Mexico City)
      const localDisplay = (utcDate: Date): string => {
        const zonedDate = toZonedTime(utcDate, timeZone);
        return format(zonedDate, 'yyyy-MM-dd', { timeZone });
      };

      // Build a UTC date representing midnight in UTC
      const buildMidnightUTC = (d: Date): Date => {
        const utcMidnight = startOfDay(new Date(d));
        this.logger.log(`📅 buildMidnightUTC input: ${d.toISOString()}, output: ${utcMidnight.toISOString()}`);
        return utcMidnight;
      };

      // Group incomes by UTC date
      const grouped = groupBy(filteredIncomes, inc => {
        const date = typeof inc.date === 'string' ? parseISO(inc.date) : new Date(inc.date);
        if (isNaN(date.getTime())) {
          this.logger.error(`❌ Invalid date for income: ${JSON.stringify(inc)}`);
          return 'invalid';
        }
        const key = utcKey(date);
        this.logger.log(`📅 Grouping income: ${inc.date}, parsed: ${date.toISOString()}, key: ${key}`);
        return key;
      });

      // Normalize date range to midnight UTC
      let cursor = buildMidnightUTC(fromDate);
      const endCursor = buildMidnightUTC(toDate);

      this.logger.log(`📅 Rango normalizado: desde ${cursor.toISOString()} hasta ${endCursor.toISOString()}`);

      while (cursor.getTime() <= endCursor.getTime()) {
        const key = utcKey(cursor);
        const label = localDisplay(cursor);

        this.logger.log(`📅 Procesando día: ${key}, label: ${label}`);

        const dayIncomes = grouped[key] || [];

        // Log warning if incomes have missing or invalid fields
        if (dayIncomes.some(i => !i.sourceType || !i.cost)) {
          this.logger.warn(`⚠️ Ingresos con datos incompletos para ${key}: ${JSON.stringify(dayIncomes.filter(i => !i.sourceType || !i.cost))}`);
        }

        const dayShipments = dayIncomes.filter(i => i.sourceType === 'shipment');
        const dayCollections = dayIncomes.filter(i => i.sourceType === 'collection');
        const dayCharges = dayIncomes.filter(i => i.sourceType === 'charge');

        const fedexIncomes = dayShipments.filter(i => i.shipmentType === 'fedex');
        const dhlIncomes = dayShipments.filter(i => i.shipmentType === 'dhl');

        const fedexDelivered = fedexIncomes.filter(i => i.incomeType === 'entregado').length;
        const fedexNotDelivered = fedexIncomes.filter(i => {
          if (i.incomeType !== 'no_entregado') return false;
          const status = i.nonDeliveryStatus || '';
          const included = ['07', '08'].includes(status);
          this.logger.log(`📅 FedEx no_entregado: tracking=${i.trackingNumber}, nonDeliveryStatus=${status}, included=${included}`);
          return included;
        }).length;

        const fedexTotalIncome = fedexIncomes.reduce((sum, i) => {
          const cost = parseFloat(i.cost || '0');
          if (isNaN(cost)) {
            this.logger.warn(`⚠️ Costo inválido para ingreso fedex: ${JSON.stringify(i)}`);
            return sum;
          }
          return sum + cost;
        }, 0);

        const dhlDelivered = dhlIncomes.filter(i => i.deliveryStatus === 'BA').length;
        const dhlNotDelivered = dhlIncomes.filter(i => i.deliveryStatus === 'NE').length;
        const dhlTotalIncome = dhlIncomes.reduce((sum, i) => {
          const cost = parseFloat(i.cost || '0');
          if (isNaN(cost)) {
            this.logger.warn(`⚠️ Costo inválido para ingreso dhl: ${JSON.stringify(i)}`);
            return sum;
          }
          return sum + cost;
        }, 0);

        const collectionTotalIncome = dayCollections.reduce((sum, i) => {
          const cost = parseFloat(i.cost || '0');
          if (isNaN(cost)) {
            this.logger.warn(`⚠️ Costo inválido para ingreso collection: ${JSON.stringify(i)}`);
            return sum;
          }
          return sum + cost;
        }, 0);
        const chargeTotalIncome = dayCharges.reduce((sum, i) => {
          const cost = parseFloat(i.cost || '0');
          if (isNaN(cost)) {
            this.logger.warn(`⚠️ Costo inválido para ingreso charge: ${JSON.stringify(i)}`);
            return sum;
          }
          return sum + cost;
        }, 0);

        const collectionsCount = dayCollections.length;
        const cargasCount = dayCharges.length;
        const totalCount = fedexDelivered + fedexNotDelivered + dhlDelivered + dhlNotDelivered + collectionsCount + cargasCount;

        const totalIncome = fedexTotalIncome + dhlTotalIncome + chargeTotalIncome + collectionTotalIncome;

        const incomeItems = dayShipments.map(i => ({
          type: 'shipment' as const,
          trackingNumber: i.trackingNumber,
          shipmentType: i.shipmentType,
          status: i.incomeType,
          date: (typeof i.date === 'string' ? parseISO(i.date) : new Date(i.date)).toISOString(),
          cost: parseFloat(i.cost || '0'),
        }));

        const collectionItems = dayCollections.map(i => ({
          type: 'collection' as const,
          trackingNumber: i.trackingNumber,
          date: (typeof i.date === 'string' ? parseISO(i.date) : new Date(i.date)).toISOString(),
          cost: parseFloat(i.cost || '0'),
        }));

        const cargaItems = dayCharges.map(i => ({
          type: 'carga' as const,
          trackingNumber: i.trackingNumber,
          shipmentType: i.shipmentType,
          date: (typeof i.date === 'string' ? parseISO(i.date) : new Date(i.date)).toISOString(),
          cost: parseFloat(i.cost || '0'),
        }));

        // Log aggregation details for debugging
        this.logger.log(`📊 Procesando ${key}: ${dayIncomes.length} ingresos, fedex=${fedexDelivered}+${fedexNotDelivered}, dhl=${dhlDelivered}+${dhlNotDelivered}, collections=${collectionsCount}, cargas=${cargasCount}`);

        // Push report entry, including empty days
        report.push({
          date: label, // yyyy-MM-dd in Mexico City timezone for display
          fedex: {
            pod: fedexDelivered,
            dex: fedexNotDelivered,
            total: fedexDelivered + fedexNotDelivered,
            totalIncome: formatCurrency(fedexTotalIncome),
          },
          dhl: {
            ba: dhlDelivered,
            ne: dhlNotDelivered,
            total: dhlDelivered + dhlNotDelivered,
            totalIncome: formatCurrency(dhlTotalIncome),
          },
          collections: collectionsCount,
          cargas: cargasCount,
          total: totalCount,
          totalIncome: formatCurrency(totalIncome),
          items: [...incomeItems, ...collectionItems, ...cargaItems],
        });

        cursor = new Date(cursor.getTime() + oneDayMs);
      }

      // Log the full report for debugging
      this.logger.log(`📊 Reporte final: ${JSON.stringify(report, null, 2)}`);
      this.logger.log(`✅ Finalizado formatIncomesNew con ${report.length} días en el reporte`);
      return report;
    }

    async getIncome(subsidiaryId: string, fromDate: Date, toDate: Date) {
      this.logger.log(`📊 Iniciando getIncome para subsidiaryId=${subsidiaryId}, fromDate=${fromDate.toISOString()}, toDate=${toDate.toISOString()}`);

      // Validación de fechas
      if (!(fromDate instanceof Date) || isNaN(fromDate.getTime())) {
          throw new BadRequestException('Fecha inicial debe ser un objeto Date válido');
      }
      if (!(toDate instanceof Date) || isNaN(toDate.getTime())) {
          throw new BadRequestException('Fecha final debe ser un objeto Date válido');
      }
      if (fromDate > toDate) {
          throw new BadRequestException('La fecha inicial no puede ser mayor que la fecha final');
      }

      // Normalización a UTC
      const startOfRange = startOfDay(fromDate);
      const endOfRange = endOfDay(toDate);

      // Consulta a la base de datos con LEFT JOIN a Shipment
      const incomes = await this.incomeRepository.createQueryBuilder('income')
          .leftJoinAndSelect('income.shipment', 'shipment')
          .leftJoinAndSelect('shipment.statusHistory', 'statusHistory')
          .where({
              subsidiary: { id: subsidiaryId },
              date: Between(startOfRange, endOfRange),
          })
          .orderBy('income.date', 'ASC')
          .getMany();

      return this.formatIncomesNew(incomes, startOfRange, endOfRange);
    }

    async formatIncomesNew(
        incomes: Income[],
        utcFromDate: Date,
        utcToDate: Date
    ): Promise<FormatIncomesDto[]> {
        const report: FormatIncomesDto[] = [];
        const oneDayMs = 24 * 60 * 60 * 1000;

        // Filtrar ingresos
        const filteredIncomes = incomes.filter(i => {
            return !(i.sourceType === 'shipment' && 
                  i.shipmentType === 'fedex' && 
                  i.incomeType === 'no_entregado' && 
                  i.nonDeliveryStatus === '03');
        });

        // Agrupar por fecha UTC
        const grouped = filteredIncomes.reduce((acc, income) => {
            const date = typeof income.date === 'string' ? parseISO(income.date) : new Date(income.date);
            const dateKey = format(date, 'yyyy-MM-dd', { timeZone: 'UTC' });
            acc[dateKey] = acc[dateKey] || [];
            acc[dateKey].push(income);
            return acc;
        }, {} as Record<string, Income[]>);

        // Procesar día por día
        let currentDate = new Date(utcFromDate);
        const endDate = new Date(utcToDate);

        while (currentDate <= endDate) {
            const dateKey = format(currentDate, 'yyyy-MM-dd', { timeZone: 'UTC' });
            const dayIncomes = grouped[dateKey] || [];

            // Procesamiento por tipo de ingreso
            const dayShipments = dayIncomes.filter(i => i.sourceType === 'shipment');
            const dayCollections = dayIncomes.filter(i => i.sourceType === 'collection');
            const dayCharges = dayIncomes.filter(i => i.sourceType === 'charge');

            // FedEx
            const fedexIncomes = dayShipments.filter(i => i.shipmentType === 'fedex');
            const fedexDelivered = fedexIncomes.filter(i => i.incomeType === 'entregado').length;
            const fedexNotDelivered = fedexIncomes.filter(i => 
                i.incomeType === 'no_entregado' && 
                ['07', '08'].includes(i.nonDeliveryStatus || '')
            ).length;
            const fedexTotalIncome = fedexIncomes.reduce((sum, i) => sum + (i.cost || 0), 0);

            // DHL
            const dhlIncomes = dayShipments.filter(i => i.shipmentType === 'dhl');
            const dhlDelivered = dhlIncomes.filter(i => i.incomeType === 'entregado').length;
            const dhlNotDelivered = dhlIncomes.filter(i => i.incomeType === 'no_entregado').length;
            const dhlTotalIncome = dhlIncomes.reduce((sum, i) => sum + (i.cost || 0), 0);

            // Collections y Charges
            const collectionTotalIncome = dayCollections.reduce((sum, i) => sum + (i.cost || 0), 0);
            const chargeTotalIncome = dayCharges.reduce((sum, i) => sum + (i.cost || 0), 0);

            // Items detallados
            const items = [
                ...dayShipments.map(i => ({
                    type: 'shipment' as const,
                    trackingNumber: i.trackingNumber,
                    shipmentType: i.shipmentType,
                    status: i.incomeType,
                    date: (typeof i.date === 'string' ? parseISO(i.date) : new Date(i.date)).toISOString(),
                    cost: i.cost || 0,
                    statusHistory: i.shipment?.statusHistory || [], // Solo para shipments
                    commitDateTime: i.shipment?.commitDateTime // Fecha compromiso de shipment
                })),
                ...dayCollections.map(i => ({
                    type: 'collection' as const,
                    trackingNumber: i.trackingNumber,
                    date: (typeof i.date === 'string' ? parseISO(i.date) : new Date(i.date)).toISOString(),
                    cost: i.cost || 0,
                    // Sin statusHistory para collections
                })),
                ...dayCharges.map(i => ({
                    type: 'carga' as const,
                    trackingNumber: i.trackingNumber,
                    shipmentType: i.shipmentType,
                    date: (typeof i.date === 'string' ? parseISO(i.date) : new Date(i.date)).toISOString(),
                    cost: i.cost || 0,
                    // Sin statusHistory para charges
                }))
            ];

            report.push({
                date: dateKey,
                fedex: {
                    pod: fedexDelivered,
                    dex: fedexNotDelivered,
                    total: fedexDelivered + fedexNotDelivered,
                    totalIncome: formatCurrency(fedexTotalIncome),
                },
                dhl: {
                    ba: dhlDelivered,
                    ne: dhlNotDelivered,
                    total: dhlDelivered + dhlNotDelivered,
                    totalIncome: formatCurrency(dhlTotalIncome),
                },
                collections: dayCollections.length,
                cargas: dayCharges.length,
                total: fedexDelivered + fedexNotDelivered + dhlDelivered + dhlNotDelivered + dayCollections.length + dayCharges.length,
                totalIncome: formatCurrency(fedexTotalIncome + dhlTotalIncome + chargeTotalIncome + collectionTotalIncome),
                items,
            });

            currentDate = new Date(currentDate.getTime() + oneDayMs);
        }

        return report;
    }

    /******* HASTA AQUI */

    /******* De aquí para abajo se necesita refactorizar */
      async getWeecklyShipmentReport(subsidiaryId: string, fromDate: Date, toDate: Date) {
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          throw new Error('Invalid date format for startISO or endISO');
        }

        const incomes = await this.incomeRepository.find({
          where: {
            subsidiary: { id: subsidiaryId},
            date: 
              Between(fromDate, toDate)
          },
          order: {
            date:  'DESC'
          }
        });

        console.log("🚀 ~ IncomeService ~ getWeecklyShipmentReport ~ incomes:", incomes)
        
        // 3. Procesamiento en memoria
        //const dailyStats = this.processShipmentsByDay(shipments, fromDate, toDate);
        //const dailyCollections = this.processCollectionsByDay(collections, fromDate, toDate);

        // 4. Formatear resultado final
        //return this.formatDailyReport(dailyStats, dailyCollections, fromDate);
      }


      async getMonthlyShipmentReport(fromDate: Date, toDate: Date) {
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          throw new Error('Invalid date format for startISO or endISO');
        }

        const shipments = await this.shipmentRepository.find({
          where: {
            statusHistory: {
              timestamp: Between(fromDate, toDate),
              status: In(['entregado', 'no_entregado'])
            }
          },
          relations: ['statusHistory'],
          order: {
            statusHistory: {
              timestamp: 'DESC'
            }
          }
        });
        
        console.log("🚀 ~ IncomeService ~ getMonthlyShipmentReport ~ shipments:", shipments)

        const collections = await this.collectionRepository.find({
          where: {
            createdAt: Between(fromDate, toDate)
          }
        })
        console.log("🚀 ~ IncomeService ~ getMonthlyShipmentReport ~ collections:", collections)
        
        // 3. Procesamiento en memoria
        const dailyStats = this.processShipmentsByDay(shipments, fromDate, toDate);
        const dailyCollections = this.processCollectionsByDay(collections, fromDate, toDate);

        // 4. Formatear resultado final
        return this.formatDailyReport(dailyStats, dailyCollections, fromDate);
      }

      async getMonthShipmentReportAll(firstDay: Date, lastDay: Date) {
        if (isNaN(firstDay.getTime()) || isNaN(lastDay.getTime())) {
          throw new Error('Invalid date format for startISO or endISO');
        }

        const shipments = await this.shipmentRepository.find({
          where: {
            statusHistory: {
              timestamp: Between(firstDay, lastDay),
              status: In(['entregado', 'no_entregado'])
            }
          },
          relations: ['statusHistory'],
          order: {
            statusHistory: {
              timestamp: 'DESC'
            }
          }
        });

        const collections = await this.collectionRepository.find({
          where: {
            createdAt: Between(firstDay, lastDay)
          }
        })

        const dailyStats = this.processShipmentsByDay(shipments, firstDay, lastDay);
        const dailyCollections = this.processCollectionsByDay(collections, firstDay, lastDay);

        // 4. Formatear resultado final
        const incomes = await this.formatDailyReport(dailyStats, dailyCollections, firstDay);     

        const expenses = await this.expenseRepository.find({
          where: {
            date: Between(firstDay, lastDay)
          }
        });

        return await this.getResumenFinanciero(incomes, expenses, collections, firstDay, lastDay);
      }

      async getMonthShipmentReportBySucursal(subsidiaryId: string, firstDay: Date, lastDay: Date) {
        if (isNaN(firstDay.getTime()) || isNaN(lastDay.getTime())) {
          throw new Error('Invalid date format for startISO or endISO');
        }

        const shipments = await this.shipmentRepository.find({
          where: {
            subsidiary: { id: subsidiaryId},
            statusHistory: {
              timestamp: Between(firstDay, lastDay),
              status: In(['entregado', 'no_entregado'])
            }
          },
          relations: ['statusHistory'],
          order: {
            statusHistory: {
              timestamp: 'DESC'
            }
          }
        });

        const collections = await this.collectionRepository.find({
          where: {
            createdAt: Between(firstDay, lastDay)
          }
        })

        const dailyStats = this.processShipmentsByDay(shipments, firstDay, lastDay);
        const dailyCollections = this.processCollectionsByDay(collections, firstDay, lastDay);

        // 4. Formatear resultado final
        const incomes = await this.formatDailyReport(dailyStats, dailyCollections, firstDay);     

        const expenses = await this.expenseRepository.find({
          where: {
            date: Between(firstDay, lastDay)
          }
        });

        return await this.getResumenFinanciero(incomes, expenses, collections, firstDay, lastDay);
      }

      async getShipmentIncomeByDay(date: any){
        return this.shipmentRepository.find({
          where: {
            status: ShipmentStatusType.ENTREGADO,
            statusHistory: {
              timestamp: date
            }
          },
          relations:['statusHistory']
        })
      }

      /*** Validar por que en total Income no trae lo de collections aquí se suma ---> formatDailyReport  */
      private getResumenFinanciero(income: IncomeDto[], expense: Expense[], collentions: Collection[], firstDay: Date, lastDay: Date) {
        try {
          if (!income || !expense || !firstDay || !lastDay) {
            return {
              income: 0,
              expenses: 0,
              balance: 0,
              period: "Sin datos",
            }
          }

          const totalIncome = income.reduce((sum, i) => sum + (parseFloat(i.totalIncome.replace(/[$,]/g, '')) || 0), 0)
          const totalExpenses = expense.reduce((sum, g) => sum + (g.amount || 0), 0)
          const totalCollections = collentions.length * 59.51;

          return {
            income: totalIncome,
            expenses: totalExpenses,
            balance: totalIncome - totalExpenses,
            period: `${firstDay.toLocaleDateString()} - ${lastDay.toLocaleDateString()}`,
          }
        } catch (error) {
          console.error("Error en getResumenFinanciero:", error)
          return {
            income: 0,
            expenses: 0,
            balance: 0,
            period: "Error al calcular",
          }
        }
      }

      private processCollectionsByDay(collections: Collection[], startDate: Date, endDate: Date) {
        const dailyCollections: Record<string, number> = {};

        for (let i = 0; i < 7; i++) {
          const date = new Date(startDate);
          date.setDate(startDate.getDate() + i);
          const dateKey = date.toISOString().split('T')[0];
          dailyCollections[dateKey] = 0;
        }

        collections.forEach((collection) => {
          const createdAt = new Date(collection.createdAt);
          const dateKey = createdAt.toISOString().split('T')[0];
          if (dailyCollections[dateKey] !== undefined) {
            dailyCollections[dateKey]++;
          }
        });

        return dailyCollections;
      }

      private processShipmentsByDay(shipments: Shipment[], startDate: Date, endDate: Date) {
        const dailyStats: Record<string, { entregados: number; no_entregados: number }> = {};

        // Inicializar todos los días de la semana
        for (let i = 0; i < 7; i++) {
          const date = new Date(startDate);
          date.setDate(startDate.getDate() + i);
          const dateKey = date.toISOString().split('T')[0];
          dailyStats[dateKey] = { entregados: 0, no_entregados: 0 };
        }

        // Procesar cada shipment
        shipments.forEach(shipment => {
          const lastStatus = shipment.statusHistory[0]; // Ya está ordenado por timestamp DESC
          
          if (lastStatus && ['entregado', 'no_entregado'].includes(lastStatus.status)) {
            const statusDate = new Date(lastStatus.timestamp);
            const dateKey = statusDate.toISOString().split('T')[0];
            
            if (dailyStats[dateKey]) {
              if (lastStatus.status === 'entregado') {
                dailyStats[dateKey].entregados++;
              } else {
                dailyStats[dateKey].no_entregados++;
              }
            }
          }
        });

        return dailyStats;
      }

      private async formatDailyReport(dailyStats: Record<string, any>, dailyCollections: Record<string, number>, startDate: Date): Promise<IncomeDto[]> {
        const dateFormatter = new Intl.DateTimeFormat('es-MX', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });

        const result: IncomeDto[] = Array.from({ length: 7 }, (_, i) => {
          const currentDate = new Date(startDate);
          currentDate.setDate(startDate.getDate() + i);
          const dateKey = currentDate.toISOString().split('T')[0];
          const stats = dailyStats[dateKey] || { entregados: 0, no_entregados: 0 };
          const collectionsCount = dailyCollections[dateKey] || 0;
        
          const entregadosConCollections = stats.entregados + collectionsCount;
          const total = entregadosConCollections + stats.no_entregados;

          const totalIngresos = 
            (entregadosConCollections * 1) +
            (stats.no_entregados * 1);

          return {
            date: dateFormatter.format(currentDate),
            ok: stats.entregados,
            ne: stats.no_entregados,
            ba: 0,
            collections: collectionsCount,
            total: total,
            totalIncome: formatCurrency(totalIngresos)
          };
        });

        return Promise.resolve(result);
      }
}
