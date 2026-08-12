import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Expense, Income, Shipment, Subsidiary } from 'src/entities';
import { formatCurrency } from 'src/utils/format.util';
import { CountableOptions, isCountableIncome } from 'src/common/income-rules.util';
import { ChargeRulesService } from 'src/charge-rules/charge-rules.service';
import { toHermosilloDateString } from 'src/common/utils';
import { Between, Repository } from 'typeorm';
import { Collection } from 'src/entities/collection.entity';
import { FormatIncomesDto } from './dto/format-incomes.dto';
import { DailyExpenses } from './dto/daily-expenses.dto';
import { format } from 'date-fns-tz';
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
    private incomeRepository: Repository<Income>,
    private readonly chargeRules: ChargeRulesService,
  ){}

    /**
     * Contexto de conteo de la sucursal: si los traslados cuentan (flag de sucursal)
     * + el resolvedor de cobro por estatus (charge_rule: global + override de sucursal).
     */
    private async getCountContext(subsidiaryId: string): Promise<CountableOptions> {
        const [sub, resolver] = await Promise.all([
          this.incomeRepository.manager.getRepository(Subsidiary).findOne({
            where: { id: subsidiaryId },
            select: ['countTransfersAsIncome'],
          }),
          this.chargeRules.buildResolver(subsidiaryId),
        ]);
        return { countTransfers: sub?.countTransfersAsIncome ?? true, resolver };
    }

    private async getTotalShipmentsIncome(subsidiaryId: string, fromDate: Date, toDate: Date){
        // Traemos TODOS los ingresos del rango (incluye traslados) y aplicamos la
        // REGLA ÚNICA por sucursal — así el dashboard cuadra con la tabla y los KPIs.
        const [incomes, ctx] = await Promise.all([
          this.incomeRepository.find({
            where: {
              subsidiary: { id: subsidiaryId },
              date: Between(fromDate, toDate),
            },
            relations: ['subsidiary'],
          }),
          this.getCountContext(subsidiaryId),
        ]);

        const billable = incomes.filter((i) => isCountableIncome(i, ctx));

        const totalShipmentIncome = billable.reduce(
          (acc, income) => acc + parseFloat(income.cost.toString()),
          0
        );

        return {
          totalIncome: totalShipmentIncome,
          incomes: billable,
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
      // 1) Traer todos los gastos en el rango (expense.date es DATE => comparamos por día)
      const startDay = toHermosilloDateString(fromDate.toISOString());
      const endDay = toHermosilloDateString(toDate.toISOString());
      const expenses = await this.expenseRepository.find({
        where: {
          subsidiary: { id: subsidiaryId },
          date: Between(startDay, endDay),
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

      // 3) Agrupar por día — g.date YA es 'YYYY-MM-DD'
      const grouped: Record<string, Expense[]> = {};
      expenses.forEach((g) => {
        const dayKey = g.date; // string 'YYYY-MM-DD'
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

      const ctx = await this.getCountContext(subsidiaryId);
      const formattedIncome = await this.formatIncomesNew(incomes, startDay, adjustedToDate, ctx);
      const { totalExpenses, daily } = await this.getTotalExpenses(subsidiaryId, startDay, endDay)
      const balance = income.totalIncome - totalExpenses;

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

        // 4. Formatear con las reglas de ingreso de la sucursal (regla única).
        const ctx = await this.getCountContext(subsidiaryId);
        const currentFormatted = await this.formatIncomesNew(currentIncomes, fromDate, toDate, ctx);

        const lastWeekFrom = dayjs(fromDate).subtract(7, 'day').toDate();
        const lastWeekTo = dayjs(toDate).subtract(7, 'day').toDate();
        const lastWeekFormatted = await this.formatIncomesNew(lastWeekIncomes, lastWeekFrom, lastWeekTo, ctx);

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
          hermToDate: Date,
          ctx: CountableOptions = {},
      ): Promise<FormatIncomesDto[]> {
          const report: FormatIncomesDto[] = [];

          // 2. Función estandarizada para convertir UTC a fecha local de Hermosillo (UTC-7)
          const toHermosilloDate = (date: Date | string) => {
              // Usamos dayjs para restar las 7 horas de diferencia de forma segura
              return dayjs(date).subtract(7, 'hour');
          };

          // 3. Agrupar TODOS los ingresos por fecha local (incluye traslados; el
          //    conteo de "qué cuenta" lo decide isCountableIncome con las reglas
          //    de la sucursal — DEX03 fuera por default, etc.).
          const grouped = incomes.reduce((acc, income) => {
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

              // Suma SOLO lo que cuenta según las reglas de la sucursal.
              const sumCountable = (arr: Income[]) =>
                  arr.filter(i => isCountableIncome(i, ctx)).reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

              // Traslados del día (tyco/aeropuerto/especial).
              const dayTransfers = dayIncomes.filter(i =>
                  ['tyco', 'aeropuerto', 'special_transfer'].includes(String(i.sourceType)));

              // Métricas FedEx (los conteos pod/dex son informativos; el dinero ya filtrado)
              const fedexIncomes = dayShipments.filter(i => i.shipmentType === 'fedex');
              const fedexDelivered = fedexIncomes.filter(i => i.incomeType === 'entregado').length;
              const fedexDex07 = fedexIncomes.filter(i =>
                  i.incomeType === 'no_entregado' && i.nonDeliveryStatus === '07'
              ).length;
              const fedexDex08 = fedexIncomes.filter(i =>
                  i.incomeType === 'no_entregado' && i.nonDeliveryStatus === '08'
              ).length;
              const fedexTotalIncome = sumCountable(fedexIncomes);

              // Métricas DHL
              const dhlIncomes = dayShipments.filter(i => i.shipmentType === 'dhl');
              const dhlDelivered = dhlIncomes.filter(i => i.incomeType === 'entregado').length;
              const dhlNotDelivered = dhlIncomes.filter(i => i.incomeType === 'no_entregado').length;
              const dhlTotalIncome = sumCountable(dhlIncomes);

              // Otros (Collections, Cargas y Traslados)
              const collectionTotalIncome = sumCountable(dayCollections);
              const chargeTotalIncome = sumCountable(dayCharges);
              const transferTotalIncome = sumCountable(dayTransfers);

              // Construcción de items detallados
              const items = dayIncomes.map(i => {
                  const hermDate = toHermosilloDate(i.date);
                  
                  // Mapeo dinámico del tipo para el frontend
                  let displayType: 'shipment' | 'collection' | 'carga' | 'traslado' = 'shipment';
                  if (i.sourceType === 'collection') displayType = 'collection';
                  if (i.sourceType === 'charge') displayType = 'carga';
                  if (['tyco', 'aeropuerto', 'special_transfer'].includes(String(i.sourceType))) displayType = 'traslado';

                  // Estatus mostrado en el detalle. Una recolección se cobra COMO
                  // recolección, no como "entregado": el ingreso de collection se crea
                  // con incomeType=entregado por compatibilidad, pero aquí debe verse
                  // según su origen para que no se confunda con entregas FedEx.
                  let displayStatus: string;
                  if (i.sourceType === 'collection') {
                      displayStatus = 'recoleccion';
                  } else if (i.sourceType === 'charge') {
                      displayStatus = 'carga';
                  } else if (i.shipmentType === 'fedex' && i.incomeType === 'no_entregado' && ['07', '08'].includes(i.nonDeliveryStatus ?? '')) {
                      displayStatus = `DEX${i.nonDeliveryStatus}`;
                  } else {
                      displayStatus = i.incomeType;
                  }

                  return {
                      type: displayType,
                      trackingNumber: i.trackingNumber,
                      shipmentType: i.shipmentType,
                      status: displayStatus,
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
                  // Traslados (tyco/aeropuerto/especial): bucket propio para desglose en
                  // la tabla. `total` es el conteo de operaciones; `totalIncome` es SOLO
                  // lo facturable (según countTransfers de la sucursal) y ya está incluido
                  // en el `totalIncome` del día (transferTotalIncome más abajo).
                  transfers: {
                      tyco: dayTransfers.filter(i => i.sourceType === 'tyco').length,
                      aeropuerto: dayTransfers.filter(i => i.sourceType === 'aeropuerto').length,
                      especial: dayTransfers.filter(i => i.sourceType === 'special_transfer').length,
                      total: dayTransfers.length,
                      totalIncome: formatCurrency(transferTotalIncome),
                  },
                  collections: dayCollections.length,
                  cargas: dayCharges.length,
                  total: dayIncomes.length,
                  totalIncome: formatCurrency(fedexTotalIncome + dhlTotalIncome + chargeTotalIncome + collectionTotalIncome + transferTotalIncome),
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

}
