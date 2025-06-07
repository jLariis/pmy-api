import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { Shipment } from 'src/entities';
import { formatCurrency, getWeekRange } from 'src/utils/format.util';
import { Between, In, Repository } from 'typeorm';

@Injectable()
export class IncomeService {
  
  constructor(
    @InjectRepository(Shipment)
    private shipmentRepository: Repository<Shipment>){}

    async getDailyShipmentReport(subsidiaryId: string) {
      // 1. Calcular rango de la semana (lunes a domingo)
      // 1. Calcular rango usando strings ISO para consistencia
      const { startDate, endDate } = getWeekRange();

      const startISO = new Date(startDate);
      const endISO = new Date(endDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format for startISO or endISO');
      }

      const shipments = await this.shipmentRepository.find({
        where: {
          subsidiaryId,
          statusHistory: {
            timestamp: Between(startISO, endISO),
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


      // 3. Procesamiento en memoria
      const dailyStats = this.processShipmentsByDay(shipments, startDate, endDate);

      // 4. Formatear resultado final
      return this.formatDailyReport(dailyStats, startDate);
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

    private formatDailyReport(dailyStats: Record<string, any>, startDate: Date) {
      const dateFormatter = new Intl.DateTimeFormat('es-MX', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      const PRECIO_ENTREGADO = 59.15;
      const PRECIO_NO_ENTREGADO = 41.00;

      return Array.from({ length: 7 }, (_, i) => {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + i);
        const dateKey = currentDate.toISOString().split('T')[0];
        const stats = dailyStats[dateKey] || { entregados: 0, no_entregados: 0 };

        const total = stats.entregados + stats.no_entregados;
        const totalIngresos = (stats.entregados * PRECIO_ENTREGADO) + 
                            (stats.no_entregados * PRECIO_NO_ENTREGADO);

        return {
          date: dateFormatter.format(currentDate),
          ok: stats.entregados,
          ne: stats.no_entregados,
          ba: 0,
          collections: 0,
          total: total,
          totalIncome: formatCurrency(totalIngresos)
        };
      });
    }
}
