/**
 * Data-provider de "Reporte de Choferes" (B3). Espejo de `PackageDispatchService
 * .generateDriverReportExcelLegacy` (armado inline exceljs): NO recalcula agregaciones de
 * negocio, solo consume las filas YA agregadas (`summaryData`, hoja 1) y el detalle plano
 * (`detailsData`, hoja 2) que el service obtiene de `summaryQuery`/`detailsQuery`
 * (`getRawMany()` de TypeORM) y arma la forma que consume la plantilla `driver_report_excel`
 * (fillFromKey por celda para el semáforo de % Efectividad / % Retorno).
 */

const GREEN = '059669';
const AMBER = 'D97706';
const RED = 'E11D48';

/** % Efectividad: verde >=0.90, ámbar >=0.75, rojo el resto. */
export function pctEffColor(pct: number): string {
  if (pct >= 0.9) return GREEN;
  if (pct >= 0.75) return AMBER;
  return RED;
}

/** % Retorno: verde <=0.05, ámbar <=0.15, rojo el resto. */
export function pctRetColor(pct: number): string {
  if (pct <= 0.05) return GREEN;
  if (pct <= 0.15) return AMBER;
  return RED;
}

export interface DriverReportInput {
  startDate: string;
  endDate: string;
  /** Filas crudas de `summaryQuery.getRawMany()` (una por chofer). */
  summaryData: any[];
  /** Filas crudas de `detailsQuery.getRawMany()` (una por paquete). */
  detailsData: any[];
}

function num(v: any): number {
  return Number(v || 0);
}

export function buildDriverReportData(input: DriverReportInput): Record<string, any> {
  const summaryData = input.summaryData ?? [];
  const detailsData = input.detailsData ?? [];

  let sTotal = 0, sDel = 0, sRet = 0, sD03 = 0, sD07 = 0, sD08 = 0, sPen = 0;
  let sFechaReq = 0, sRetFdx = 0, sUnmapped = 0;

  const driverRows: any[] = summaryData.map((r, index) => {
    const rawTotal = num(r.total);
    const rawDel = num(r.delivered);
    const rawRet = num(r.returned);
    const rawD03 = num(r.dex03);
    const rawD07 = num(r.dex07);
    const rawD08 = num(r.dex08);
    const rawPen = num(r.pending);
    const rawFechaReq = num(r.fecharequested ?? r.fechaRequested);
    const rawRetFdx = num(r.returnedfedex ?? r.returnedFedex);
    const rawUnmapped = num(r.unmapped);

    sTotal += rawTotal; sDel += rawDel; sRet += rawRet; sD03 += rawD03; sD07 += rawD07; sD08 += rawD08; sPen += rawPen;
    sFechaReq += rawFechaReq; sRetFdx += rawRetFdx; sUnmapped += rawUnmapped;

    const pctEff = rawTotal > 0 ? rawDel / rawTotal : 0;
    const pctRet = rawTotal > 0 ? rawRet / rawTotal : 0;

    return {
      driverName: r.driverName || r.drivername || 'Sin Chofer',
      total: rawTotal, delivered: rawDel, returned: rawRet,
      dex03: rawD03, dex07: rawD07, dex08: rawD08, pending: rawPen,
      fechaReq: rawFechaReq, retFdx: rawRetFdx, unmapped: rawUnmapped,
      pctEff, pctRet,
      pctEffFill: pctEffColor(pctEff), pctRetFill: pctRetColor(pctRet),
      rowFill: index % 2 === 0 ? 'FFFFFF' : 'F8FAFC',
    };
  });

  if (summaryData.length > 0) {
    const globalEff = sTotal > 0 ? sDel / sTotal : 0;
    const globalRet = sTotal > 0 ? sRet / sTotal : 0;
    // Fila TOTALES GLOBALES: fill uniforme E2E8F0, SIN semáforo por celda (fiel al legacy, que
    // solo colorea la fuente del cierre semáforo en las filas por chofer, no en el total).
    driverRows.push({
      driverName: 'TOTALES GLOBALES',
      total: sTotal, delivered: sDel, returned: sRet,
      dex03: sD03, dex07: sD07, dex08: sD08, pending: sPen,
      fechaReq: sFechaReq, retFdx: sRetFdx, unmapped: sUnmapped,
      pctEff: globalEff, pctRet: globalRet,
      rowFill: 'E2E8F0',
    });
  }

  const detailRows = detailsData.map((row, index) => {
    const statusRaw = row.status || 'desconocido';
    const realStatusRaw = row.realstatus || row.realStatus || statusRaw;
    let displayStatus = String(statusRaw).toUpperCase().replace(/_/g, ' ');
    if ((statusRaw === 'devuelto_a_fedex' || statusRaw === 'retorno_abandono_fedex') && realStatusRaw !== statusRaw) {
      displayStatus = `${displayStatus} (Era: ${String(realStatusRaw).toUpperCase().replace(/_/g, ' ')})`;
    }
    const dex = row.exceptionCode || row.exceptioncode || '-';
    return {
      driver: row.driverName || row.drivername || 'Sin Asignar',
      route: row.routeName || row.routename || 'N/A',
      subsidiary: row.subsidiaryName || row.subsidiaryname || 'N/A',
      tracking: row.tracking,
      status: displayStatus,
      dex,
      dexColor: dex !== '-' ? RED : null,
      commit: row.commitDate ? new Date(row.commitDate).toLocaleDateString('es-MX') : 'Sin Fecha',
      cp: row.cp || 'S/C',
      recipient: row.recipient || 'Sin Nombre',
      rowFill: index % 2 === 0 ? 'FFFFFF' : 'F8FAFC',
    };
  });

  return {
    periodLabel: `Periodo Analizado: ${String(input.startDate || '').split('T')[0]} al ${String(input.endDate || '').split('T')[0]}`,
    driverRows,
    detailRows,
  };
}
