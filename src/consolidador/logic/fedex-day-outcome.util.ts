import { toHermosilloDateString } from 'src/common/utils';
import { DayOutcome, FedexLive, Mark } from './manual-count.types';

/**
 * De los `trackResults` de FedEx, la generación más reciente (secuencia del UniqueID más
 * alta). Una guía reciclada trae varias generaciones; la vigente es la de mayor secuencia.
 * Misma selección que usa el cierre de ruta.
 */
export function selectLatestGeneration(results: any[]): any | null {
  if (!results?.length) return null;
  if (results.length === 1) return results[0];
  const seq = (r: any) => parseInt(r?.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0', 10);
  return [...results].sort((a, b) => seq(b) - seq(a))[0];
}

const PRIORITY: Mark[] = ['POD', '07', '08']; // entregado gana a DEX; 07 gana a 08

/** Mark de un scan de FedEx: DL → POD; DE con 07/08 → ese código; lo demás → null. */
function markOf(scan: any): Mark | null {
  if (scan?.eventType === 'DL') return 'POD';
  if (scan?.eventType === 'DE') {
    const code = String(scan?.exceptionCode ?? '').trim();
    if (code === '07' || code === '08') return code;
  }
  return null;
}

/**
 * Desenlace de la guía en `day` (día Hermosillo) según los scans de FedEx. Solo cuentan
 * los eventos de ese día: POD > 07 > 08; otros eventos → `OTRO`; ninguno → `null`.
 * `dex08Dates` trae TODOS los 08 (cualquier día) para la regla de 3 visitas por semana.
 */
export function extractFedexDayOutcome(trackResult: any, day: string): FedexLive {
  const scans: any[] = trackResult?.scanEvents ?? [];
  if (!trackResult) return { ok: false, outcome: null, outcomeAt: null, dex08Dates: [], lastCode: null, latestOutcome: null };

  const dated = scans
    .filter((s) => s?.date && !Number.isNaN(new Date(s.date).getTime()))
    .map((s) => ({ s, at: new Date(s.date) }));

  const dex08Dates = dated
    .filter(({ s }) => markOf(s) === '08')
    .map(({ at }) => at.toISOString());

  const ofDay = dated.filter(({ at }) => toHermosilloDateString(at) === day);
  let outcome: DayOutcome = ofDay.length ? 'OTRO' : null;
  let outcomeAt: string | null = null;
  for (const mark of PRIORITY) {
    const hit = ofDay.filter(({ s }) => markOf(s) === mark).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    if (hit) {
      outcome = mark;
      outcomeAt = hit.at.toISOString();
      break;
    }
  }

  const latest = [...dated].sort((a, b) => b.at.getTime() - a.at.getTime())[0]?.s;
  const lastCode = latest ? `${latest.eventType ?? ''}${latest.exceptionCode ? ` ${latest.exceptionCode}` : ''}`.trim() : null;

  const latestOutcome: DayOutcome = latest ? markOf(latest) ?? 'OTRO' : null;

  return { ok: true, outcome, outcomeAt, dex08Dates, lastCode, latestOutcome };
}
