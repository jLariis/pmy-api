import {
  ChainStep,
  CollectionCause,
  CollectionFacts,
  CollectionReport,
  CollectionRow,
  Verdict,
  VERDICTS,
} from './manual-count.types';

/**
 * Diagnóstico de UNA recolección del "Conteo manual vs sistema". Puro (sin I/O).
 *
 * Cadena: registrada como recolección → en esta sucursal → ese día → FedEx la marcó
 * "Picked up" ese día → cobro (31.5 no cobra; uno solo, con el costo de la sucursal y del
 * mismo día) → contada por el usuario. La CAUSA es el primer eslabón roto; FedEx solo
 * decide si un faltante es del sistema o del conteo.
 */

export const COLLECTION_CAUSE_TEXT: Record<CollectionCause, string> = {
  REC_NO_EXISTE: 'No está registrada como recolección',
  REC_OTRA_SUCURSAL: 'Registrada en otra sucursal',
  REC_OTRO_DIA: 'Registrada otro día',
  REC_FALTA_CONTEO: 'Falta en el conteo',
  REC_SIN_COBRO: 'Falta el cobro',
  REC_DUPLICADO: 'Cobro duplicado',
  REC_MONTO: 'Monto incorrecto',
  REC_COBRO_OTRO_DIA: 'Cobro en otro día',
  REC_COBRO_315: 'Cobro de más (ruta 31.5)',
  REC_REGLA_315: 'Ruta 31.5: no se cobra',
};

/** 'YYYY-MM-DD' → '08/10'. */
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const money = (n: number) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function diagnoseCollection(
  counted: boolean,
  f: CollectionFacts,
  ctx: { day: string; subsidiaryId: string; expectedCost: number },
): CollectionRow {
  const { day, subsidiaryId, expectedCost } = ctx;
  const here = f.registrations.filter((r) => r.subsidiaryId === subsidiaryId);
  const registeredThatDay = here.some((r) => r.day === day);
  const active = f.incomes.filter((i) => i.active);
  const fedexOk = !!f.fedex?.ok;
  const pickedUpDay = fedexOk ? f.fedex!.pickedUpDay : null;
  const pickedUpThatDay = pickedUpDay === day;

  const systemLabel = !f.registrations.length
    ? 'No registrada'
    : !here.length
      ? 'Registrada en otra sucursal'
      : `Registrada el ${[...new Set(here.map((r) => dm(r.day)))].join(', ')}`;
  const fedexLabel = !f.fedex || !f.fedex.ok
    ? 'FedEx no respondió'
    : pickedUpDay ? `Recolectada el ${dm(pickedUpDay)}` : 'Sin recolección en FedEx';
  const chargedLabel = active.length ? active.map((i) => `${money(i.cost)} el ${dm(i.day)}`).join(' + ') : 'Sin cobro';

  const chain: ChainStep[] = [
    { step: 1, label: 'Registrada como recolección', ok: f.registrations.length > 0, detail: f.registrations.length ? 'Sí' : 'No aparece en recolecciones' },
    { step: 2, label: 'En esta sucursal', ok: f.registrations.length ? here.length > 0 : null, detail: here.length ? 'Sí' : f.registrations.length ? 'Está en otra sucursal' : '—' },
    { step: 3, label: 'Del día revisado', ok: here.length ? registeredThatDay : null, detail: here.length ? systemLabel : '—' },
    { step: 4, label: 'FedEx la recolectó ese día', ok: fedexOk ? pickedUpThatDay : null, detail: fedexLabel },
    {
      step: 5,
      label: 'Cobro',
      ok: f.is315 ? active.length === 0 : active.length === 1 && active[0].cost === expectedCost && active[0].day === day,
      detail: f.is315 ? `Ruta 31.5 (no se cobra) · ${chargedLabel}` : `${chargedLabel} (esperado ${money(expectedCost)} el ${dm(day)})`,
    },
    { step: 6, label: 'En el conteo', ok: counted, detail: counted ? 'Sí' : 'No la contaron' },
  ];

  let verdict = 'CUADRA' as Verdict;
  let cause = null as CollectionCause | null;
  let explanation = 'Contada, registrada y cobrada ese día.';
  const set = (v: Verdict, c: CollectionCause, why: string) => { verdict = v; cause = c; explanation = why; };

  if (!f.registrations.length) {
    if (pickedUpThatDay) set('ERROR_SISTEMA', 'REC_NO_EXISTE', 'FedEx la marca recolectada ese día pero no está registrada como recolección.');
    else set('ERROR_CONTEO', 'REC_NO_EXISTE', 'No está registrada y FedEx no la marca recolectada ese día: revisa el conteo.');
  } else if (!here.length) {
    set('ERROR_SISTEMA', 'REC_OTRA_SUCURSAL', 'Está registrada como recolección en otra sucursal.');
  } else if (!registeredThatDay) {
    if (pickedUpThatDay) set('ERROR_SISTEMA', 'REC_OTRO_DIA', `FedEx la recolectó el ${dm(day)} pero se registró el ${here.map((r) => dm(r.day)).join(', ')}.`);
    else set('ERROR_CONTEO', 'REC_OTRO_DIA', `Se registró el ${here.map((r) => dm(r.day)).join(', ')}; el conteo la pone el ${dm(day)}.`);
  } else if (f.is315) {
    if (active.length) set('ERROR_SISTEMA', 'REC_COBRO_315', 'Vino en una ruta 31.5, donde las recolecciones no se cobran, y tiene cobro.');
    else set('REGLA', 'REC_REGLA_315', 'Vino en una ruta 31.5: las recolecciones no se cobran.');
  } else if (active.length === 0) {
    set('ERROR_SISTEMA', 'REC_SIN_COBRO', 'Está registrada pero no tiene cobro de recolección.');
  } else if (active.length > 1) {
    set('ERROR_SISTEMA', 'REC_DUPLICADO', `Tiene ${active.length} cobros de recolección activos.`);
  } else if (active[0].cost !== expectedCost) {
    set('ERROR_SISTEMA', 'REC_MONTO', `Se cobró ${money(active[0].cost)}; el costo de la sucursal es ${money(expectedCost)}.`);
  } else if (active[0].day !== day) {
    set('ERROR_SISTEMA', 'REC_COBRO_OTRO_DIA', `El cobro quedó el ${dm(active[0].day)}, no el ${dm(day)}.`);
  }
  // Lo del sistema que nadie contó: si el sistema está bien, la diferencia es del conteo.
  if (!counted && verdict === 'CUADRA') set('ERROR_CONTEO', 'REC_FALTA_CONTEO', 'Está registrada y cobrada ese día, pero no viene en el conteo.');
  else if (!counted && verdict === 'REGLA') set('ERROR_CONTEO', 'REC_FALTA_CONTEO', 'Está registrada ese día (ruta 31.5, no se cobra), pero no viene en el conteo.');
  else if (!counted) explanation += ' Además no viene en el conteo.';

  return {
    trackingNumber: f.trackingNumber,
    day,
    counted,
    systemLabel,
    fedexLabel,
    chargedLabel,
    pickedUpThatDay,
    chargedCount: active.length,
    verdict,
    cause,
    explanation,
    chain,
    incomeIds: active.map((i) => i.id),
  };
}

