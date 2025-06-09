import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { Expense, Shipment } from 'src/entities';
import { formatCurrency, getWeekRange } from 'src/utils/format.util';
import { Between, In, Repository } from 'typeorm';
import { IncomeDto } from './dto/income.dto';
import { Collection } from 'src/entities/collection.entity';

@Injectable()
export class IncomeService {
  
  constructor(
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>,
    @InjectRepository(Expense)
    private expenseRepository: Repository<Expense>,
    @InjectRepository(Collection)
    private collectionRepository: Repository<Collection>,
  ){}
    /****  Debe ser por sucursal */ 
    private PRECIO_ENTREGADO = 59.15;
    private PRECIO_NO_ENTREGADO = 41.00;
    private PRECIO_DHL = 41.00;e


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

    async getMonthShipmentReport(subsidiaryId: string, firstDay: Date, lastDay: Date) {
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
        const incomeTotalWithCollections = totalIncome + totalCollections;

        return {
          income: incomeTotalWithCollections,
          expenses: totalExpenses,
          balance: incomeTotalWithCollections - totalExpenses,
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

      console.log("🚀 ~ IncomeService ~ processCollectionsByDay ~ dailyCollections:", dailyCollections)
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
        console.log("🚀 ~ IncomeService ~ constresult:IncomeDto[]=Array.from ~ collectionsCount:", collectionsCount)

        const entregadosConCollections = stats.entregados + collectionsCount;
        const total = entregadosConCollections + stats.no_entregados;

        const totalIngresos = 
          (entregadosConCollections * this.PRECIO_ENTREGADO) +
          (stats.no_entregados * this.PRECIO_NO_ENTREGADO);

        console.log("🚀 ~ IncomeService ~ constresult:IncomeDto[]=Array.from ~ totalIngresos:", totalIngresos)

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
