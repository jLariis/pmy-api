import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { Expense, Income, Shipment } from 'src/entities';
import { formatCurrency, getStartAndEndOfMonth, getWeekRange } from 'src/utils/format.util';
import { Between, In, Repository } from 'typeorm';
import { IncomeDto } from './dto/income.dto';
import { Collection } from 'src/entities/collection.entity';
import { format } from 'date-fns';
import { groupBy } from 'lodash';
import { FormatIncomesDto } from './dto/format-incomes.dto';

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
    /****  Debe ser por sucursal */ 
    private PRECIO_ENTREGADO = 59.15;
    private PRECIO_NO_ENTREGADO = 41.00;
    private PRECIO_DHL = 41.00;

    private async getIncomes(subsidiaryId: string, fromDate: Date, toDate: Date, withCharge: boolean = false) {
      return await this.incomeRepository.find({
        where: {
          subsidiaryId,
          date: Between(fromDate, toDate),
          isPartOfCharge: withCharge
        }
      })
    }

    private async getShipments(subsidiaryId: string, fromDate: Date, toDate: Date, withCharge: boolean = false) {
      return await this.shipmentRepository.find({
        where: {
          subsidiaryId,
          statusHistory: {
            timestamp: Between(fromDate, toDate),
            status: In(['entregado', 'no_entregado'])
          },
          
        },
        relations: ['statusHistory'],
        order: {
          statusHistory: {
            timestamp: 'DESC'
          }
        }
      });
    }

    private async getCollections(subsidiaryId: string, fromDate: Date, toDate: Date) {
      return await this.collectionRepository.find({
        where: {
          createdAt: Between(fromDate.toISOString(), toDate.toISOString()),
          subsidiaryId: subsidiaryId
        }
      });
    }

    private async getTotalShipmentsIncome(subsidiaryId: string, fromDate: Date, toDate: Date){
      //isPartOfCharge: is315 
      // --> si es true es carga completa si es false es normal      
      
      const shipments = await this.getShipments(subsidiaryId, fromDate, toDate, false);
      const chargeShipments = await this.getShipments(subsidiaryId, fromDate, toDate, true);

      const groupedShipments = groupBy(chargeShipments, (s) => new Date(s.createdAt).toISOString());
      const numberOfPackages = Object.keys(groupedShipments).length;
      console.log("🚀 ~ IncomeService ~ getTotalShipmentsIncome ~ numberOfPackages:", numberOfPackages)
      const totalShipmentIncome = (shipments.length * this.PRECIO_ENTREGADO) +
      (numberOfPackages * 3900);

      return {
        totalIncome: totalShipmentIncome,
        shipments: [...shipments, ...chargeShipments]
      } 
    }

    private async getTotalIncomeCollections(subsidiaryId: string, fromDate: Date, toDate: Date) {
      const collections = await this.getCollections(subsidiaryId, fromDate, toDate);

      return {
        totalCollections: collections.length * this.PRECIO_ENTREGADO,
        collections: collections
      }
    }

    private async getTotalExpenses(subsiaryId: string, fromDate: Date, toDate: Date){
      const expenses = await this.expenseRepository.find({
        where: {
          subsidiary: {
            id: subsiaryId
          },
          date: Between(fromDate, toDate)
        },
        relations: ['category']
      })

      const totalExpenses = expenses.reduce((sum, g) => {
        const amount = typeof g.amount === 'string' ? parseFloat(g.amount) : g.amount;
        return sum + (amount || 0);
      }, 0);

      return {
        totalExpenses: totalExpenses,
        expenses: expenses
      }
    }

    async getFinantialDataForDashboard(subsidiaryId: string){
      const today = new Date();
      
      //Obtener primer y último día del mes
      const { start, end } = getStartAndEndOfMonth(today);

      const { totalIncome, shipments } = await this.getTotalShipmentsIncome(subsidiaryId, start, end);
      const { totalCollections, collections } = await this.getTotalIncomeCollections(subsidiaryId, start, end);
      const { totalExpenses, expenses } = await this.getTotalExpenses(subsidiaryId, start, end)
      
      const income = totalIncome + totalCollections;
      const balance = income - totalExpenses;
      const formattedIncome = await this.formatIncomes(shipments, collections, start, end);


      return {
        incomes: formattedIncome,
        expenses: expenses,
        finantial: {
          income: income,
          expenses: totalExpenses,
          balance: balance,
          period: `${format(start, 'dd/MM/yyyy')} - ${format(end, 'dd/MM/yyyy')}`
        }
      }
    }

    private async formatIncomes(
      shipments: Shipment[],
      collections: Collection[],
      startDate: Date,
      endDate: Date
    ): Promise<IncomeDto[]> {
      const dateFormatter = new Intl.DateTimeFormat('es-MX', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      const formatDateKey = (date: Date) => {
        const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        return localDate.toISOString().split('T')[0];
      };

      /*** Evitar fechas en el futuro */
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (endDate > today) {
        endDate = today;
      }

      // Inicializar días del rango
      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const dailyStats: Record<string, { entregados: number; no_entregados: number }> = {};
      const dailyCollections: Record<string, number> = {};

      for (let i = 0; i <= daysDiff; i++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        const dateKey = formatDateKey(date);
        dailyStats[dateKey] = { entregados: 0, no_entregados: 0 };
        dailyCollections[dateKey] = 0;
      }

      // Agrupar collections por fecha
      for (const col of collections) {
        const dateKey = formatDateKey(new Date(col.createdAt));
        if (dailyCollections[dateKey] !== undefined) {
          dailyCollections[dateKey]++;
        }
      }

      // Procesar shipments
      for (const shipment of shipments) {
        const lastStatus = shipment.statusHistory[0]; // ya ordenado DESC
        if (!lastStatus) continue;

        const { status, timestamp } = lastStatus;
        if (!['entregado', 'no_entregado'].includes(status)) continue;

        const dateKey = formatDateKey(new Date(timestamp));
        if (!dailyStats[dateKey]) continue;

        if (status === 'entregado') {
          dailyStats[dateKey].entregados++;
        } else {
          dailyStats[dateKey].no_entregados++;
        }
      }

      // Armar resultado final
      const report: IncomeDto[] = [];
      for (let i = 0; i <= daysDiff; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + i);
        const dateKey = formatDateKey(currentDate);
        const stats = dailyStats[dateKey];
        const collectionsCount = dailyCollections[dateKey] || 0;

        const entregadosConCollections = stats.entregados + collectionsCount;
        const total = entregadosConCollections + stats.no_entregados;

        const totalIngresos =
          (entregadosConCollections * this.PRECIO_ENTREGADO) +
          (stats.no_entregados * this.PRECIO_NO_ENTREGADO);

        report.push({
          date: dateFormatter.format(currentDate),
          ok: stats.entregados,
          ne: stats.no_entregados,
          ba: 0,
          collections: collectionsCount,
          total,
          totalIncome: formatCurrency(totalIngresos)
        });
      }

      return report;
    }

    async formatIncomesNew(
      incomes: Income[],
      shipments: Shipment[],
      collections: Collection[],
      fromDate: Date,
      toDate: Date
    ): Promise<FormatIncomesDto[]> {
      const report: FormatIncomesDto[] = [];

      // Agrupar por fecha en formato YYYY-MM-DD (asumiendo fechas en UTC)
      const groupedCollections = groupBy(collections, (c) =>
        new Date(c.createdAt).toISOString().split('T')[0]
      );

      /*** Esto va a cambiar ya que los cargos se sacar de una tabla especial = charge */
      const groupedShipments = 0 /*groupBy(
        shipments.filter((s) => s.isPartOfCharge),
        (s) => new Date(s.createdAt).toISOString().split('T')[0]
      );*/

      const groupedIncomes = groupBy(incomes, (i) =>
        new Date(i.date).toISOString().split('T')[0]
      );

      let currentDate = new Date(fromDate);

      while (currentDate <= toDate) {
        const dateStr = currentDate.toISOString().split('T')[0];

        // Logs para depuración de agrupamientos
        // console.log('Fecha actual:', dateStr);
        // console.log('Keys collections:', Object.keys(groupedCollections));
        // console.log('Keys shipments:', Object.keys(groupedShipments));
        // console.log('Keys incomes:', Object.keys(groupedIncomes));

        const dayIncomes = groupedIncomes[dateStr] || [];
        const dayCollections = groupedCollections[dateStr] || [];
        const dayCargas = groupedShipments[dateStr] || [];

        // Separar por tipo de envío
        const fedexIncomes = dayIncomes.filter((i) => i.shipmentType === 'fedex');
        const dhlIncomes = dayIncomes.filter((i) => i.shipmentType === 'dhl');

        // ---- FEDEx ----
        // Revisar que notDeliveryStatus sea string para evitar error en includes
        const fedexNotDelivered = fedexIncomes.filter(
          (i) =>
            i.incomeType === 'no_entregado' &&
            typeof i.notDeliveryStatus === 'string' &&
            ['07', '08', '17'].includes(i.notDeliveryStatus)
        ).length;

        const fedexDelivered = fedexIncomes.filter(
          (i) => i.incomeType === 'entregado'
        ).length;

        const fedexTotalIncome = fedexIncomes.reduce(
          (acc, i) => acc + Number(i.cost || 0),
          0
        );

        // ---- DHL ----
        // Aquí asumimos que existe un campo deliveryStatus que indica 'BA' o 'NE'
        const dhlDelivered = dhlIncomes.filter(
          (i) => i.deliveryStatus === 'BA'
        ).length;

        const dhlNotDelivered = dhlIncomes.filter(
          (i) => i.deliveryStatus === 'NE'
        ).length;

        const dhlTotalIncome = dhlIncomes.reduce(
          (acc, i) => acc + Number(i.cost || 0),
          0
        );

        const fedex = {
          pod: fedexDelivered,
          dex: fedexNotDelivered,
          total: fedexDelivered + fedexNotDelivered,
          totalIncome: formatCurrency(fedexTotalIncome)
        };

        const dhl = {
          ba: dhlDelivered,
          ne: dhlNotDelivered,
          total: dhlDelivered + dhlNotDelivered,
          totalIncome: formatCurrency(dhlTotalIncome)
        };

        const collectionsCount = dayCollections.length;
        const cargasCount = dayCargas.length;

        const total = fedex.total + dhl.total + collectionsCount + cargasCount;
        const totalIngresos = fedexTotalIncome + dhlTotalIncome;

        // Construcción de items con incomes
        const incomeItems = dayIncomes.map((i) => ({
          type: i.isPartOfCharge ? 'carga' : 'shipment',
          trackingNumber: i.trackingNumber,
          shipmentType: i.shipmentType,
          status: i.incomeType,
          date: new Date(i.date).toISOString(), // seguro que es Date o string parseable
          cost: Number(i.cost || 0)
        }));

        // Collections
        const collectionItems = dayCollections.map((c) => ({
          type: 'collection',
          trackingNumber: c.trackingNumber,
          date: new Date(c.createdAt).toISOString()
        }));

        // Cargas directas desde shipments
        const cargaItems = dayCargas.map((s) => ({
          type: 'carga',
          trackingNumber: s.trackingNumber,
          date: new Date(s.createdAt).toISOString()
        }));

        const items = [...incomeItems, ...collectionItems, ...cargaItems];

        report.push({
          date: dateStr,
          fedex,
          dhl,
          collections: collectionsCount,
          cargas: cargasCount,
          total,
          totalIncome: formatCurrency(totalIngresos),
          items
        });

        currentDate.setDate(currentDate.getDate() + 1);
      }

      return report;
    }

    async getIncome(subsidiaryId: string, fromDate: Date, toDate: Date) {
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new Error('Invalid date format for startISO or endISO');
      }

      const incomes = await this.getIncomes(subsidiaryId, fromDate, toDate);
      const shipments = await this.getShipments(subsidiaryId, fromDate, toDate);
      const collections = await this.getCollections(subsidiaryId, fromDate, toDate);

      const incomeData = await this.formatIncomesNew(incomes, shipments, collections, fromDate, toDate);
      
      //console.log("🚀 ~ IncomeService ~ getIncome ~ incomeData:", incomeData)
      
      return incomeData;
    }

    /******* De aquí para abajo se necesita refactorizar */
      async getWeecklyShipmentReport(subsidiaryId: string, fromDate: Date, toDate: Date) {
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          throw new Error('Invalid date format for startISO or endISO');
        }

        const shipments = await this.shipmentRepository.find({
          where: {
            subsidiaryId,
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

        const collections = await this.collectionRepository.find({
          where: {
            createdAt: Between(fromDate.toISOString(), toDate.toISOString())
          }
        })
        
        // 3. Procesamiento en memoria
        const dailyStats = this.processShipmentsByDay(shipments, fromDate, toDate);
        const dailyCollections = this.processCollectionsByDay(collections, fromDate, toDate);

        // 4. Formatear resultado final
        return this.formatDailyReport(dailyStats, dailyCollections, fromDate);
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
          const totalCollections = collentions.length * this.PRECIO_ENTREGADO;

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
            (entregadosConCollections * this.PRECIO_ENTREGADO) +
            (stats.no_entregados * this.PRECIO_NO_ENTREGADO);

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
