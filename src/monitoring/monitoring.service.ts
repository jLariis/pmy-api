import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MailService } from 'src/mail/mail.service';
import { FedexService } from 'src/shipments/fedex.service';
import { ShipmentsService } from 'src/shipments/shipments.service';
import { ConsolidatedService } from 'src/consolidated/consolidated.service';
import { PackageDispatchService } from 'src/package-dispatch/package-dispatch.service';
import { UnloadingService } from 'src/unloading/unloading.service';
import { InventoriesService } from 'src/inventories/inventories.service';
import { SubsidiariesService } from 'src/subsidiaries/subsidiaries.service';
import { GeocodeService } from 'src/geocode/geocode.service';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import pLimit from 'p-limit';

/**
 * Prioridad de estatus para el "headline" de una parada agrupada (varias guías
 * al mismo destinatario/dirección/CP = remesa, se entregan en UNA sola parada):
 * lo que necesita atención manda sobre lo que ya salió bien.
 */
const STOP_STATUS_PRIORITY = [
  'rechazado', 'devuelto_a_fedex', 'retorno_abandono_fedex',
  'direccion_incorrecta', 'restriccion_seguridad_ubicacion', 'cliente_no_disponible', 'empresa_cerrada', 'cambio_fecha_solicitado',
  'en_ruta', 'en_transito', 'pendiente', 'recibido_en_bodega', 'en_bodega', 'es_ocurre', 'acargo_de_fedex', 'llegado_despues', 'estacion_fedex', 'demora_en_entrega',
  'entregado', 'entregado_por_fedex', 'entregado_en_bodega',
];
const DELIVERED_STATUSES = new Set(['entregado', 'entregado_por_fedex', 'entregado_en_bodega']);
// DEX03 (dirección incorrecta), DEX08/STAT42 (cliente no disponible / empresa
// cerrada), DEX17 (cambio de fecha), DEX05 (restricción de seguridad), DEX07
// (rechazado), devuelto_a_fedex y DEX14 (retorno/abandono FedEx): ya tienen un
// motivo de FedEx registrado — "matan" el Local Delay aunque no sea entrega.
const BAD_STATUSES_SET = new Set([
  'rechazado', 'devuelto_a_fedex', 'retorno_abandono_fedex',
  'direccion_incorrecta', 'cliente_no_disponible', 'empresa_cerrada', 'cambio_fecha_solicitado', 'restriccion_seguridad_ubicacion',
]);
/** Ya no cuenta como "en riesgo de Local Delay": o se entregó, o ya tiene un motivo de FedEx registrado. */
const LD_EXEMPT_STATUSES = new Set([...DELIVERED_STATUSES, ...BAD_STATUSES_SET]);
const SEVERITY_ORDER: Record<'critical' | 'warning' | 'info', number> = { critical: 0, warning: 1, info: 2 };

