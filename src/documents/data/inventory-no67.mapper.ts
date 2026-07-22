import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TZ = 'America/Hermosillo';

/** Rangos de "días en sistema" fieles a `InventoriesService.calculateDayStats` (legacy inline). */
const DAY_RANGES: { range: string; min: number; max: number }[] = [
  { range: '0-7 días', min: 0, max: 7 },
  { range: '8-30 días', min: 8, max: 30 },
  { range: '31-90 días', min: 31, max: 90 },
  { range: '91-180 días', min: 91, max: 180 },
  { range: 'Más de 180 días', min: 181, max: Infinity },
];

export interface InventoryNo67Detail {
  trackingNumber: string;
  currentStatus: string;
  statusHistoryCount: number;
  exceptionCodes: string[];
  firstStatusDate?: Date | string | null;
  lastStatusDate?: Date | string | null;
  daysInSystem: number | null;
  comment: string;
}

export interface InventoryNo67Input {
  summary: {
    totalShipments: number;
    withoutCode67: number;
    withCode67: number;
    inventoryDate?: Date | string | null;
    percentageWithout67: number;
    inventoryId?: string | null;
  };
  details: InventoryNo67Detail[];
  now?: Date;
}

function fmtDateTime(d?: Date | string | null): string {
  if (!d) return '';
  return format(toZonedTime(new Date(d), TZ), 'dd/MM/yyyy HH:mm');
}

/** `buildInventoryNo67Data` — data-provider de "Shipments sin código 67" (inventario §B5).
 * Espejo de `InventoriesService.generateExcelReport` (helpers `addSummarySheet`/`addDetailsSheet`
 * /`addStatisticsSheet`). Recibe los shipments-sin-67 ya calculados por el service
 * (mismo shape que `checkInventory67BySubsidiary`). */
export function buildInventoryNo67Data(input: InventoryNo67Input): Record<string, any> {
  const now = input.now ?? new Date();
  const summary = input.summary ?? {
    totalShipments: 0,
    withoutCode67: 0,
    withCode67: 0,
    percentageWithout67: 0,
  };
  const details = input.details ?? [];

  // ---- Hoja 2: Detalles ----
  const detailRows = details.map((d, i) => ({
    index: i + 1,
    trackingNumber: d.trackingNumber,
    currentStatus: d.currentStatus,
    statusHistoryCount: d.statusHistoryCount,
    exceptionCodes: (d.exceptionCodes ?? []).join(', '),
    firstStatusDate: fmtDateTime(d.firstStatusDate),
    lastStatusDate: fmtDateTime(d.lastStatusDate),
    daysInSystem: d.daysInSystem ?? '',
    comment: d.comment || '',
    rowFill: i % 2 === 1 ? 'F2F2F2' : null,
  }));

  // ---- Hoja 3: distribución por estado ----
  const statusMap = new Map<string, number>();
  for (const d of details) statusMap.set(d.currentStatus, (statusMap.get(d.currentStatus) || 0) + 1);
  const total = details.length;
  const statusStatsRows = Array.from(statusMap.entries())
    .map(([status, count]) => ({
      status,
      count,
      percentage: `${total > 0 ? Math.round((count / total) * 1000) / 10 : 0}%`,
    }))
    .sort((a, b) => b.count - a.count);

  // ---- Hoja 3: distribución por días ----
  const dayCounts = DAY_RANGES.map(() => 0);
  let sinFecha = 0;
  for (const d of details) {
    const days = d.daysInSystem;
    if (days === null || days === undefined) {
      sinFecha++;
      continue;
    }
    const idx = DAY_RANGES.findIndex((r) => days >= r.min && days <= r.max);
    if (idx >= 0) dayCounts[idx]++;
  }
  const dayStatsRows = [
    ...DAY_RANGES.map((r, i) => ({ range: r.range, count: dayCounts[i] })),
    { range: 'Sin fecha', count: sinFecha },
  ];

  return {
    generatedAt: fmtDateTime(now),
    inventoryDateLabel: summary.inventoryDate ? fmtDateTime(summary.inventoryDate) : 'N/A',
    inventoryId: summary.inventoryId || 'N/A',
    totalShipments: summary.totalShipments ?? 0,
    withoutCode67: summary.withoutCode67 ?? 0,
    withCode67: summary.withCode67 ?? 0,
    percentageWithout67Label: `${summary.percentageWithout67 ?? 0}%`,
    detailRows,
    statusStatsRows,
    dayStatsRows,
  };
}
