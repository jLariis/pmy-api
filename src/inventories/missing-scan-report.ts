import { fromZonedTime } from 'date-fns-tz';
import { Between, In } from 'typeorm';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import {
  configuredScanCode,
  daysWithoutLocalScan,
  lastLocalScanOf,
  latestLocalScan,
  LocalScan,
  LocalScanCode,
  localScanCategory,
} from 'src/utils/local-scan-visibility.util';

/**
 * Motor del reporte "Sin código 44 por sucursal/zona" — lo usan el reporte
 * (`InventoriesService.getMissingScanReportMulti`) y el welcome dashboard ("Sin escaneo local")
 * para que los dos cuenten EXACTAMENTE lo mismo (antes no empataban: semántica, estatus y tope
 * distintos — ver discrepancia welcome vs reporte).
 */

/**
 * Candado temporal del reporte: solo paquetes dados de alta en octubre 2026 (día local de
 * Hermosillo, UTC-7). `to` es el último milisegundo del mes.
 */
export const MISSING_SCAN_REPORT_WINDOW = {
  from: fromZonedTime('2026-10-01T00:00:00', 'America/Hermosillo'),
  to: new Date(fromZonedTime('2026-11-01T00:00:00', 'America/Hermosillo').getTime() - 1),
};

/** Estatus que entran al reporte: lo que está en manos de FedEx/bodega (donde FedEx escanea). */
export const MISSING_SCAN_STATUSES = [ShipmentStatusType.PENDIENTE, ShipmentStatusType.EN_BODEGA];

/** `where` de TypeORM (envíos y cargas) del reporte: sucursales + estatus + solo FedEx + ventana. */
export function missingScanWhere(subsidiaryIds: string[]) {
  return {
    subsidiary: { id: In(subsidiaryIds) },
    status: In(MISSING_SCAN_STATUSES),
    shipmentType: ShipmentType.FEDEX,
    createdAt: Between(MISSING_SCAN_REPORT_WINDOW.from, MISSING_SCAN_REPORT_WINDOW.to),
  };
}

export interface MissingScanSub { id: string; name?: string; monitorFedexCode44?: boolean | null }

export interface MissingScanDetail {
  id: string;
  trackingNumber: string;
  status: any;
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientZip: string;
  recipientPhone: string;
  consNumber: string;
  shipmentType: any;
  fedexUniqueId: string;
  commitDateTime: any;
  isCharge: boolean;
  subsidiaryId?: string;
  subsidiaryName?: string;
  /** Último código que reportó FedEx (o el configurado de la sucursal si nunca hubo). */
  scanCode: LocalScanCode;
  configuredCode: LocalScanCode;
  createdAt: string;
  lastCodeDate: string | null;
  daysSinceLastCode: number | null;
  hasCodeToday: boolean;
  category: 'hoy' | 'sinCodigo' | 'nunca';
  statusHistoryCount: number;
  exceptionCodes: string[];
}

/**
 * Agrega por GUÍA (una guía puede tener varias copias; el código puede estar en cualquiera):
 * último escaneo local 44 o 67 entre todas las copias, copia más nueva como representante y alta
 * = copia más antigua. Orden: alta en el sistema, del más viejo al más nuevo.
 */
export function buildMissingScanReport(
  tagged: { s: any; isCharge: boolean }[],
  subs: MissingScanSub[],
  now: Date = new Date(),
) {
  const subById = new Map(subs.map((s) => [s.id, s]));
  type Agg = {
    rep: any; isCharge: boolean; last: LocalScan | null; codes: Set<string>;
    historyCount: number; minCreatedAt: Date; subsidiaryId?: string;
  };
  const byGuide = new Map<string, Agg>();

  for (const { s, isCharge } of tagged) {
    const history = s.statusHistory || [];
    const last = lastLocalScanOf(history);
    const codes = new Set<string>();
    for (const h of history) if (h.exceptionCode) codes.add(h.exceptionCode);

    const createdAt = new Date(s.createdAt);
    const existing = byGuide.get(s.trackingNumber);
    if (!existing) {
      byGuide.set(s.trackingNumber, { rep: s, isCharge, last, codes, historyCount: history.length, minCreatedAt: createdAt, subsidiaryId: s.subsidiary?.id });
    } else {
      if (createdAt > new Date(existing.rep.createdAt)) existing.rep = s;
      existing.isCharge = existing.isCharge || isCharge;
      existing.last = latestLocalScan(existing.last, last);
      existing.historyCount += history.length;
      if (createdAt < existing.minCreatedAt) existing.minCreatedAt = createdAt;
      for (const c of codes) existing.codes.add(c);
    }
  }

  const details: MissingScanDetail[] = Array.from(byGuide.values()).map(({ rep, isCharge, last, codes, historyCount, minCreatedAt, subsidiaryId }) => {
    const sub = subsidiaryId ? subById.get(subsidiaryId) : undefined;
    const configuredCode = configuredScanCode(sub ?? rep.subsidiary);
    const daysSinceLastCode = daysWithoutLocalScan(last?.at ?? null, now);
    const category = localScanCategory(daysSinceLastCode);
    return {
      id: rep.id,
      trackingNumber: rep.trackingNumber,
      status: rep.status,
      recipientName: rep.recipientName,
      recipientAddress: rep.recipientAddress,
      recipientCity: rep.recipientCity,
      recipientZip: rep.recipientZip,
      recipientPhone: rep.recipientPhone,
      consNumber: rep.consNumber,
      shipmentType: rep.shipmentType,
      fedexUniqueId: rep.fedexUniqueId,
      commitDateTime: rep.commitDateTime ?? null,
      isCharge,
      subsidiaryId,
      subsidiaryName: sub?.name ?? rep.subsidiary?.name,
      scanCode: last?.code ?? configuredCode,
      configuredCode,
      createdAt: minCreatedAt.toISOString(),
      lastCodeDate: last ? last.at.toISOString() : null,
      daysSinceLastCode,
      hasCodeToday: category === 'hoy',
      category,
      statusHistoryCount: historyCount,
      exceptionCodes: Array.from(codes),
    };
  });

  details.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const conCodigoHoy = details.filter((d) => d.category === 'hoy').length;
  const nunca = details.filter((d) => d.category === 'nunca').length;

  return {
    summary: {
      paquetes: details.length,
      conCodigoHoy,
      sinCodigo: details.length - conCodigoHoy - nunca, // excluye "nunca": las tres suman `paquetes`
      nunca,
    },
    details,
  };
}
