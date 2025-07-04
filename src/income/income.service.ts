import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { Expense, Income, Shipment } from 'src/entities';
import { formatCurrency, getStartAndEndOfMonth, localKey } from 'src/utils/format.util';
import { Between, In, Raw, Repository } from 'typeorm';
import { IncomeDto } from './dto/income.dto';
import { Collection } from 'src/entities/collection.entity';
import { toZonedTime, format } from 'date-fns-tz';
import { groupBy } from 'lodash';
import { FormatIncomesDto } from './dto/format-incomes.dto';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { DailyExpenses } from './dto/daily-expenses.dto';

@Injectable()
export class IncomeService {
  
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
            subsidiaryId,
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
          subsidiaryId,
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

    async formatIncomesNew(
      incomes: Income[],
      fromDate: Date,
      toDate: Date
    ): Promise<FormatIncomesDto[]> {
      const report: FormatIncomesDto[] = [];
      const pad = (n: number) => String(n).padStart(2, '0');
      const timeZone = 'America/Mexico_City';

      const localKey = (utcDate: Date): string => {
        const zonedDate = toZonedTime(utcDate, timeZone);
        return format(zonedDate, 'yyyy-MM-dd');
      };

      const localDisplay = (utcDate: Date): string => {
        const zonedDate = toZonedTime(utcDate, timeZone);
        return zonedDate.toLocaleDateString('es-MX', {
          timeZone,
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
      };

      // Agrupamos incomes por fecha LOCAL (zona MX)
      const grouped = groupBy(incomes, inc => localKey(new Date(inc.date)));

      // Normalizamos las fechas desde medianoche en zona MX
      const buildMidnightMX = (d: Date): Date => {
        const yyyy = d.getUTCFullYear();
        const mm = pad(d.getUTCMonth() + 1);
        const dd = pad(d.getUTCDate());
        return new Date(`${yyyy}-${mm}-${dd}T00:00:00-07:00`);
      };

      let cursor = buildMidnightMX(fromDate);
      const endCursor = buildMidnightMX(toDate);
      const oneDayMs = 24 * 60 * 60 * 1000;

      while (cursor.getTime() <= endCursor.getTime()) {
        const key = localKey(cursor);
        const label = localDisplay(cursor);

        const dayIncomes     = grouped[key] || [];
        const dayShipments   = dayIncomes.filter(i => i.sourceType === 'shipment');
        const dayCollections = dayIncomes.filter(i => i.sourceType === 'collection');
        const dayCharges     = dayIncomes.filter(i => i.sourceType === 'charge');

        const fedexIncomes = dayShipments.filter(i => i.shipmentType === 'fedex');
        const dhlIncomes   = dayShipments.filter(i => i.shipmentType === 'dhl');

        const fedexDelivered = fedexIncomes.filter(i => i.incomeType === 'entregado').length;
        const fedexNotDelivered = fedexIncomes.filter(i =>
          i.incomeType === 'no_entregado' &&
          ['07', '08'].includes(i.notDeliveryStatus || '')
        ).length;
        const fedexTotalIncome = fedexIncomes.reduce((sum, i) => sum + parseFloat(i.cost || '0'), 0);

        const dhlDelivered = dhlIncomes.filter(i => i.deliveryStatus === 'BA').length;
        const dhlNotDelivered = dhlIncomes.filter(i => i.deliveryStatus === 'NE').length;
        const dhlTotalIncome = dhlIncomes.reduce((sum, i) => sum + parseFloat(i.cost || '0'), 0);

        const collectionTotalIncome = dayCollections.reduce((sum, i) => sum + parseFloat(i.cost || '0'), 0);
        const chargeTotalIncome = dayCharges.reduce((sum, i) => sum + parseFloat(i.cost || '0'), 0);

        const collectionsCount = dayCollections.length;
        const cargasCount = dayCharges.length;
        const totalCount = fedexDelivered + fedexNotDelivered + dhlDelivered + dhlNotDelivered + collectionsCount + cargasCount;

        // ✅ Incluir collections en el total de ingreso
        const totalIncome = fedexTotalIncome + dhlTotalIncome + chargeTotalIncome + collectionTotalIncome;

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
          cost: parseFloat(i.cost || '0'),
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

        cursor = new Date(cursor.getTime() + oneDayMs);
      }

      return report;
    }

    async getIncome(subsidiaryId: string, fromDate: Date, toDate: Date) {
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new Error('Invalid date format for startISO or endISO');
      }

      // Incluir toda la fecha final (hasta las 23:59:59.999 del día 22)
      const adjustedToDate = new Date(toDate);
      adjustedToDate.setHours(23, 59, 59, 999);

      const incomes = await this.incomeRepository.find({
        where: {
          subsidiaryId,
          date: Raw(alias => `${alias} >= :from AND ${alias} < :to`, { from: fromDate, to: adjustedToDate }),
        },
        order: {
          date: 'ASC',
        },
      });

      const incomeData = await this.formatIncomesNew(incomes, fromDate, toDate);
      return incomeData;
    }

    /******* HASTA AQUI */

    /******* De aquí para abajo se necesita refactorizar */
      async getWeecklyShipmentReport(subsidiaryId: string, fromDate: Date, toDate: Date) {
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          throw new Error('Invalid date format for startISO or endISO');
        }

        const incomes = await this.incomeRepository.find({
          where: {
            subsidiaryId,
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
            createdAt: Between(fromDate.toISOString(), toDate.toISOString())
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
            createdAt: Between(firstDay.toISOString(), lastDay.toISOString())
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
            subsidiaryId,
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
            createdAt: Between(firstDay.toISOString(), lastDay.toISOString())
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
