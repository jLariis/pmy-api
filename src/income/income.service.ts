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
import { addDays, endOfDay, parseISO, startOfDay } from 'date-fns';
import * as dayjs from 'dayjs';

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

    /*******  Métodos módificados el 26-01-2026 mejorados..*/
      async getIncome(subsidiaryId: string, fromDate: Date, toDate: Date) {
        this.logger.log(`📊 Iniciando getIncome optimizado para sucursal=${subsidiaryId}`);

        // 1. Definir rangos (Hermosillo Offset)
        const startCurrentUTC = dayjs(fromDate).startOf('day').add(7, 'hour');
        const endCurrentUTC = dayjs(toDate).endOf('day').add(7, 'hour');
        
        // El inicio real de nuestra búsqueda es hace 7 días desde la fecha inicial
        const startLastWeekUTC = startCurrentUTC.subtract(7, 'day');

        // 2. UNA SOLA CONSULTA a la BD
        // Quitamos 'statusHistory' para ganar velocidad.
        const allIncomes = await this.incomeRepository.createQueryBuilder('income')
            .leftJoinAndSelect('income.shipment', 'shipment')
            .where('income.subsidiaryId = :subsidiaryId', { subsidiaryId })
            .andWhere('income.date BETWEEN :start AND :end', { 
                start: startLastWeekUTC.toDate(), 
                end: endCurrentUTC.toDate() 
            })
            .orderBy('income.date', 'ASC')
            .getMany();

        // 3. Separar los datos en memoria
        // Datos actuales: desde startCurrentUTC en adelante
        const currentIncomes = allIncomes.filter(i => 
            dayjs(i.date).isAfter(startCurrentUTC.subtract(1, 'second'))
        );

        // Datos semana pasada: entre startLastWeek y el inicio de esta semana
        const lastWeekIncomes = allIncomes.filter(i => 
            dayjs(i.date).isBefore(startCurrentUTC) && 
            dayjs(i.date).isAfter(startLastWeekUTC.subtract(1, 'second'))
        );

        // 4. Formatear (Tu método formatIncomesNew ya maneja la lógica de agrupación)
        const currentFormatted = await this.formatIncomesNew(currentIncomes, fromDate, toDate);
        
        const lastWeekFrom = dayjs(fromDate).subtract(7, 'day').toDate();
        const lastWeekTo = dayjs(toDate).subtract(7, 'day').toDate();
        const lastWeekFormatted = await this.formatIncomesNew(lastWeekIncomes, lastWeekFrom, lastWeekTo);

        // 5. Preparar respuesta consolidada
        const lastWeekTotal = lastWeekFormatted.reduce(
            (acc, day) => acc + this.parseCurrency(day.totalIncome), 0
        );

        const chartData = currentFormatted.map((day, index) => {
            // Buscamos el día equivalente en la semana pasada por posición (index)
            const pastDay = lastWeekFormatted[index];
            return {
                name: day.date,
                actual: this.parseCurrency(day.totalIncome),
                pasada: this.parseCurrency(pastDay?.totalIncome || 0)
            };
        });

        return {
            current: currentFormatted,
            lastWeekTotal,
            chartData
        };
      }

      async formatIncomesNew(
          incomes: Income[],
          hermFromDate: Date,
          hermToDate: Date
      ): Promise<FormatIncomesDto[]> {
          const report: FormatIncomesDto[] = [];

          // 1. Filtrar ingresos para excluir nonDeliveryStatus = '03' (Regla de negocio)
          const filteredIncomes = incomes.filter(i => {
              return !(i.sourceType === 'shipment' &&
                      i.shipmentType === 'fedex' &&
                      i.incomeType === 'no_entregado' &&
                      i.nonDeliveryStatus === '03');
          });

          // 2. Función estandarizada para convertir UTC a fecha local de Hermosillo (UTC-7)
          const toHermosilloDate = (date: Date | string) => {
              // Usamos dayjs para restar las 7 horas de diferencia de forma segura
              return dayjs(date).subtract(7, 'hour');
          };

          // 3. Agrupar ingresos por fecha local de Hermosillo
          const grouped = filteredIncomes.reduce((acc, income) => {
            let hermDate;

            if (income.sourceType === 'charge') {
                // REGLA ESPECIAL: Las cargas ya están en hora local
                // Solo las parseamos sin restar horas
                hermDate = dayjs(income.date);
            } else {
                // Los envíos y recolecciones sí vienen en UTC
                hermDate = dayjs(income.date).subtract(7, 'hour');
            }

            const dateKey = hermDate.format('YYYY-MM-DD');
            
            if (!acc[dateKey]) {
                acc[dateKey] = [];
            }
            acc[dateKey].push(income);
            return acc;
        }, {} as Record<string, Income[]>);

          // 4. Procesar el rango solicitado día por día
          let currentDate = dayjs(hermFromDate).startOf('day');
          const endDate = dayjs(hermToDate).endOf('day');

          while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, 'day')) {
              const dateKey = currentDate.format('YYYY-MM-DD');
              const dayIncomes = grouped[dateKey] || [];

              // Clasificación por origen
              const dayShipments = dayIncomes.filter(i => i.sourceType === 'shipment');
              const dayCollections = dayIncomes.filter(i => i.sourceType === 'collection');
              const dayCharges = dayIncomes.filter(i => i.sourceType === 'charge');

              // Métricas FedEx
              const fedexIncomes = dayShipments.filter(i => i.shipmentType === 'fedex');
              const fedexDelivered = fedexIncomes.filter(i => i.incomeType === 'entregado').length;
              const fedexDex07 = fedexIncomes.filter(i => 
                  i.incomeType === 'no_entregado' && i.nonDeliveryStatus === '07'
              ).length;
              const fedexDex08 = fedexIncomes.filter(i => 
                  i.incomeType === 'no_entregado' && i.nonDeliveryStatus === '08'
              ).length;
              const fedexTotalIncome = fedexIncomes.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

              // Métricas DHL
              const dhlIncomes = dayShipments.filter(i => i.shipmentType === 'dhl');
              const dhlDelivered = dhlIncomes.filter(i => i.incomeType === 'entregado').length;
              const dhlNotDelivered = dhlIncomes.filter(i => i.incomeType === 'no_entregado').length;
              const dhlTotalIncome = dhlIncomes.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

              // Métricas Otros (Collections y Cargas)
              const collectionTotalIncome = dayCollections.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);
              const chargeTotalIncome = dayCharges.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

              // Construcción de items detallados
              const items = dayIncomes.map(i => {
                  const hermDate = toHermosilloDate(i.date);
                  
                  // Mapeo dinámico del tipo para el frontend
                  let displayType: 'shipment' | 'collection' | 'carga' = 'shipment';
                  if (i.sourceType === 'collection') displayType = 'collection';
                  if (i.sourceType === 'charge') displayType = 'carga';

                  return {
                      type: displayType,
                      trackingNumber: i.trackingNumber,
                      shipmentType: i.shipmentType,
                      status: (i.shipmentType === 'fedex' && i.incomeType === 'no_entregado' && ['07', '08'].includes(i.nonDeliveryStatus ?? ''))
                          ? `DEX${i.nonDeliveryStatus}`
                          : i.incomeType,
                      date: hermDate.format('YYYY-MM-DD HH:mm:ss'),
                      cost: Number(i.cost) || 0,
                      statusHistory: i.shipment?.statusHistory || [],
                      commitDateTime: i.shipment?.commitDateTime
                  };
              });

              report.push({
                  date: dateKey,
                  fedex: {
                      pod: fedexDelivered,
                      dex07: fedexDex07,
                      dex08: fedexDex08,
                      total: fedexDelivered + fedexDex07 + fedexDex08,
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
                  total: dayIncomes.length,
                  totalIncome: formatCurrency(fedexTotalIncome + dhlTotalIncome + chargeTotalIncome + collectionTotalIncome),
                  items,
              });

              // Avanzar al siguiente día usando DayJS (más seguro que milisegundos)
              currentDate = currentDate.add(1, 'day');
          }

          return report;
      }

      // Agrega esto al final de tu archivo de servicio o en un helper
      private parseCurrency(val: string | number): number {
          if (typeof val === 'number') return val;
          if (!val) return 0;
          return parseFloat(val.toString().replace(/[$,]/g, '')) || 0;
      }

      async getIncomeWithComparison(subsidiaryId: string, fromDate: Date, toDate: Date) {
        // 1. Fechas actuales (Rango A)
        const currentStart = dayjs(fromDate).startOf('day').add(7, 'hour').toDate();
        const currentEnd = dayjs(toDate).endOf('day').add(7, 'hour').toDate();

        // 2. Fechas semana pasada (Rango B: Restamos exactamente 7 días)
        const lastWeekStart = dayjs(fromDate).subtract(7, 'day').startOf('day').add(7, 'hour').toDate();
        const lastWeekEnd = dayjs(toDate).subtract(7, 'day').endOf('day').add(7, 'hour').toDate();

        // Consultamos ambos rangos de un solo golpe
        const allIncomes = await this.incomeRepository.createQueryBuilder('income')
            .leftJoinAndSelect('income.shipment', 'shipment')
            .where('income.subsidiaryId = :subsidiaryId', { subsidiaryId })
            .andWhere('income.date BETWEEN :start AND :end', { 
                start: lastWeekStart, 
                end: currentEnd 
            })
            .getMany();

        // Separamos los datos para procesarlos
        const currentData = allIncomes.filter(i => i.date >= currentStart);
        const lastWeekData = allIncomes.filter(i => i.date >= lastWeekStart && i.date <= lastWeekEnd);

        const currentFormatted = await this.formatIncomesNew(currentData, fromDate, toDate);
        const lastWeekFormatted = await this.formatIncomesNew(lastWeekData, dayjs(fromDate).subtract(7, 'day').toDate(), dayjs(toDate).subtract(7, 'day').toDate());

        return {
            current: currentFormatted,
            lastWeekTotalIncome: lastWeekFormatted.reduce((acc, day) => acc + this.parseCurrency(day.totalIncome), 0)
        };
      }
    /****************************************************** */

    async formatIncomesNewUTC(
        incomes: Income[],
        utcFromDate: Date,
        utcToDate: Date
    ): Promise<FormatIncomesDto[]> {
        const report: FormatIncomesDto[] = [];
        const oneDayMs = 24 * 60 * 60 * 1000;

        // Filtrar ingresos para excluir nonDeliveryStatus = '03'
        const filteredIncomes = incomes.filter(i => {
            return !(i.sourceType === 'shipment' && 
                    i.shipmentType === 'fedex' && 
                    i.incomeType === 'no_entregado' && 
                    i.nonDeliveryStatus === '03');
        });

        // Agrupar por fecha UTC
        const grouped = filteredIncomes.reduce((acc, income) => {
            const date = typeof income.date === 'string' ? parseISO(income.date) : new Date(income.date);
            const dateKey = format(date, 'yyyy-MM-dd', { timeZone: 'UTC-7' });
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
            const fedexDex07 = fedexIncomes.filter(i => 
                i.incomeType === 'no_entregado' && 
                i.nonDeliveryStatus === '07'
            ).length;
            const fedexDex08 = fedexIncomes.filter(i => 
                i.incomeType === 'no_entregado' && 
                i.nonDeliveryStatus === '08'
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
                    status: i.shipmentType === 'fedex' && i.incomeType === 'no_entregado' && ['07', '08'].includes(i.nonDeliveryStatus ?? '')
                        ? `DEX${i.nonDeliveryStatus}`
                        : i.incomeType,
                    date: (typeof i.date === 'string' ? parseISO(i.date) : new Date(i.date)).toISOString(),
                    cost: i.cost || 0,
                    statusHistory: i.shipment?.statusHistory || [],
                    commitDateTime: i.shipment?.commitDateTime
                })),
                ...dayCollections.map(i => ({
                    type: 'collection' as const,
                    trackingNumber: i.trackingNumber,
                    date: (typeof i.date === 'string' ? parseISO(i.date) : new Date(i.date)).toISOString(),
                    cost: i.cost || 0,
                })),
                ...dayCharges.map(i => ({
                    type: 'carga' as const,
                    trackingNumber: i.trackingNumber,
                    shipmentType: i.shipmentType,
                    date: (typeof i.date === 'string' ? parseISO(i.date) : new Date(i.date)).toISOString(),
                    cost: i.cost || 0,
                }))
            ];

            report.push({
                date: dateKey,
                fedex: {
                    pod: fedexDelivered,
                    dex07: fedexDex07,
                    dex08: fedexDex08,
                    total: fedexDelivered + fedexDex07 + fedexDex08,
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
                total: fedexDelivered + fedexDex07 + fedexDex08 + dhlDelivered + dhlNotDelivered + dayCollections.length + dayCharges.length,
                totalIncome: formatCurrency(fedexTotalIncome + dhlTotalIncome + chargeTotalIncome + collectionTotalIncome),
                items,
            });

            currentDate = new Date(currentDate.getTime() + oneDayMs);
        }

        return report;
    }

    async formatIncomesNewResp(
        incomes: Income[],
        hermFromDate: Date,
        hermToDate: Date
    ): Promise<FormatIncomesDto[]> {
        const report: FormatIncomesDto[] = [];
        const oneDayMs = 24 * 60 * 60 * 1000;

        // 1. Filtrar ingresos para excluir nonDeliveryStatus = '03'
        const filteredIncomes = incomes.filter(i => {
            return !(i.sourceType === 'shipment' &&
                    i.shipmentType === 'fedex' &&
                    i.incomeType === 'no_entregado' &&
                    i.nonDeliveryStatus === '03');
        });

        // 2. Función para convertir UTC a fecha local de Hermosillo
        const toHermosilloDate = (date: Date | string) => {
            const utcDate = typeof date === 'string' ? parseISO(date) : new Date(date);
            // Ajuste manual para UTC-7 (America/Hermosillo sin horario de verano)
            return new Date(utcDate.getTime() - (7 * 60 * 60 * 1000));
        };

        // 3. Agrupar por fecha local (Hermosillo)
        const grouped = filteredIncomes.reduce((acc, income) => {
            const hermDate = toHermosilloDate(income.date);
            const dateKey = format(hermDate, 'yyyy-MM-dd');
            if (!acc[dateKey]) {
                acc[dateKey] = [];
            }
            acc[dateKey].push(income);
            return acc;
        }, {} as Record<string, Income[]>);

        // 4. Procesar exactamente el rango solicitado
        // Las fechas ya vienen en formato Hermosillo desde getIncome
        const startDate = startOfDay(hermFromDate);
        const endDate = endOfDay(hermToDate);

        let currentDate = new Date(startDate);

        while (currentDate <= endDate) {
            const dateKey = format(currentDate, 'yyyy-MM-dd');
            const dayIncomes = grouped[dateKey] || [];

            // Procesamiento por tipo de ingreso
            const dayShipments = dayIncomes.filter(i => i.sourceType === 'shipment');
            const dayCollections = dayIncomes.filter(i => i.sourceType === 'collection');
            const dayCharges = dayIncomes.filter(i => i.sourceType === 'charge');

            // Cálculos FedEx
            const fedexIncomes = dayShipments.filter(i => i.shipmentType === 'fedex');
            const fedexDelivered = fedexIncomes.filter(i => i.incomeType === 'entregado').length;
            const fedexDex07 = fedexIncomes.filter(i => 
                i.incomeType === 'no_entregado' && i.nonDeliveryStatus === '07'
            ).length;
            const fedexDex08 = fedexIncomes.filter(i => 
                i.incomeType === 'no_entregado' && i.nonDeliveryStatus === '08'
            ).length;
            const fedexTotalIncome = fedexIncomes.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

            // Cálculos DHL
            const dhlIncomes = dayShipments.filter(i => i.shipmentType === 'dhl');
            const dhlDelivered = dhlIncomes.filter(i => i.incomeType === 'entregado').length;
            const dhlNotDelivered = dhlIncomes.filter(i => i.incomeType === 'no_entregado').length;
            const dhlTotalIncome = dhlIncomes.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

            // Cálculos Collections y Charges (con tratamiento especial para charges)
            const collectionTotalIncome = dayCollections.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);
            
            // Para charges, usamos la fecha UTC original sin conversión
            const chargesForDay = filteredIncomes.filter(i => 
                i.sourceType === 'charge' && 
                format(new Date(i.date), 'yyyy-MM-dd') === format(currentDate, 'yyyy-MM-dd')
            );
            const chargeTotalIncome = chargesForDay.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

            // Items detallados
            const items = [
                ...dayShipments.map(i => {
                    const hermDate = toHermosilloDate(i.date);
                    return {
                        type: 'shipment' as const,
                        trackingNumber: i.trackingNumber,
                        shipmentType: i.shipmentType,
                        status: i.shipmentType === 'fedex' && i.incomeType === 'no_entregado' && ['07', '08'].includes(i.nonDeliveryStatus ?? '')
                            ? `DEX${i.nonDeliveryStatus}`
                            : i.incomeType,
                        date: format(hermDate, 'yyyy-MM-dd HH:mm:ss'),
                        cost: Number(i.cost) || 0,
                        statusHistory: i.shipment?.statusHistory || [],
                        commitDateTime: i.shipment?.commitDateTime
                    };
                }),
                ...dayCollections.map(i => {
                    const hermDate = toHermosilloDate(i.date);
                    return {
                        type: 'collection' as const,
                        trackingNumber: i.trackingNumber,
                        date: format(hermDate, 'yyyy-MM-dd HH:mm:ss'),
                        cost: Number(i.cost) || 0,
                    };
                }),
                ...chargesForDay.map(i => ({
                    type: 'carga' as const,
                    trackingNumber: i.trackingNumber,
                    shipmentType: i.shipmentType,
                    date: format(new Date(i.date), 'yyyy-MM-dd HH:mm:ss'), // Mantener fecha UTC para cargas
                    cost: Number(i.cost) || 0,
                }))
            ];

            // Agregar al reporte
            report.push({
                date: dateKey,
                fedex: {
                    pod: fedexDelivered,
                    dex07: fedexDex07,
                    dex08: fedexDex08,
                    total: fedexDelivered + fedexDex07 + fedexDex08,
                    totalIncome: formatCurrency(fedexTotalIncome),
                },
                dhl: {
                    ba: dhlDelivered,
                    ne: dhlNotDelivered,
                    total: dhlDelivered + dhlNotDelivered,
                    totalIncome: formatCurrency(dhlTotalIncome),
                },
                collections: dayCollections.length,
                cargas: chargesForDay.length, // Usar el conteo especial para cargas
                total: fedexDelivered + fedexDex07 + fedexDex08 + dhlDelivered + dhlNotDelivered + dayCollections.length + chargesForDay.length,
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