/** Clave de parada: incluye TODAS las guías de un mismo destinatario/dirección/CP (remesas → una sola parada física). */
function stopKeyOf(s: { recipientName?: string; recipientAddress?: string; recipientZip?: string }): string {
  const norm = (v?: string) => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');
  return [norm(s.recipientName), norm(s.recipientAddress), norm(s.recipientZip)].join('|');
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  // Fallback histórico (se prefiere la config real de la entidad Subsidiary).
  private SUBSIDIARY_CONFIG = {
    "abf2fc38-cb42-41b6-9554-4b71c11b8916": {
      shouldCheck67: true,
      shouldCheck44: false
    },
    "b45cbb94-84e0-481f-bbf8-75642b601230": {
      shouldCheck67: false,
      shouldCheck44: true
    },
    "040483fc-4322-4ce0-b124-cc5b6d2a9cee": {
      shouldCheck67: false,
      shouldCheck44: true
    }
  }

  constructor(
    private readonly mailService: MailService,
    private readonly fedexService: FedexService,
    private readonly shipmentService: ShipmentsService,
    private readonly packageDispatchService: PackageDispatchService,
    private readonly consolidatedService: ConsolidatedService,
    private readonly unloadingService: UnloadingService,
    private readonly inventoryService: InventoriesService,
    private readonly subsidiariesService: SubsidiariesService,
    private readonly geocodeService: GeocodeService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Caché en memoria del último refresh a FedEx por ruta (dispatchId), para el
   * tablero de monitoreo "en tiempo real". Coalescido: sin importar cuántos
   * usuarios estén viendo la misma ruta ni qué tan seguido refresquen su
   * pantalla, solo se le pega a FedEx una vez cada LIVE_CACHE_TTL_MS.
   * Deliberadamente en memoria (no BD): es una pantalla experimental, se
   * pierde al reiniciar el proceso y no pasa nada.
   */
  private readonly routeLiveCache = new Map<string, { checkedAt: number; payload: { stops: any[]; analysis: any } }>();
  private readonly LIVE_CACHE_TTL_MS = 75_000;

  /**
   * Caché de coordenadas por ruta (dispatchId). Separada del caché de estatus
   * a propósito: la dirección de una guía NO cambia, así que se puede cachear
   * mucho más tiempo, y geocodificar es lo LENTO (Nominatim throttlea ~1.1s por
   * dirección no vista antes) — no debe bloquear el estatus/tablero.
   */
  private readonly routeCoordsCache = new Map<string, { checkedAt: number; coords: { stopKey: string; lat: number | null; lng: number | null }[] }>();
  private readonly COORDS_CACHE_TTL_MS = 10 * 60_000;

  /** Rutas activas (EN_PROGRESO) de una sucursal, para elegir cuál monitorear. */
  async getActiveRoutes(subsidiaryId: string) {
    return this.packageDispatchService.findActiveBySubsidiary(subsidiaryId);
  }

  /**
   * Tablero general: TODAS las rutas de una sucursal en un día (hora
   * Hermosillo), con el resumen de cada una para pintar un cuadro por ruta.
   * Reutiliza `getLiveRouteStatus` (y por lo tanto su mismo caché de 75s) por
   * cada ruta — así el tablero y el detalle de una ruta comparten el mismo
   * refresh coalescido a FedEx, sin pegarle dos veces. `pLimit` evita que, si
   * muchas rutas están frías de caché a la vez (ej. al abrir el tablero por
   * primera vez en el día), se disparen todas sus consultas a FedEx en
   * paralelo sin control.
   */
  async getRoutesBoard(subsidiaryId: string, date: string) {
    const dispatches = await this.packageDispatchService.findBySubsidiaryAndDate(subsidiaryId, date);
    const limit = pLimit(3);

    const results = await Promise.all(
      dispatches.map((d) =>
        limit(async () => {
          const live = await this.getLiveRouteStatus(d.id).catch((err) => {
            this.logger.warn(`getRoutesBoard: fallo al cargar ruta ${d.id}: ${err?.message}`);
            return null;
          });
          if (!live) {
            return {
              id: d.id, trackingNumber: d.trackingNumber, status: d.status,
              createdAt: d.createdAt, startTime: d.startTime, routeClosedAt: null,
              driverNames: d.driverNames, vehiclePlate: d.vehiclePlate, routeNames: d.routeNames,
              scanCode: '67' as const,
              totalStops: 0, visitedStops: 0, pendingStops: 0,
              criticalAlerts: 0, warningAlerts: 0, topAlert: null, lastActivityAt: null,
              avgGapMinutes: null, paceCompletedPerHour: null,
              normalPackageCount: 0, chargePackageCount: 0,
              paymentsCount: 0, paymentsTotal: 0, paymentsCollectedCount: 0, paymentsCollectedTotal: 0, paymentsPendingTotal: 0,
            };
          }
          const criticalAlerts = live.analysis.alerts.filter((a) => a.severity === 'critical').length;
          const warningAlerts = live.analysis.alerts.filter((a) => a.severity === 'warning').length;
          return {
            id: live.id, trackingNumber: live.trackingNumber, status: live.status,
            createdAt: live.createdAt, startTime: live.startTime, routeClosedAt: live.routeClosedAt,
            driverNames: live.driverNames, vehiclePlate: live.vehiclePlate, routeNames: live.routeNames,
            scanCode: live.scanCode,
            totalStops: live.analysis.totalStops, visitedStops: live.analysis.visitedStops, pendingStops: live.analysis.pendingStops,
            criticalAlerts, warningAlerts,
            topAlert: live.analysis.alerts[0] || null,
            lastActivityAt: live.analysis.lastActivityAt,
            // Métricas de rendimiento del chofer, ya calculadas por getLiveRouteStatus —
            // se reutilizan aquí para las gráficas de ritmo/tiempo por parada del tablero.
            avgGapMinutes: live.analysis.avgGapMinutes,
            paceCompletedPerHour: live.analysis.paceCompletedPerHour,
            // Guías normales vs. F2 y cobros (COD) — mismo cómputo que el detalle.
            normalPackageCount: live.analysis.normalPackageCount,
            chargePackageCount: live.analysis.chargePackageCount,
            paymentsCount: live.analysis.paymentsCount,
            paymentsTotal: live.analysis.paymentsTotal,
            paymentsCollectedCount: live.analysis.paymentsCollectedCount,
            paymentsCollectedTotal: live.analysis.paymentsCollectedTotal,
            paymentsPendingTotal: live.analysis.paymentsPendingTotal,
          };
        }),
      ),
    );

    return results.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  /**
   * Estatus "en vivo" de una ruta: usa caché (sin pegarle a FedEx) si el último
   * refresh fue hace menos de LIVE_CACHE_TTL_MS; si no, dispara UN refresh real
   * (reusando getFedexComparisonStatuses → prefetchFedexBatch, con su mismo
   * batching/backoff/circuit-breaker) y actualiza el caché.
   */
  async getLiveRouteStatus(dispatchId: string, force = false) {
    const now = Date.now();
    const cached = this.routeLiveCache.get(dispatchId);
    const fresh = cached && !force && (now - cached.checkedAt) < this.LIVE_CACHE_TTL_MS;

    const dispatch = await this.packageDispatchService.findOneWithShipmentsForMonitoring(dispatchId);
    if (!dispatch) return null;

    // Cada sucursal tiene precapturado si monitorea con el código 67 o el 44
    // (llegada a estación local) — si no tiene configuración explícita, 67 por default.
    const scanCode: '67' | '44' = (dispatch as any).subsidiary?.monitorFedexCode44 === true ? '44' : '67';

    const base = {
      id: dispatch.id,
      trackingNumber: dispatch.trackingNumber,
      createdAt: dispatch.createdAt,
      startTime: dispatch.startTime,
      kms: dispatch.kms,
      status: dispatch.status,
      driverNames: (dispatch.drivers || []).map((d) => d.name).join(', ') || null,
      vehiclePlate: dispatch.vehicle?.plateNumber || null,
      routeNames: (dispatch.routes || []).map((r) => r.name).join(', ') || null,
      // Cierre de ruta REAL (si ya se cerró) — distinto de `closedAt` en el
      // dispatch, que trae un default raro (CURRENT_TIMESTAMP) aunque nullable.
      routeClosedAt: (dispatch as any).routeClosure?.closeDate ? new Date((dispatch as any).routeClosure.closeDate).toISOString() : null,
      scanCode,
    };

    if (fresh) {
      return { ...base, ...cached.payload, lastFedexCheckAt: new Date(cached.checkedAt).toISOString(), fromCache: true };
    }

    // Guías normales Y cargas (F2) — mismo tratamiento para ambas: agrupación
    // por parada, chequeo de FedEx, escaneo del día, huecos, etc.
    const normalShipments = (dispatch.shipments || []).map((s: any) => ({ ...s, isCharge: false }));
    const chargeShipments = (dispatch.chargeShipments || []).map((s: any) => ({ ...s, isCharge: true }));
    const shipments = [...normalShipments, ...chargeShipments];
    const fedexTargets = shipments.filter((s) => String(s.shipmentType).toLowerCase() === ShipmentType.FEDEX.toLowerCase());

    const statuses = fedexTargets.length
      ? await this.shipmentService.getFedexComparisonStatuses(
          fedexTargets.map((s) => ({ trackingNumber: s.trackingNumber, fedexUniqueId: (s as any).fedexUniqueId })),
          scanCode,
        )
      : {};

    // Hermosillo es UTC-7 fijo (sin horario de verano) — mismo criterio que
    // getFedex67Visibility/getFedex44Visibility para "¿tuvo escaneo hoy?".
    const HER_OFFSET_MS = -7 * 3600 * 1000;
    const herDay = (x: any) => new Date(new Date(x).getTime() + HER_OFFSET_MS).toISOString().slice(0, 10);
    const todayHmo = herDay(new Date());

    // Último escaneo por guía (recorrido/ritmo del chofer) y "¿tuvo el escaneo
    // de la sucursal (67 o 44) hoy?" — OJO: shipment_status usa columnas
    // DISTINTAS para guías normales (shipmentId) y cargas F2 (chargeShipmentId),
    // así que van en consultas separadas y se combinan por el id propio de cada una.
    const normalIds = normalShipments.map((s: any) => s.id).filter(Boolean);
    const chargeIds = chargeShipments.map((s: any) => s.id).filter(Boolean);
    const lastScanById = new Map<string, string>();
    const hasScanTodayById = new Map<string, boolean>();

    const fetchLastScan = async (ids: string[], col: 'shipmentId' | 'chargeShipmentId') => {
      if (!ids.length) return;
      const placeholders = ids.map(() => '?').join(',');
      const rows: any[] = await this.dataSource.query(
        `SELECT ${col} AS refId, MAX(timestamp) AS lastTs FROM shipment_status WHERE ${col} IN (${placeholders}) GROUP BY ${col}`,
        ids,
      );
      for (const r of rows) if (r.refId) lastScanById.set(String(r.refId), r.lastTs);
    };
    const fetchHasScanToday = async (ids: string[], col: 'shipmentId' | 'chargeShipmentId') => {
      if (!ids.length) return;
      const placeholders = ids.map(() => '?').join(',');
      const rows: any[] = await this.dataSource.query(
        `SELECT ${col} AS refId, timestamp FROM shipment_status WHERE ${col} IN (${placeholders}) AND exceptionCode = ? AND timestamp >= ?`,
        [...ids, scanCode, new Date(Date.now() - 2 * 86_400_000)], // 2 días de sobra para cubrir "hoy" en Hermosillo
      );
      for (const r of rows) if (r.refId && herDay(r.timestamp) === todayHmo) hasScanTodayById.set(String(r.refId), true);
    };
    await Promise.all([
      fetchLastScan(normalIds, 'shipmentId'), fetchLastScan(chargeIds, 'chargeShipmentId'),
      fetchHasScanToday(normalIds, 'shipmentId'), fetchHasScanToday(chargeIds, 'chargeShipmentId'),
    ]);

    // Agrupamos por destinatario+dirección+CP: varias guías al mismo lugar
    // (remesa) se entregan en UNA sola parada física, no una por guía.
    const groups = new Map<string, { rep: any; packages: any[] }>();
    for (const s of shipments) {
      const key = stopKeyOf(s);
      if (!groups.has(key)) groups.set(key, { rep: s, packages: [] });
      groups.get(key)!.packages.push(s);
    }

    // SIN geocoding aquí a propósito: es lo lento (Nominatim), y este endpoint
    // debe responder rápido para que el tablero no espere. El mapa se llena
    // aparte con getRouteStopCoordinates (ver abajo), en paralelo/después.
    const rawStops = Array.from(groups.entries()).map(([stopKey, { rep, packages }]) => {
      const pkgs = packages.map((s) => {
        const f = statuses[s.trackingNumber];
        // Preferimos el evento MÁS RECIENTE fresco de FedEx (preciso) sobre lo que
        // tengamos guardado en BD — el historial en BD puede venir de un import por
        // lote (varias guías con el mismo timestamp de cuando se importaron, no de
        // cuando FedEx realmente escaneó cada una), lo que descuadraba el orden del
        // recorrido y los huecos entre paradas.
        const dbLastScan = lastScanById.get(String(s.id)) || null;
        const lastScanAt = f?.lastEventAt || (dbLastScan ? new Date(dbLastScan).toISOString() : null);
        // El código de escaneo (67/44, según config de la sucursal) solo aplica a
        // FedEx (DHL no lo maneja) — para DHL queda en `false`.
        const hasScanToday = f?.hasScanToday ?? hasScanTodayById.get(String(s.id)) ?? false;
        const pay = (s as any).payment;
        return {
          trackingNumber: s.trackingNumber,
          status: s.status,
          carrier: s.shipmentType ?? null,
          isCharge: !!(s as any).isCharge,
          fedexStatus: f?.fedexStatus ?? null,
          fedexRaw: f?.fedexRaw ?? null,
          commitDateTime: s.commitDateTime ? new Date(s.commitDateTime).toISOString() : null,
          recipientPhone: (s as any).recipientPhone ?? null,
          hasScanToday,
          lastScanAt,
          payment: pay ? { amount: Number(pay.amount), type: pay.type, status: pay.status } : null,
        };
      });
      const statusesInGroup = pkgs.map((p) => String(p.fedexStatus || p.status || '').toLowerCase());
      const headlineStatus = statusesInGroup.sort(
        (a, b) => STOP_STATUS_PRIORITY.indexOf(a) - STOP_STATUS_PRIORITY.indexOf(b),
      )[0] || 'desconocido';
      const deliveredCount = pkgs.filter((p) => DELIVERED_STATUSES.has(String(p.fedexStatus || p.status || '').toLowerCase())).length;
      const lastScanAt = pkgs.reduce<string | null>((max, p) => (!p.lastScanAt ? max : !max || p.lastScanAt > max ? p.lastScanAt : max), null);
      return {
        stopKey,
        recipientName: rep.recipientName,
        recipientAddress: rep.recipientAddress,
        recipientCity: rep.recipientCity,
        recipientZip: rep.recipientZip,
        packages: pkgs,
        packageCount: pkgs.length,
        deliveredCount,
        headlineStatus,
        lastScanAt,
      };
    });

    // Reconstrucción del recorrido: SOLO paradas ya RESUELTAS (entregada, o con
    // motivo de FedEx registrado) — no basta con "tiene algún escaneo", porque
    // una guía todavía pendiente puede traer escaneos de tránsito viejos (de la
    // central, de otra sucursal, etc.) que NO son una visita real del chofer y
    // descuadraban el orden del recorrido y los huecos entre paradas.
    const visited = rawStops
      .filter((s) => s.lastScanAt && (BAD_STATUSES_SET.has(s.headlineStatus) || (DELIVERED_STATUSES.has(s.headlineStatus) && s.deliveredCount === s.packageCount)))
      .sort((a, b) => (a.lastScanAt! < b.lastScanAt! ? -1 : 1));
    const sequenceByKey = new Map(visited.map((s, i) => [s.stopKey, i + 1]));
    const stops = rawStops
      .map((s) => ({ ...s, sequence: sequenceByKey.get(s.stopKey) ?? null }))
      .sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity));

    // Guías normales vs. cargas F2, y cobros (COD) de la ruta. Regla del cobro
    // "en mano": si el paquete YA se entregó y traía cobro, ese dinero debe
    // estar físicamente con el chofer AHORA MISMO — es lo que se le puede pedir
    // rendir cuentas hoy, a diferencia del cobro total (que incluye lo aún no entregado).
    const allPkgs = stops.flatMap((s) => s.packages);
    const normalPackageCount = allPkgs.filter((p) => !p.isCharge).length;
    const chargePackageCount = allPkgs.filter((p) => p.isCharge).length;
    const withPayment = allPkgs.filter((p) => p.payment && p.payment.amount > 0);
    const paymentsCount = withPayment.length;
    const paymentsTotal = Math.round(withPayment.reduce((sum, p) => sum + p.payment!.amount, 0) * 100) / 100;
    const collected = withPayment.filter((p) => DELIVERED_STATUSES.has(String(p.fedexStatus || p.status || '').toLowerCase()));
    const paymentsCollectedCount = collected.length;
    const paymentsCollectedTotal = Math.round(collected.reduce((sum, p) => sum + p.payment!.amount, 0) * 100) / 100;
    const paymentsPendingTotal = Math.round((paymentsTotal - paymentsCollectedTotal) * 100) / 100;

    // Análisis del chofer: huecos entre paradas consecutivas YA visitadas.
    const gaps: { minutes: number; fromStopKey: string; toStopKey: string; fromLabel: string; toLabel: string }[] = [];
    for (let i = 1; i < visited.length; i++) {
      const prev = visited[i - 1], cur = visited[i];
      const minutes = Math.round((new Date(cur.lastScanAt!).getTime() - new Date(prev.lastScanAt!).getTime()) / 60000);
      gaps.push({
        minutes,
        fromStopKey: prev.stopKey, toStopKey: cur.stopKey,
        fromLabel: prev.recipientName || prev.recipientAddress || '—',
        toLabel: cur.recipientName || cur.recipientAddress || '—',
      });
    }
    const avgGapMinutes = gaps.length ? Math.round(gaps.reduce((s, g) => s + g.minutes, 0) / gaps.length) : null;
    const longestGap = gaps.length ? gaps.reduce((max, g) => (g.minutes > max.minutes ? g : max), gaps[0]) : null;
    const elapsedHours = dispatch.startTime ? (Date.now() - new Date(dispatch.startTime).getTime()) / 3600000 : null;
    const paceCompletedPerHour = elapsedHours && elapsedHours > 0 ? Math.round((visited.length / elapsedHours) * 10) / 10 : null;

    // Alertas accionables: lo que necesita atención AHORA, no solo "estadísticas".
    // 'critical' = ya se convirtió (o está por convertirse) en Local Delay real.
    const nowMs = Date.now();
    const alerts: { severity: 'critical' | 'warning' | 'info'; code: string; message: string }[] = [];

    // LD_EXEMPT (no solo "entregado"): una guía con DEX03/08/42/17/05, rechazo,
    // devuelta o retorno/abandono FedEx YA tiene un motivo registrado — no sigue
    // en riesgo de Local Delay aunque no se haya entregado.
    const pendingPkgs = stops.flatMap((s) => s.packages.filter((p) => !LD_EXEMPT_STATUSES.has(String(p.fedexStatus || p.status || '').toLowerCase())).map((p) => ({ ...p, stop: s })));
    const overdue = pendingPkgs.filter((p) => p.commitDateTime && new Date(p.commitDateTime).getTime() < nowMs);
    if (overdue.length) {
      alerts.push({
        severity: 'critical', code: 'overdue',
        message: `${overdue.length} guía(s) ya vencieron su compromiso de entrega y siguen sin entregarse — riesgo de Local Delay hoy mismo.`,
      });
    }
    const dueSoon = pendingPkgs.filter((p) => {
      if (!p.commitDateTime) return false;
      const diff = new Date(p.commitDateTime).getTime() - nowMs;
      return diff >= 0 && diff <= 45 * 60_000;
    });
    if (dueSoon.length) {
      alerts.push({
        severity: 'warning', code: 'due_soon',
        message: `${dueSoon.length} guía(s) vencen en menos de 45 min y siguen sin entregarse.`,
      });
    }
    if (longestGap && longestGap.minutes >= 30) {
      alerts.push({
        severity: longestGap.minutes >= 60 ? 'critical' : 'warning', code: 'long_gap',
        message: `Hueco de ${longestGap.minutes} min entre "${longestGap.fromLabel}" y "${longestGap.toLabel}" — revisar tráfico, comida o desvío.`,
      });
    }
    const lastActivityAt = visited.length ? visited[visited.length - 1].lastScanAt : null;
    const minutesSinceLastActivity = lastActivityAt ? Math.round((nowMs - new Date(lastActivityAt).getTime()) / 60000) : null;
    if (minutesSinceLastActivity != null && minutesSinceLastActivity >= 45 && stops.length - visited.length > 0) {
      alerts.push({
        severity: minutesSinceLastActivity >= 90 ? 'critical' : 'warning', code: 'stalled',
        message: `Sin actividad hace ${minutesSinceLastActivity} min con paradas pendientes — confirmar que el chofer sigue en movimiento.`,
      });
    }
    const exceptionCount = stops.filter((s) => BAD_STATUSES_SET.has(s.headlineStatus)).length;
    if (exceptionCount) {
      alerts.push({
        severity: 'info', code: 'exceptions',
        message: `${exceptionCount} parada(s) con excepción (rechazo, devolución o cliente no disponible) sin resolver.`,
      });
    }
    alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    const analysis = {
      totalStops: stops.length,
      visitedStops: visited.length,
      pendingStops: stops.length - visited.length,
      avgGapMinutes,
      longestGap,
      paceCompletedPerHour,
      gaps,
      alerts,
      lastActivityAt,
      normalPackageCount,
      chargePackageCount,
      paymentsCount,
      paymentsTotal,
      paymentsCollectedCount,
      paymentsCollectedTotal,
      paymentsPendingTotal,
    };

    const payload = { stops, analysis };
    this.routeLiveCache.set(dispatchId, { checkedAt: now, payload });
    return { ...base, ...payload, lastFedexCheckAt: new Date(now).toISOString(), fromCache: false };
  }

  /**
   * Coordenadas de cada parada de la ruta (para el mapa), SEPARADO del estatus.
   * Cacheado 10 min por dispatchId (las direcciones no cambian). El frontend lo
   * pide DESPUÉS de pintar el tablero, para no bloquear la carga inicial. Se
   * geocodifica UNA vez por parada (agrupada), no una por guía — si 3 guías
   * comparten dirección, es 1 sola llamada de geocoding, no 3.
   */
  async getRouteStopCoordinates(dispatchId: string) {
    const cached = this.routeCoordsCache.get(dispatchId);
    if (cached && (Date.now() - cached.checkedAt) < this.COORDS_CACHE_TTL_MS) return cached.coords;

    const dispatch = await this.packageDispatchService.findOneWithShipmentsForMonitoring(dispatchId);
    if (!dispatch) return [];

    const shipments = [...(dispatch.shipments || []), ...(dispatch.chargeShipments || [])];
    const groups = new Map<string, any>();
    for (const s of shipments) if (!groups.has(stopKeyOf(s))) groups.set(stopKeyOf(s), s);

    const coords = await Promise.all(
      Array.from(groups.entries()).map(async ([stopKey, s]) => {
        let lat: number | null = null, lng: number | null = null;
        try {
          const geo = await this.geocodeService.geocode({ address: s.recipientAddress, city: s.recipientCity, zip: s.recipientZip });
          if (geo[0]) { lat = Number(geo[0].lat); lng = Number(geo[0].lon); }
        } catch { /* sin geocoding, el pin simplemente no se muestra */ }
        return { stopKey, lat, lng };
      }),
    );

    this.routeCoordsCache.set(dispatchId, { checkedAt: Date.now(), coords });
    return coords;
  }

  /**
   * Config de monitoreo por sucursal: LEE de la entidad Subsidiary (columnas reales)
   * y cae al SUBSIDIARY_CONFIG hardcodeado solo si la sucursal no existe.
   */
  private async getMonitorConfig(subsidiaryId: string): Promise<{ check67: boolean; check44: boolean }> {
    const sub: any = await this.subsidiariesService.findById(subsidiaryId).catch(() => null);
    const hc: any = this.SUBSIDIARY_CONFIG[subsidiaryId];
    return {
      check67: sub?.monitorFedexCode67 ?? hc?.shouldCheck67 ?? false,
      check44: sub?.monitorFedexCode44 ?? hc?.shouldCheck44 ?? false,
    };
  }

  async getConsolidatedsBySubsidiary(subdiaryId: string) {
    const consolidateds  = await this.consolidatedService.findBySubsidiary(subdiaryId)
    return consolidateds;
  }

  async getPackageDispatchBySubsidiary(subdiaryId: string) {
    const packageDispatchs = await this.packageDispatchService.findBySubsidiary(subdiaryId);
    return packageDispatchs;
  }

  async getUnloadingsBySubsidiary(subdiaryId: string) {
    const unloadings = await this.unloadingService.findBySubsidiaryId(subdiaryId);
    return unloadings;
  }

  async getInfoFromPackageDispatch(packageDispatchId: string) {
    const packageDispatch = await this.packageDispatchService.findShipmentsByDispatchId(packageDispatchId);
    return packageDispatch;
  }

  async getInfoFromConsolidated(consolidatedId: string) {
    const packages = await this.consolidatedService.findShipmentsByConsolidatedId(consolidatedId);
    return packages;
  }

  async getInfoFromUnloading(unloadingId: string) {
    const packages = await this.unloadingService.findShipmentsByUnloadingId(unloadingId);
    return packages; 
  }

  async updateFedexFromConsolidated(consolidatedId: string) {
    const updatedPackages = await this.consolidatedService.updateFedexDataByConsolidatedId(consolidatedId);
    return updatedPackages;
  }

  async updateFedexFromUnloading(unloadingId: string) {
    const updatedPackages = await this.unloadingService.updateFedexDataByUnloadingId(unloadingId);
    return updatedPackages;
  }

  async updateFedexFromPackageDispatch(packageDispatchId: string) {
    const updatedPackages = await this.packageDispatchService.updateFedexDataByPackageDispatchId(packageDispatchId);
    return updatedPackages;
  }

  async getShipmentsWithout67(consolidatedId: string, subdidiaryId: string){
    const cfg = await this.getMonitorConfig(subdidiaryId);
    if(cfg.check67){
      const shipments = await this.consolidatedService.getShipmentsWithout67ByConsolidated(consolidatedId);
      return shipments;
    }

    if(cfg.check44){
      const shipments = await this.consolidatedService.getShipmentsWithout44ByConsolidated(consolidatedId);
      return shipments;
    }

    return await this.consolidatedService.getShipmentsWithout67ByConsolidated(consolidatedId);    
  }

  async getShipmentsWithout67ByUnloading(unloadingId: string, subdidiaryId: string){
    const cfg = await this.getMonitorConfig(subdidiaryId);
    if(cfg.check67){
      const shipments = await this.unloadingService.getShipmentsWithout67ByUnloading(unloadingId);
      return shipments;
    }

    if(cfg.check44){
      const shipments = await this.unloadingService.getShipmentsWithout44ByUnloading(unloadingId);
      return shipments;
    }
    
    return await this.unloadingService.getShipmentsWithout67ByUnloading(unloadingId);  
  }

  async getShipmentsWithout67ByPackageDispatch(packageDispatchId: string, subdidiaryId: string){
    const cfg = await this.getMonitorConfig(subdidiaryId);
    if(cfg.check67){
      const shipments = await this.packageDispatchService.getShipmentsWithout67ByPackageDispatch(packageDispatchId);
      return shipments;
    }

    if(cfg.check44){
      const shipments = await this.packageDispatchService.getShipmentsWithout44ByPackageDispatch(packageDispatchId);
      return shipments;
    }

    return await this.packageDispatchService.getShipmentsWithout67ByPackageDispatch(packageDispatchId);
  }

  async checkInventory67(subsidiaryId: string){
    const shipments = await this.inventoryService.checkInventory67BySubsidiary(subsidiaryId);
    return shipments;
  }

  async generateInventory67Excel(subsidiaryId: string, subsidiaryName?: string){
    return this.inventoryService.downloadExcelReport(subsidiaryId, subsidiaryName);
  }

  async findPakageDispatchByDriverAndDate(driverId: string, startDate: string, endDate: string, subsidiaryId: string) {
    const packageDispatch = await this.packageDispatchService.findPakageDispatchByDriverAndDate(driverId, startDate, endDate, subsidiaryId);
    return packageDispatch; 
  }

  async findPakageDispatchByDateRange(startDate: string, endDate: string, subsidiaryId: string) {
    const packageDispatch = await this.packageDispatchService.findPakageDispatchByDateRange(startDate, endDate, subsidiaryId);
    return packageDispatch; 
  }

  async generateDriverReportExcel(startDate: string, endDate: string, subsidiaryId: string) {
    const buffer = await this.packageDispatchService.generateDriverReportExcel(startDate, endDate, subsidiaryId);
    return buffer;
  }

}