/** Revisión por semana: a qué día va una recolección contada (registro aquí > FedEx > lunes). */
export function collectionDayOf(f: CollectionFacts, subsidiaryId: string, days: string[]): string {
  const reg = f.registrations.find((r) => r.subsidiaryId === subsidiaryId && days.includes(r.day));
  if (reg) return reg.day;
  const fx = f.fedex?.ok ? f.fedex.pickedUpDay : null;
  if (fx && days.includes(fx)) return fx;
  return days[0];
}

export function summarizeCollections(rows: CollectionRow[]): CollectionReport['totals'] {
  const byVerdict = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
  let manual = 0, fedex = 0, charged = 0;
  for (const r of rows) {
    if (r.counted) manual++;
    if (r.pickedUpThatDay) fedex++;
    if (r.chargedCount > 0) charged++;
    byVerdict[r.verdict]++;
  }
  return { manual, fedex, charged, byVerdict };
}

/**
 * Día (Hermosillo) en que FedEx marcó la guía "Picked up" (evento PU, el primero), o null.
 * Recibe el trackResult ya elegido (generación vigente).
 */
export function pickedUpDayOf(track: any, toLocalDay: (d: Date) => string): string | null {
  const pu = (track?.scanEvents ?? [])
    .filter((e: any) => String(e?.eventType ?? '').toUpperCase() === 'PU' && e?.date)
    .map((e: any) => new Date(e.date))
    .filter((d: Date) => !isNaN(d.getTime()))
    .sort((a: Date, b: Date) => a.getTime() - b.getTime());
  return pu.length ? toLocalDay(pu[0]) : null;
}
