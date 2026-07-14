import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { CreateConsolidatedDto } from './dto/create-consolidated.dto';
import { UpdateConsolidatedDto } from './dto/update-consolidated.dto';
import { In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { ChargeShipment, Consolidated, Shipment, ShipmentStatus } from 'src/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { ShipmentConsolidatedDto } from './dto/shipment.dto';
import { ConsolidatedDto } from './dto/consolidated.dto';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { ShipmentStatusType, TERMINAL_SHIPMENT_STATUSES } from 'src/common/enums/shipment-status-type.enum';

@Injectable()
export class ConsolidatedService {
  private readonly logger = new Logger(ConsolidatedService.name);

  constructor(
    @InjectRepository(Consolidated)
    private readonly consolidatedRepository: Repository<Consolidated>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    @InjectRepository(ChargeShipment)
    private readonly chargeShipmentRepository: Repository<ChargeShipment>,
    @Inject(forwardRef(() => ShipmentsService))
    private readonly shipmentService: ShipmentsService,
    @InjectRepository(ShipmentStatus)
    private readonly shipmentStatusRepository: Repository<ShipmentStatus>
  ){}

  async create(createConsolidatedDto: CreateConsolidatedDto, userId?: string) {
    const newConsolidated = await this.consolidatedRepository.create({
      ...createConsolidatedDto,
      createdById: userId ?? null,
    } as any);
    return await this.consolidatedRepository.save(newConsolidated);
  }

  private calculateDaysDifference(startDate: Date, endDate: Date): number {
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  async findBySubsidiaryResp(subdiaryId: string): Promise<{
    id: string, 
    type: string, 
    date: Date,
    consNumber: string,
    numberOfPackages: number,
    subsidiary: {
      id: string,
      name: string
    }
  }[]> {
    const result = await this.consolidatedRepository.find({
      select: {
        id: true,
        type: true,
        date: true,
        consNumber: true,
        numberOfPackages: true,
        subsidiary: {
          id: true,
          name: true,
        }
      },
      where: {
        subsidiary: {
          id: subdiaryId
        }
      },
      relations: [
        'subsidiary'
      ], order: {
        date: 'DESC'
      }
    });

    return result;
  }

  /**** Nuevo para solo obtener 5 días atras */
  async findBySubsidiary(subsidiaryId: string): Promise<{
    id: string, 
    type: string, 
    date: Date,
    consNumber: string,
    numberOfPackages: number,
    subsidiary: {
      id: string,
      name: string
    }
  }[]> {
    // Calcular la fecha límite (5 días antes de hoy)
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 15);
    // Opcional: establecer a medianoche para incluir todo el día
    fiveDaysAgo.setHours(0, 0, 0, 0);
    
    const result = await this.consolidatedRepository.find({
      select: {
        id: true,
        type: true,
        date: true,
        consNumber: true,
        numberOfPackages: true,
        subsidiary: {
          id: true,
          name: true,
        },
        carrier: true
      },
      where: {
        subsidiary: {
          id: subsidiaryId
        },
        date: MoreThanOrEqual(fiveDaysAgo)
      },
      relations: [
        'subsidiary'
      ], 
      order: {
        date: 'DESC'
      }
    });

    return result;
  }

  async findAllResp(
    subsidiaryId?: string,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<ConsolidatedDto[]> {
    let utcFromDate: Date | undefined;
    let utcToDate: Date | undefined;

    if (fromDate && toDate) {
      utcFromDate = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate(), 0, 0, 0));
      utcToDate = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate(), 23, 59, 59));
    }

    const consolidatedQB = this.consolidatedRepository
      .createQueryBuilder('c')
      .leftJoin('c.subsidiary', 's')
      .select([
        'c.id AS id',
        'c.date AS date',
        'c.numberOfPackages AS numberOfPackages',
        'c.consNumber AS consNumber',
        'c.carrier AS carrier',
        'c.type AS type',
        's.id AS subsidiary_id',
        's.name AS subsidiary_name',
      ])
      .orderBy('c.date', 'DESC');

    if (subsidiaryId) consolidatedQB.andWhere('c.subsidiaryId = :subsidiaryId', { subsidiaryId });

    if (utcFromDate && utcToDate) {
      consolidatedQB.andWhere('c.date BETWEEN :fromDate AND :toDate', { fromDate: utcFromDate, toDate: utcToDate });
    }

    const consolidated = await consolidatedQB.getRawMany();

    if (!consolidated.length) return [];

    const consolidatedIds = consolidated.map(c => c.id);

    // Helper robusto para evitar colapsos a NaN o NULL
    const getNum = (val: any): number => {
      if (val === null || val === undefined || isNaN(Number(val))) return 0;
      return parseInt(val, 10);
    };

    /* Agregados SHIPMENT (LOWER case y coincidencias múltiples para evitar errores de tipeo manual) */
    const shipmentAgg = await this.consolidatedRepository.manager
      .createQueryBuilder()
      .select('s.consolidatedId', 'consolidatedId')
      .addSelect('COUNT(s.id)', 'total') 
      .addSelect(`SUM(CASE WHEN LOWER(s.status) IN ('entregado', 'entregada', 'pod') THEN 1 ELSE 0 END)`, 'entregado')
      .addSelect(`SUM(CASE WHEN LOWER(s.status) IN ('devuelto_a_fedex', 'devuelto a fedex', 'devuelto_fedex', 'devuelto') THEN 1 ELSE 0 END)`, 'devuelto_fedex')
      .addSelect(`SUM(CASE WHEN LOWER(s.status) IN ('retorno_abandono_fedex', 'retorno abandono', 'retorno_abandono', 'abandono') THEN 1 ELSE 0 END)`, 'retorno_abandono')
      .addSelect(`SUM(CASE WHEN LOWER(s.status) IN ('en_ruta', 'en ruta', 'en-ruta', 'ruta') THEN 1 ELSE 0 END)`, 'en_ruta')
      .addSelect(`SUM(CASE WHEN LOWER(s.status) IN ('en_bodega', 'en bodega', 'bodega') THEN 1 ELSE 0 END)`, 'en_bodega')
      .addSelect(`SUM(CASE WHEN LOWER(s.status) IN ('direccion_incorrecta', 'dex03', 'dex 03') THEN 1 ELSE 0 END)`, 'dex03')
      .addSelect(`SUM(CASE WHEN LOWER(s.status) IN ('rechazado', 'dex07', 'dex 07') THEN 1 ELSE 0 END)`, 'dex07')
      .addSelect(`SUM(CASE WHEN LOWER(s.status) IN ('cliente_no_disponible', 'dex08', 'dex 08') THEN 1 ELSE 0 END)`, 'dex08')
      .addSelect(`SUM(CASE WHEN LOWER(s.status) IN ('pendiente', 'creado', 'nuevo', 'sin_estado') THEN 1 ELSE 0 END)`, 'pendiente_directo')
      .from('shipment', 's')
      .where('s.consolidatedId IN (:...ids)', { ids: consolidatedIds })
      .andWhere('s.status != "cancelado"')
      .groupBy('s.consolidatedId')
      .getRawMany();

    /* Agregados CHARGE_SHIPMENT */
    const chargeAgg = await this.consolidatedRepository.manager
      .createQueryBuilder()
      .select('cs.consolidatedId', 'consolidatedId')
      .addSelect('COUNT(cs.id)', 'total')
      .addSelect(`SUM(CASE WHEN LOWER(cs.status) IN ('entregado', 'entregada', 'pod') THEN 1 ELSE 0 END)`, 'entregado')
      .addSelect(`SUM(CASE WHEN LOWER(cs.status) IN ('devuelto_a_fedex', 'devuelto a fedex', 'devuelto_fedex', 'devuelto') THEN 1 ELSE 0 END)`, 'devuelto_fedex')
      .addSelect(`SUM(CASE WHEN LOWER(cs.status) IN ('retorno_abandono_fedex', 'retorno abandono', 'retorno_abandono', 'abandono') THEN 1 ELSE 0 END)`, 'retorno_abandono')
      .addSelect(`SUM(CASE WHEN LOWER(cs.status) IN ('en_ruta', 'en ruta', 'en-ruta', 'ruta') THEN 1 ELSE 0 END)`, 'en_ruta')
      .addSelect(`SUM(CASE WHEN LOWER(cs.status) IN ('en_bodega', 'en bodega', 'bodega') THEN 1 ELSE 0 END)`, 'en_bodega')
      .addSelect(`SUM(CASE WHEN LOWER(cs.status) IN ('direccion_incorrecta', 'dex03', 'dex 03') THEN 1 ELSE 0 END)`, 'dex03')
      .addSelect(`SUM(CASE WHEN LOWER(cs.status) IN ('rechazado', 'dex07', 'dex 07') THEN 1 ELSE 0 END)`, 'dex07')
      .addSelect(`SUM(CASE WHEN LOWER(cs.status) IN ('cliente_no_disponible', 'dex08', 'dex 08') THEN 1 ELSE 0 END)`, 'dex08')
      .addSelect(`SUM(CASE WHEN LOWER(cs.status) IN ('pendiente', 'creado', 'nuevo', 'sin_estado') THEN 1 ELSE 0 END)`, 'pendiente_directo')
      .from('charge_shipment', 'cs')
      .where('cs.consolidatedId IN (:...ids)', { ids: consolidatedIds })
      .andWhere('cs.status != "cancelado"')
      .groupBy('cs.consolidatedId')
      .getRawMany();

    const shipmentMap = new Map(shipmentAgg.map(r => [r.consolidatedId, r]));
    const chargeMap = new Map(chargeAgg.map(r => [r.consolidatedId, r]));

    return consolidated.map(row => {
      const ship = shipmentMap.get(row.id) || {};
      const charge = chargeMap.get(row.id) || {};

      const n = getNum(ship.total);
      const f2 = getNum(charge.total);
      const total = n + f2;

      const entregado = getNum(ship.entregado) + getNum(charge.entregado);
      const devueltos = getNum(ship.devuelto_fedex) + getNum(charge.devuelto_fedex) + getNum(ship.retorno_abandono) + getNum(charge.retorno_abandono);
      const en_ruta = getNum(ship.en_ruta) + getNum(charge.en_ruta);
      const en_bodega = getNum(ship.en_bodega) + getNum(charge.en_bodega);
      const dex03 = getNum(ship.dex03) + getNum(charge.dex03);
      const dex07 = getNum(ship.dex07) + getNum(charge.dex07);
      const dex08 = getNum(ship.dex08) + getNum(charge.dex08);
      
      const totalDex = dex03 + dex07 + dex08;
      
      // Matemática Perfecta de Cuadre
      let pendiente = total - (entregado + totalDex + devueltos + en_ruta + en_bodega);
      const pendienteDirecto = getNum(ship.pendiente_directo) + getNum(charge.pendiente_directo);
      
      if (pendiente < pendienteDirecto) pendiente = pendienteDirecto;
      if (pendiente < 0) pendiente = 0;

      return {
        id: row.id,
        date: row.date,
        consolidatedDate: row.date,
        numberOfPackages: row.numberOfPackages,
        consNumber: row.consNumber,
        carrier: row.carrier,
        type: row.type,
        subsidiary: { id: row.subsidiary_id, name: row.subsidiary_name },
        isConsolidatedComplete: total > 0 && en_ruta === 0 && en_bodega === 0 && pendiente === 0,
        shipmentCounts: {
          total,
          countNormal: n,
          countF2: f2,
          entregado,
          totalDex,
          totalDevueltos: devueltos,
          pendiente, 
          en_ruta,
          en_bodega,
          dex03,
          dex07,
          dex08,
          other: 0,
          porcEfectividad: total > 0 ? parseFloat(((entregado / total) * 100).toFixed(2)) : 0,
          porcEfectividadEntrega: (entregado + totalDex) > 0 ? parseFloat(((entregado / (entregado + totalDex)) * 100).toFixed(2)) : 0,
          porcRendimientoIntentos: total > 0 ? parseFloat((((entregado + totalDex + devueltos) / total) * 100).toFixed(2)) : 0,
        },
        shipments: [],
      } as ConsolidatedDto;
    });
  }

  async findAll(
  subsidiaryId?: string,
  fromDate?: Date,
  toDate?: Date,
): Promise<ConsolidatedDto[]> {
  let utcFromDate: Date | undefined;
  let utcToDate: Date | undefined;

  if (fromDate && toDate) {
    utcFromDate = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate(), 0, 0, 0));
    utcToDate = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate(), 23, 59, 59));
  }

  const consolidatedQB = this.consolidatedRepository
    .createQueryBuilder('c')
    .leftJoin('c.subsidiary', 's')
    .select([
      'c.id AS id', 'c.date AS date', 'c.numberOfPackages AS numberOfPackages',
      'c.consNumber AS consNumber', 'c.carrier AS carrier', 'c.type AS type',
      's.id AS subsidiary_id', 's.name AS subsidiary_name',
    ])
    .orderBy('c.date', 'DESC');

  if (subsidiaryId) consolidatedQB.andWhere('c.subsidiaryId = :subsidiaryId', { subsidiaryId });
  if (utcFromDate && utcToDate) {
    consolidatedQB.andWhere('c.date BETWEEN :fromDate AND :toDate', { fromDate: utcFromDate, toDate: utcToDate });
  }

  const consolidated = await consolidatedQB.getRawMany();
  if (!consolidated.length) return [];

  const consolidatedIds = consolidated.map(c => c.id);
  const getNum = (val: any): number => (val === null || val === undefined || isNaN(Number(val))) ? 0 : parseInt(val, 10);

  const getAgg = (tableName: string) => this.consolidatedRepository.manager.createQueryBuilder()
    .select('consolidatedId', 'consolidatedId')
    .addSelect('COUNT(id)', 'total')
    .addSelect(`SUM(CASE WHEN LOWER(status) IN ('entregado', 'entregada', 'pod') THEN 1 ELSE 0 END)`, 'entregado')
    .addSelect(`SUM(CASE WHEN LOWER(status) IN ('devuelto_a_fedex', 'devuelto') THEN 1 ELSE 0 END)`, 'devuelto_fedex')
    .addSelect(`SUM(CASE WHEN LOWER(status) IN ('retorno_abandono_fedex', 'retorno_abandono', 'abandono') THEN 1 ELSE 0 END)`, 'retorno_abandono')
    .addSelect(`SUM(CASE WHEN LOWER(status) IN ('en_ruta', 'en ruta', 'ruta') THEN 1 ELSE 0 END)`, 'en_ruta')
    .addSelect(`SUM(CASE WHEN LOWER(status) IN ('en_bodega', 'en bodega', 'bodega') THEN 1 ELSE 0 END)`, 'en_bodega')
    .addSelect(`SUM(CASE WHEN LOWER(status) IN ('dex03', 'direccion_incorrecta') THEN 1 ELSE 0 END)`, 'dex03')
    .addSelect(`SUM(CASE WHEN LOWER(status) IN ('dex07', 'rechazado') THEN 1 ELSE 0 END)`, 'dex07')
    .addSelect(`SUM(CASE WHEN LOWER(status) IN ('dex08', 'cliente_no_disponible') THEN 1 ELSE 0 END)`, 'dex08')
    .addSelect(`SUM(CASE WHEN LOWER(status) IN ('pendiente', 'creado', 'nuevo', 'sin_estado') THEN 1 ELSE 0 END)`, 'pendiente_directo')
    .from(tableName, 't')
    .where('consolidatedId IN (:...ids)', { ids: consolidatedIds })
    .andWhere('status != :cancel', { cancel: 'cancelado' })
    .groupBy('consolidatedId')
    .getRawMany();

  const shipmentAgg = await getAgg('shipment');
  const chargeAgg = await getAgg('charge_shipment');
  const shipmentMap = new Map(shipmentAgg.map(r => [r.consolidatedId, r]));
  const chargeMap = new Map(chargeAgg.map(r => [r.consolidatedId, r]));

  const pendingStatuses = ['entregado', 'devuelto_a_fedex', 'cancelado', 'rechazado', 'cliente_no_disponible', 'direccion_incorrecta', 'en_bodega'];
  
  // Pendientes unificados sin intentar buscar 'carrier' en detalle
  const pendingShipments = await this.consolidatedRepository.manager.createQueryBuilder()
    .select('consolidatedId', 'consolidatedId')
    .addSelect('trackingNumber', 'tracking')
    .addSelect('status', 'status')
    .from('shipment', 's')
    .where('consolidatedId IN (:...ids)', { ids: consolidatedIds })
    .andWhere('status NOT IN (:...pendingStatuses)', { pendingStatuses })
    .getRawMany();
    
  const pendingCharges = await this.consolidatedRepository.manager.createQueryBuilder()
    .select('consolidatedId', 'consolidatedId')
    .addSelect('trackingNumber', 'tracking')
    .addSelect('status', 'status')
    .from('charge_shipment', 'cs')
    .where('consolidatedId IN (:...ids)', { ids: consolidatedIds })
    .andWhere('status NOT IN (:...pendingStatuses)', { pendingStatuses })
    .getRawMany();

  const allPending = [...pendingShipments, ...pendingCharges];

  return consolidated.map(row => {
    const ship = shipmentMap.get(row.id) || {};
    const charge = chargeMap.get(row.id) || {};

    const n = getNum(ship.total);
    const f2 = getNum(charge.total);
    const total = n + f2;
    const entregado = getNum(ship.entregado) + getNum(charge.entregado);
    const devueltos = getNum(ship.devuelto_fedex) + getNum(charge.devuelto_fedex) + getNum(ship.retorno_abandono) + getNum(charge.retorno_abandono);
    const en_ruta = getNum(ship.en_ruta) + getNum(charge.en_ruta);
    const en_bodega = getNum(ship.en_bodega) + getNum(charge.en_bodega);
    const dex03 = getNum(ship.dex03) + getNum(charge.dex03);
    const dex07 = getNum(ship.dex07) + getNum(charge.dex07);
    const dex08 = getNum(ship.dex08) + getNum(charge.dex08);
    const totalDex = dex03 + dex07 + dex08;

    let pendiente = total - (entregado + totalDex + devueltos + en_ruta + en_bodega);
    const pendienteDirecto = getNum(ship.pendiente_directo) + getNum(charge.pendiente_directo);
    if (pendiente < pendienteDirecto) pendiente = pendienteDirecto;
    if (pendiente < 0) pendiente = 0;

    return {
      id: row.id,
      date: row.date,
      consolidatedDate: row.date,
      numberOfPackages: row.numberOfPackages,
      consNumber: row.consNumber,
      carrier: row.carrier,
      type: row.type,
      subsidiary: { id: row.subsidiary_id, name: row.subsidiary_name },
      isConsolidatedComplete: total > 0 && en_ruta === 0 && en_bodega === 0 && pendiente === 0,
      shipmentCounts: {
        total, countNormal: n, countF2: f2, entregado, totalDex, totalDevueltos: devueltos,
        pendiente, en_ruta, en_bodega, dex03, dex07, dex08, other: 0,
        porcEfectividad: total > 0 ? parseFloat(((entregado / total) * 100).toFixed(2)) : 0,
        porcEfectividadEntrega: (entregado + totalDex) > 0 ? parseFloat(((entregado / (entregado + totalDex)) * 100).toFixed(2)) : 0,
        porcRendimientoIntentos: total > 0 ? parseFloat((((entregado + totalDex + devueltos) / total) * 100).toFixed(2)) : 0,
      },
      shipments: [],
      pendingShipments: allPending.filter(p => p.consolidatedId === row.id)
    } as ConsolidatedDto;
  });
}

  async findByConsNumber(consNumber: string): Promise<Consolidated | null> {
    return await this.consolidatedRepository.findOne({
      where: { consNumber }
    });
  }

  /**
   * Búsqueda de consolidado NORMALIZADA (trim + mayúsculas, sin espacios dobles)
   * y con ALCANCE por sucursal + carrier. Evita falsos positivos entre sucursales
   * y captura duplicados con variaciones de espacios/mayúsculas.
   */
  async findByConsNumberScoped(consNumber: string, subsidiaryId?: string, carrier?: string): Promise<Consolidated | null> {
    const norm = (consNumber || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!norm) return null;
    const qb = this.consolidatedRepository.createQueryBuilder('c')
      .leftJoinAndSelect('c.subsidiary', 'sub')
      .where('TRIM(UPPER(c.consNumber)) = :norm', { norm });
    if (subsidiaryId) qb.andWhere('sub.id = :subsidiaryId', { subsidiaryId });
    if (carrier) qb.andWhere('c.carrier = :carrier', { carrier });
    return qb.getOne();
  }

  async getShipmentsByConsolidatedId(consolidatedId): Promise<ShipmentConsolidatedDto[]> { // Cambiamos el tipo de retorno a solo shipments
      // 1. Validación - consolidatedId es requerido
      if (!consolidatedId) {
        throw new Error('El consolidatedId es requerido');
      }

      // 2. Buscar el consolidado específico (solo para obtener la fecha)
      const consolidate = await this.consolidatedRepository.findOne({
        select: {
          id: true,
          date: true,
        },
        where: { id: consolidatedId },
      });

      if (!consolidate) {
        console.warn(`No se encontró el consolidado con ID: ${consolidatedId}`);
        return [];
      }

      // 3. Consulta de shipments solo para el consolidatedId específico
      const shipments = await this.shipmentRepository.find({
        select: {
          id: true,
          trackingNumber: true,
          recipientName: true,
          commitDateTime: true,
          consolidatedId: true,
          status: true,
          statusHistory: {
            status: true,
            exceptionCode: true,
            timestamp: true
          },
          subsidiary: {
            id: true,
            name: true
          }
        },
        where: { 
          consolidatedId: consolidatedId // Solo shipments de este consolidado
        },
        relations: ['subsidiary', 'statusHistory'],
        order: { commitDateTime: 'DESC' },
      });

      // 4. Procesar los shipments (manteniendo toda la lógica original)
      return shipments.map(shipment => {
        // Ordenar historial de estados por fecha
        if (shipment.statusHistory?.length > 0) {
          shipment.statusHistory.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        }

        // Calcular días en ruta si está en estado 'en_ruta'
        const daysInRoute = shipment.status === 'en_ruta'
          ? this.calculateDaysDifference(new Date(consolidate.date), new Date())
          : 0;

        return {
          ...shipment,
          daysInRoute,
        } as ShipmentConsolidatedDto;
      });
  }

  async findOne(id: string) {
    return await this.consolidatedRepository.findOneBy({id});
  }

  async update(id: string, updateConsolidatedDto: UpdateConsolidatedDto) {
    return await this.consolidatedRepository.update(id, updateConsolidatedDto);
  }

  async remove(id: string) {
    return await this.consolidatedRepository.delete(id);
  }

  async lastConsolidatedBySucursal(subsidiaryId: string) {
    console.log("🚀 ~ ConsolidatedService ~ lastConsolidatedBySucursal ~ subsidiaryId:", subsidiaryId)
    const todayUTC = new Date('2025-08-11');
    todayUTC.setUTCHours(0, 0, 0, 0);
    console.log("🚀 ~ ConsolidatedService ~ lastConsolidatedBySucursal ~ todayUTC:", todayUTC)

    const tomorrowUTC = new Date(todayUTC);
    tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);
    console.log("🚀 ~ ConsolidatedService ~ lastConsolidatedBySucursal ~ tomorrowUTC:", tomorrowUTC)

    const consolidated = await this.consolidatedRepository
      .createQueryBuilder('consolidated')
      .leftJoinAndSelect('consolidated.subsidiary', 'subsidiary')
      .where('subsidiary.id = :subsidiaryId', { subsidiaryId })
      .andWhere('consolidated.type IN (:...types)', { types: ['ordinario', 'aereo'] })
      .getMany();

    console.log("🚀 ~ ConsolidatedService ~ lastConsolidatedBySucursal ~ consolidated:", consolidated);

    return consolidated;
  }

  async findShipmentsByConsolidatedId(id: string) {
    console.log("🔍 Buscando consolidated con id:", id);

    let consolidated = await this.consolidatedRepository.findOne({
      where: { id },
      select: ['id', 'consNumber', 'createdAt'],
    });

    console.log("🟢 consolidated:", consolidated);

    if (!consolidated) return [];

    console.log("🔹 consNumber del consolidated:", consolidated.consNumber);

    const shipments = await this.shipmentRepository.find({
      where: { consolidatedId: consolidated.id },
      relations: [
        'packageDispatch',
        'packageDispatch.vehicle',
        'packageDispatch.subsidiary',
        'packageDispatch.drivers',
        'packageDispatch.routes',
        'subsidiary',
        'payment',
        'unloading',
      ],
    });
    console.log("📦 Shipments encontrados:", shipments.length);

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { consolidatedId: consolidated.id },
      relations: [
        'packageDispatch',
        'packageDispatch.vehicle',
        'packageDispatch.subsidiary',
        'packageDispatch.drivers',
        'packageDispatch.routes',
        'payment',
        'subsidiary',
        'unloading',
      ],
    });
    console.log("⚡ ChargeShipments encontrados:", chargeShipments.length);

    if (shipments.length === 0 && chargeShipments.length === 0) {
      console.warn("⚠️ No se encontraron shipments ni chargeShipments con ese consNumber");
      return [];
    }

    // ========= 🔥 Helper: calcular días en bodega =========
    const calcDaysInWarehouse = (createdAt: Date, status: string) => {
      //if (status !== 'entre') return "N/A";
      const today = new Date();
      const created = new Date(createdAt);
      const diff = Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      return diff;
    };

    // ========= 🔥 Helper: obtener dexCode =========
    const getDexCode = async (shipmentId: string, status: string) => {
      const rejectedStatuses = [
        'rechazado',
        'no_entregado',
        'direccion_incorrecta',
        'cliente_no_encontrado',
        'cambio_fecha_solicitado'
      ];

      if (!rejectedStatuses.includes(status)) {
        return null;
      }

      const row = await this.shipmentStatusRepository
        .createQueryBuilder('ss')
        .select('ss.exceptionCode', 'exceptionCode')
        .where('ss.shipmentId = :shipmentId', { shipmentId })
        .orderBy('ss.createdAt', 'DESC')
        .limit(1)
        .getRawOne();

      return row?.exceptionCode ?? null;
    };

    // ========= 🔥 MAPEO FINAL CORREGIDO =========
    const mapShipment = async (shipment: any, isCharge: boolean) => {
      const dispatch = shipment.packageDispatch;
      const driverName = dispatch?.drivers?.length ? dispatch.drivers[0].name : null;
      const route = dispatch?.routes?.length
        ? dispatch.routes.map(r => r.name).join(' - ')
        : null;

      console.log("🚀 ~ ConsolidatedService ~ mapShipment ~ route:", route)
      
      const ubication = dispatch ? 'EN RUTA' : 'EN BODEGA';

      // 👉 Days in warehouse
      const daysInWarehouse = calcDaysInWarehouse(shipment.createdAt, shipment.status);

      // 👉 dexCode solo si está no_entregado
      const dexCode = await getDexCode(shipment.id, shipment.status);

      return {
        shipmentData: {
          id: shipment.id,
          trackingNumber: shipment.trackingNumber,
          shipmentStatus: shipment.status,
          commitDateTime: shipment.commitDateTime,
          ubication,
          // 🛡️ PROTECCIÓN: Si subsidiary es null, ponemos "SIN SUCURSAL"
          warehouse: shipment.subsidiary?.name ?? 'SIN SUCURSAL', 
          unloading: shipment.unloading
            ? {
                trackingNumber: shipment.unloading.trackingNumber,
                date: shipment.unloading.date,
              }
            : null,
          consolidated: {
            consNumber: consolidated.consNumber,
            date: consolidated.createdAt,
          },
          destination: shipment.recipientCity || null,
          payment: shipment.payment
            ? {
                type: shipment.payment.type,
                amount: +shipment.payment.amount,
              }
            : null,
          createdDate: shipment.createdAt,
          recipientName: shipment.recipientName,
          recipientAddress: shipment.recipientAddress,
          recipientPhone: shipment.recipientPhone,
          recipientZip: shipment.recipientZip,

          shipmentType: shipment.shipmentType,
          daysInWarehouse,
          dexCode,
          isCharge,
        },
        packageDispatch: dispatch
          ? {
              id: dispatch.id,
              trackingNumber: dispatch.trackingNumber,
              createdAt: dispatch.createdAt,
              status: dispatch.status,
              driver: driverName,
              route,
              vehicle: dispatch.vehicle
                ? {
                    name: dispatch.vehicle.name || null,
                    plateNumber: dispatch.vehicle.plateNumber || null,
                  }
                : null,
              subsidiary: dispatch.subsidiary
                ? {
                    id: dispatch.subsidiary.id,
                    name: dispatch.subsidiary.name,
                  }
                : null,
            }
          : null,
      };
    };

    const mappedNormal = await Promise.all(shipments.map(s => mapShipment(s, false)));
    const mappedCharge = await Promise.all(chargeShipments.map(s => mapShipment(s, true)));

    const result = [...mappedNormal, ...mappedCharge];

    console.log("✅ Resultado final:", result.length);
    return result;
  }

  async updateFedexDataBySucursalAndDate(
    subsidiaryId?: string,
    fromDate?: Date,
    toDate?: Date
  ) {
    // 1. Validación y ajuste de fechas UTC
    let utcFromDate: Date | undefined;
    let utcToDate: Date | undefined;

    if (fromDate && toDate) {
      if (fromDate > toDate) {
        throw new Error('La fecha fromDate no puede ser mayor que toDate');
      }

      utcFromDate = new Date(Date.UTC(
        fromDate.getUTCFullYear(),
        fromDate.getUTCMonth(),
        fromDate.getUTCDate(),
        0, 0, 0
      ));

      utcToDate = new Date(Date.UTC(
        toDate.getUTCFullYear(),
        toDate.getUTCMonth(),
        toDate.getUTCDate(),
        23, 59, 59
      ));
    } else if (fromDate || toDate) {
      throw new Error('Debe proporcionar ambas fechas (fromDate y toDate) para usar rangos');
    }

    // 2. Construir consulta simple solo para consolidados
    const queryBuilder = this.consolidatedRepository
      .createQueryBuilder('consolidated')
      .select([
        'consolidated.id',
        'consolidated.consNumber'
      ])
      .orderBy('consolidated.date', 'DESC');

    // 3. Aplicar filtros
    if (subsidiaryId) {
      queryBuilder.andWhere('consolidated.subsidiaryId = :subsidiaryId', { subsidiaryId });
    }

    if (utcFromDate && utcToDate) {
      queryBuilder.andWhere('consolidated.date BETWEEN :fromDate AND :toDate', {
        fromDate: utcFromDate,
        toDate: utcToDate
      });
      
      console.log('Buscando consolidados entre:', utcFromDate, 'y', utcToDate);
    }

    // 4. Ejecutar consulta de consolidados
    const consolidates = await queryBuilder.getMany();

    if (consolidates.length === 0) {
      console.warn('No se encontraron consolidados con los filtros aplicados');
      return [];
    }

    console.log(`📊 Encontrados ${consolidates.length} consolidados`);

    // 5. Para cada consolidado, obtener solo IDs y tracking numbers de shipments
    const shipmentsForFedex = [];
    const shipmentsTrackingNumbers = [];
    const chargeShipmentsTrackingNumbers = [];

    for (const consolidated of consolidates) {
      console.log(`🔍 Buscando shipments para consolidado: ${consolidated.consNumber}`);

      // Obtener solo ID y trackingNumber de shipments normales
      const shipments = await this.shipmentRepository.find({
        where: { consolidatedId: consolidated.id },
        select: ['id', 'trackingNumber']
      });

      // Obtener solo ID y trackingNumber de chargeShipments
      const chargeShipments = await this.chargeShipmentRepository.find({
        where: { consolidatedId: consolidated.id },
        select: ['id', 'trackingNumber']
      });

      console.log(`📦 Shipments: ${shipments.length}, ChargeShipments: ${chargeShipments.length}`);

      if (shipments.length === 0 && chargeShipments.length === 0) {
        console.warn(`⚠️ No se encontraron shipments para consolidado ${consolidated.consNumber}`);
        continue;
      }

      // Combinar y mapear solo los datos necesarios
      const allShipments = [
        ...shipments.map(s => ({
          id: s.id,
          trackingNumber: s.trackingNumber,
          isCharge: false
        })),
        ...chargeShipments.map(s => ({
          id: s.id,
          trackingNumber: s.trackingNumber,
          isCharge: true
        }))
      ];

      shipmentsTrackingNumbers.push(...shipments.map(s => s.trackingNumber))
      chargeShipmentsTrackingNumbers.push(...chargeShipments.map(s => s.trackingNumber))
      shipmentsForFedex.push(...allShipments);
      console.log(`✅ Consolidado ${consolidated.consNumber}: ${allShipments.length} shipments listos para FedEx`);
    }

    console.log(`🎯 Total de shipments para actualizar FedEx: ${shipmentsForFedex.length}`);
    
    try {
      await this.shipmentService.processMasterFedexUpdate(shipmentsTrackingNumbers);
      await this.shipmentService.processChargeFedexUpdate(chargeShipmentsTrackingNumbers);
    } catch (err) {
      this.logger.error(`❌ Error al actualizar FedEx para consolidados ${consolidates}: ${err.message}`);
    }

    return "Proceso terminado.";
  }

  async updateFedexDataByConsolidatedId(consolidatedId: string) {
    this.logger.log(`🚀 Iniciando actualización FedEx para consolidatedId: ${consolidatedId}`);

    if (!consolidatedId) {
      throw new Error('El ID del consolidado es requerido');
    }

    // ==============================
    // 1. Buscar el Consolidado
    // ==============================
    const consolidated = await this.consolidatedRepository.findOne({
      where: { id: consolidatedId },
      select: ['id', 'consNumber']
    });

    if (!consolidated) {
      this.logger.warn(`❌ No se encontró el consolidado con ID: ${consolidatedId}`);
      return [];
    }

    this.logger.log(`🔍 Procesando consolidado #${consolidated.consNumber} (${consolidated.id})`);

    // ==============================
    // 2. Obtener shipments que SÍ requieren revisión FedEx
    // ==============================

    const statusesForFedex = [
      ShipmentStatusType.EN_RUTA,
      ShipmentStatusType.EN_BODEGA,
      ShipmentStatusType.DESCONOCIDO,
      ShipmentStatusType.PENDIENTE,
      ShipmentStatusType.NO_ENTREGADO,
      ShipmentStatusType.DIRECCION_INCORRECTA,
      ShipmentStatusType.CAMBIO_FECHA_SOLICITADO,
      ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
    ];

    this.logger.log(`📌 Status que SÍ se revisarán en FedEx: ${statusesForFedex.join(', ')}`);
    this.logger.log(`📌 EXCLUYENDO status ENTREGADO`);

    const shipments = await this.shipmentRepository.find({
      where: {
        consolidatedId: consolidated.id,
        status: In(statusesForFedex)
      },
      select: ['id', 'trackingNumber', 'status']
    });

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: {
        consolidatedId: consolidated.id,
        status: In(statusesForFedex)
      },
      select: ['id', 'trackingNumber', 'status']
    });

    this.logger.log(`📦 Shipments candidatos a revisión: ${shipments.length}`);
    this.logger.log(`⚡ ChargeShipments candidatos a revisión: ${chargeShipments.length}`);

    if (shipments.length === 0 && chargeShipments.length === 0) {
      this.logger.warn(
        `⚠️ No hay envíos pendientes de revisión FedEx en el consolidado ${consolidated.consNumber}`
      );
      return [];
    }

    // ==============================
    // 3. Combinar datos necesarios
    // ==============================

    const shipmentsForFedex = [
      ...shipments.map(s => ({ id: s.id, trackingNumber: s.trackingNumber, status: s.status, isCharge: false })),
      ...chargeShipments.map(cs => ({ id: cs.id, trackingNumber: cs.trackingNumber, status: cs.status, isCharge: true }))
    ];

    const shipmentsTrackingNumbers = shipments.map(s => s.trackingNumber);
    const chargeTrackingNumbers = chargeShipments.map(cs => cs.trackingNumber);

    this.logger.log(`🔢 Total general a revisar: ${shipmentsForFedex.length}`);
    this.logger.log(`📝 Listado de tracking normales:\n${JSON.stringify(shipmentsTrackingNumbers, null, 2)}`);
    this.logger.log(`📝 Listado de tracking F2:\n${JSON.stringify(chargeTrackingNumbers, null, 2)}`);

    // ==============================
    // 4. Enviar a FedEx
    // ==============================

    let fedexResult = null;
    let fedexChargeResult = null;

    try {
      await this.shipmentService.processMasterFedexUpdate(shipments)
      await this.shipmentService.processChargeFedexUpdate(chargeShipments);

      this.logger.log(`✅ Consolidado ${consolidated.consNumber} procesado exitosamente.`);
    } catch (err) {
      this.logger.error(`❌ Error al consultar FedEx: ${err.message}`);
    }

    // ==============================
    // 5. Resumen Final
    // ==============================

    const statusCount = shipmentsForFedex.reduce((acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    this.logger.log(
      "📊 RESUMEN FINAL:\n" +
      `- Consolidado: ${consolidated.consNumber}\n` +
      `- Revisados totales: ${shipmentsForFedex.length}\n` +
      `- Breakdown por status:\n${JSON.stringify(statusCount, null, 2)}\n` +
      `- Normal: ${shipments.length}\n` +
      `- ChargeShipment: ${chargeShipments.length}`
    );

    this.logger.log("🟢 Proceso FedEx finalizado.");

    return shipmentsForFedex;
  }

  async getShipmentsWithout67ByConsolidated(id: string){
    const shipmentsWithout67 = [];

    const shipments = await this.shipmentRepository.find({
      where: { consolidatedId: id, status: Not(In(TERMINAL_SHIPMENT_STATUSES)) },
      relations: [
        'statusHistory',
      ],
    });

    console.log("📦 Shipments encontrados:", shipments.length);

    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { consolidatedId: id, status: Not(In(TERMINAL_SHIPMENT_STATUSES)) },
      relations: [
        'statusHistory',
      ],
    });

    console.log("⚡ ChargeShipments encontrados:", chargeShipments.length);

    const allShipments = [...shipments, ...chargeShipments];

    for (const shipment of allShipments) {
        try {
          if (!shipment.statusHistory || shipment.statusHistory.length === 0) {
            shipmentsWithout67.push({
              trackingNumber: shipment.trackingNumber,
              currentStatus: shipment.status,
              statusHistoryCount: 0,
              exceptionCodes: [],
              firstStatusDate: null,
              lastStatusDate: null,
              comment: 'Sin historial de estados',
            });
            continue;
          }

          const sortedHistory = shipment.statusHistory.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );

          const hasExceptionCode67 = sortedHistory.some(status => 
            status.exceptionCode === '67'
          );

          if (!hasExceptionCode67) {
            const firstStatus = sortedHistory[0];
            const lastStatus = sortedHistory[sortedHistory.length - 1];

            const exceptionCodes = sortedHistory
              .map(h => h.exceptionCode)
              .filter(code => code !== null && code !== undefined);

            shipmentsWithout67.push({
              trackingNumber: shipment.trackingNumber,
              recipientAddress: shipment.recipientAddress,
              recipientName: shipment.recipientName,
              recipientCity: shipment.recipientCity,
              recipientZip: shipment.recipientZip,
              currentStatus: shipment.status,
              commitDateTime: shipment.commitDateTime,
              statusHistoryCount: sortedHistory.length,
              exceptionCodes: [...new Set(exceptionCodes)],
              firstStatusDate: firstStatus?.timestamp,
              lastStatusDate: lastStatus?.timestamp,
              comment: 'No tiene exceptionCode 67',
            });
          }

        } catch (error) {
          shipmentsWithout67.push({
            trackingNumber: shipment.trackingNumber,
            currentStatus: shipment.status,
            statusHistoryCount: 0,
            exceptionCodes: [],
            firstStatusDate: null,
            lastStatusDate: null,
            comment: `Error: ${error.message}`,
          });
        }
      }

    return { 
      count: shipmentsWithout67.length,
      shipments: shipmentsWithout67
    };

  }

  async getShipmentsWithout44ByConsolidated(id: string) {
    const shipmentsWithout44 = [];

    // 1. Obtener embarques normales
    const shipments = await this.shipmentRepository.find({
      where: { consolidatedId: id, status: Not(In(TERMINAL_SHIPMENT_STATUSES)) },
      relations: ['statusHistory'],
    });

    // 2. Obtener embarques de carga (ChargeShipments)
    const chargeShipments = await this.chargeShipmentRepository.find({
      where: { consolidatedId: id, status: Not(In(TERMINAL_SHIPMENT_STATUSES)) },
      relations: ['statusHistory'],
    });

    console.log("📦 Shipments encontrados:", shipments.length);
    console.log("⚡ ChargeShipments encontrados:", chargeShipments.length);

    const allShipments = [...shipments, ...chargeShipments];

    for (const shipment of allShipments) {
      try {
        // Caso: No hay historial de estados
        if (!shipment.statusHistory || shipment.statusHistory.length === 0) {
          shipmentsWithout44.push({
            trackingNumber: shipment.trackingNumber,
            currentStatus: shipment.status,
            statusHistoryCount: 0,
            exceptionCodes: [],
            firstStatusDate: null,
            lastStatusDate: null,
            comment: 'Sin historial de estados',
          });
          continue;
        }

        // Ordenar historial por fecha
        const sortedHistory = shipment.statusHistory.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        // --- CAMBIO CLAVE: Validar código 44 ---
        const hasExceptionCode44 = sortedHistory.some(status => 
          status.exceptionCode === '44'
        );

        if (!hasExceptionCode44) {
          const firstStatus = sortedHistory[0];
          const lastStatus = sortedHistory[sortedHistory.length - 1];

          const exceptionCodes = sortedHistory
            .map(h => h.exceptionCode)
            .filter(code => code !== null && code !== undefined);

          shipmentsWithout44.push({
            trackingNumber: shipment.trackingNumber,
            recipientAddress: shipment.recipientAddress,
            recipientName: shipment.recipientName,
            recipientCity: shipment.recipientCity,
            recipientZip: shipment.recipientZip,
            currentStatus: shipment.status,
            commitDateTime: shipment.commitDateTime,
            statusHistoryCount: sortedHistory.length,
            exceptionCodes: [...new Set(exceptionCodes)],
            firstStatusDate: firstStatus?.timestamp,
            lastStatusDate: lastStatus?.timestamp,
            comment: 'No tiene exceptionCode 44',
          });
        }

      } catch (error) {
        shipmentsWithout44.push({
          trackingNumber: shipment.trackingNumber,
          currentStatus: shipment.status,
          statusHistoryCount: 0,
          exceptionCodes: [],
          firstStatusDate: null,
          lastStatusDate: null,
          comment: `Error: ${error.message}`,
        });
      }
    }

    return { 
      count: shipmentsWithout44.length,
      shipments: shipmentsWithout44
    };
  }

}
