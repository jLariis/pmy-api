import { isoWeekKey } from 'src/common/dex08-week.util';
import { toHermosilloDateString } from 'src/common/utils';
import {
  Cause,
  ChainStep,
  DayOutcome,
  DiagnoseContext,
  DiagnosisRow,
  GuideFacts,
  Mark,
  MARKS,
  ManualCountTotals,
  Verdict,
  VERDICTS,
} from './manual-count.types';

/**
 * Diagnóstico de UNA guía del "Conteo manual vs sistema". Puro (sin I/O).
 *
 * Recorre la cadena de validaciones (existe → consolidado → ruta → mismo día → FedEx →
 * reglas de cobro → ingreso → conteo del usuario). La cadena se llena completa para
 * mostrarla; la CAUSA es el primer eslabón roto. Las reglas de cobro son las reales:
 * charge_rule (vía `ctx.isChargeable`), 31.5 no cobra, DEX08 = 3er día distinto con 08
 * de la semana ISO, devolución anula el entregado, entregado en bodega no necesita ruta.
 */

export const MARK_LABEL: Record<Mark, string> = { POD: 'POD', '07': 'DEX07', '08': 'DEX08' };

const isMark = (o: DayOutcome): o is Mark => o === 'POD' || o === '07' || o === '08';
const label = (o: DayOutcome): string => (isMark(o) ? MARK_LABEL[o] : o === 'OTRO' ? 'otro estatus' : 'sin desenlace');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Visitas 08 de la semana ISO de `day` (días Hermosillo distintos) y si `day` es
 * justo el 3er día — el único día en que el cobro DEX08 corresponde.
 */
export function dex08WeekStatus(dates: string[], day: string): { visitsToDay: number; chargeDay: string | null } {
  const weekOf = (d: string) => isoWeekKey(new Date(`${d}T12:00:00`));
  const week = weekOf(day);
  const days = [...new Set(dates.map((iso) => toHermosilloDateString(new Date(iso))))]
    .filter((d) => weekOf(d) === week)
    .sort();
  return { visitsToDay: days.filter((d) => d <= day).length, chargeDay: days[2] ?? null };
}

export function diagnoseGuide(manual: Mark | null, f: GuideFacts, ctx: DiagnoseContext): DiagnosisRow {
  const { day } = ctx;
  const chain: ChainStep[] = [];
  let cause: Cause | null = null;
  let subCause: string | null = null;
  let explanation = '';
  const push = (step: number, lbl: string, ok: boolean | null, detail: string) => chain.push({ step, label: lbl, ok, detail });
  /** Marca el eslabón roto; solo el primero define la causa. */
  const breakAt = (c: Cause, why: string, sub: string | null = null) => {
    if (cause) return;
    cause = c;
    explanation = why;
    subCause = sub;
  };

  const fedexOk = !!f.fedex?.ok;
  const fedexSays: DayOutcome = fedexOk ? f.fedex!.outcome : null;
  const truth: DayOutcome = fedexOk ? f.fedex!.outcome : f.systemOutcome;
  const dayIncomes = f.incomes.filter((i) => i.active && i.day === day);
  const charged = dayIncomes.map((i) => i.mark).filter((m): m is Mark => !!m);

  // 1. Existe y es de la sucursal.
  if (!f.kind) {
    push(1, 'Existe en la sucursal', false, 'La guía no está registrada en el sistema.');
    breakAt('NO_EXISTE', 'La guía no existe en el sistema: nunca se registró.');
  } else if (f.subsidiaryId !== ctx.subsidiaryId && !f.transferredIn) {
    push(1, 'Existe en la sucursal', false, 'La guía pertenece a otra sucursal y no hay traspaso.');
    breakAt('OTRA_SUCURSAL', 'La guía está registrada en otra sucursal.');
  } else {
    push(1, 'Existe en la sucursal', true, f.transferredIn ? 'Llegó por traspaso.' : 'Registrada en la sucursal.');
  }

  // Carga F2: se cobra agrupada por carga, no por guía → solo se compara el conteo.
  if (f.kind === 'charge') {
    for (const [s, l] of [[2, 'Consolidado registrado'], [3, 'Salió a ruta'], [4, 'Ruta del mismo día'], [6, 'Reglas de cobro'], [7, 'Ingreso registrado']] as const) {
      push(s, l, null, 'Carga F2: se cobra por carga, no por guía.');
    }
    push(5, 'FedEx en vivo', fedexOk ? true : null, fedexOk ? `FedEx dice ${label(fedexSays)}.` : 'FedEx no respondió.');
    chain.sort((a, b) => a.step - b.step);
    const counted = manual === truth || (!manual && !isMark(truth));
    push(8, 'Conteo del usuario', counted, counted ? 'El conteo coincide.' : `Contó ${manual ? MARK_LABEL[manual] : 'nada'}, el desenlace es ${label(truth)}.`);
    return {
      trackingNumber: f.trackingNumber, manual, fedexSays, systemSays: f.systemOutcome, charged: [], expected: null,
      verdict: counted ? 'CUADRA' : 'ERROR_CONTEO', cause: counted ? null : 'F2_INFORMATIVO', subCause: null,
      explanation: counted ? 'Carga F2: el conteo coincide (el cobro es por carga).' : `Carga F2: contó ${manual ? MARK_LABEL[manual] : 'nada'} pero el desenlace es ${label(truth)}.`,
      chain, cost: null, incomeIds: [],
    };
  }

  // 2. Consolidado registrado (nos dieron el paquete) con fecha ≤ día.
  if (!f.kind) push(2, 'Consolidado registrado', null, 'No aplica.');
  else if (!f.consolidado || (f.consolidado.day && f.consolidado.day > day)) {
    const why = !f.consolidado ? 'No hay consolidado registrado para la guía.' : `El consolidado se registró el ${f.consolidado.day}, después del día.`;
    push(2, 'Consolidado registrado', false, why);
    breakAt('SIN_CONSOLIDADO', `No hay constancia de que nos entregaran el paquete a tiempo: ${why}`);
  } else push(2, 'Consolidado registrado', true, `Consolidado ${f.consolidado.consNumber ?? ''} del ${f.consolidado.day ?? '—'}.`.replace('  ', ' '));

  // 3–4. Salió a ruta, y la ruta es del mismo día que el desenlace.
  const routesToday = f.routes.filter((r) => r.routeDay === day);
  if (!f.kind || !isMark(truth)) {
    push(3, 'Salió a ruta', null, 'Sin desenlace cobrable ese día.');
    push(4, 'Ruta del mismo día', null, 'Sin desenlace cobrable ese día.');
  } else if (f.warehouseDelivered && truth === 'POD') {
    push(3, 'Salió a ruta', null, 'Entregado en bodega: no necesita ruta.');
    push(4, 'Ruta del mismo día', null, 'Entregado en bodega.');
  } else if (!f.routes.length) {
    push(3, 'Salió a ruta', false, 'La guía nunca estuvo en una salida a ruta.');
    push(4, 'Ruta del mismo día', null, 'Sin ruta.');
    breakAt('SIN_RUTA', `FedEx reporta ${label(truth)} pero la guía nunca salió a ruta con nosotros.`);
  } else if (!routesToday.length) {
    const other = f.routes.map((r) => `${r.folio ?? 'ruta'} (${r.routeDay ?? '—'})`).join(', ');
    push(3, 'Salió a ruta', true, `Rutas: ${other}.`);
    push(4, 'Ruta del mismo día', false, `Ninguna ruta es del ${day}.`);
    breakAt('RUTA_OTRO_DIA', `El desenlace ${label(truth)} es del ${day} pero la ruta salió otro día: ${other}.`);
  } else {
    const r = routesToday.map((x) => x.folio ?? 'ruta').join(', ');
    push(3, 'Salió a ruta', true, `Ruta ${r}.`);
    push(4, 'Ruta del mismo día', true, `La ruta es del ${day}.`);
  }

  // 5. FedEx en vivo vs nuestro estatus.
  if (!f.kind) push(5, 'FedEx en vivo', null, 'No aplica.');
  else if (!fedexOk) push(5, 'FedEx en vivo', null, 'FedEx no respondió; se usa el estatus del sistema.');
  else if (isMark(truth) && f.systemOutcome !== truth) {
    push(5, 'FedEx en vivo', false, `FedEx dice ${label(truth)}, el sistema tiene ${label(f.systemOutcome)}.`);
    breakAt('ESTATUS_DESFASADO', `Nuestro estatus está desfasado: FedEx dice ${label(truth)} y el sistema tiene ${label(f.systemOutcome)}.`);
  } else push(5, 'FedEx en vivo', true, `FedEx dice ${label(fedexSays)}.`);

  // 6. Reglas de cobro → qué se esperaba cobrar ese día.
  let expected: Mark | null = null;
  let noChargeWhy: string | null = null;
  const route315 = routesToday.some((r) => r.is315);
  if (!f.kind || !isMark(truth)) {
    noChargeWhy = 'no hay desenlace cobrable ese día';
  } else if (route315) {
    noChargeWhy = 'la ruta es 31.5 (no cobra por guía)';
  } else if (truth === 'POD') {
    if (f.returned) noChargeWhy = 'la devolución anula el ingreso de entregado';
    else if (!ctx.isChargeable('DELIVERED')) noChargeWhy = 'la regla de cobro de la sucursal no cobra entregados';
    else expected = 'POD';
  } else if (truth === '07') {
    if (!ctx.isChargeable('07')) noChargeWhy = 'la regla de cobro de la sucursal no cobra DEX07';
    else expected = '07';
  } else {
    const dates = [...new Set([...(f.fedex?.dex08Dates ?? []), ...f.systemDex08Dates])];
    const { visitsToDay, chargeDay } = dex08WeekStatus(dates, day);
    if (chargeDay !== day) {
      noChargeWhy = chargeDay && chargeDay < day
        ? `DEX08 ya cumplió sus 3 visitas el ${chargeDay} (se cobra una vez por semana)`
        : `DEX08 con ${plural(visitsToDay, 'visita', 'visitas')} en la semana (necesita 3 días distintos)`;
    } else if (!ctx.isChargeable('08')) noChargeWhy = 'la regla de cobro de la sucursal no cobra DEX08';
    else expected = '08';
  }
  push(6, 'Reglas de cobro', f.kind ? true : null, expected ? `Debe cobrar ${MARK_LABEL[expected]}.` : `No cobra: ${noChargeWhy}.`);

  // 7. Lo cobrado.
  const markCount = new Map<Mark, number>();
  for (const m of charged) markCount.set(m, (markCount.get(m) ?? 0) + 1);
  const dup = [...markCount.entries()].find(([, n]) => n > 1);
  const chargedTxt = charged.length ? charged.map((m) => MARK_LABEL[m]).join(' + ') : 'nada';
  let incomeOk: boolean | null = true;
  let incomeDetail = `Cobrado: ${chargedTxt}.`;
  if (!f.kind) {
    incomeOk = null;
    incomeDetail = 'No aplica.';
  } else if (dup) {
    incomeOk = false;
    breakAt('DUPLICADO', `La guía tiene ${dup[1]} ingresos de ${MARK_LABEL[dup[0]]} el mismo día.`);
  } else if (!expected && charged.length) {
    incomeOk = false;
    breakAt('COBRO_DE_MAS', `Se cobró ${chargedTxt} pero no debía cobrar: ${noChargeWhy}.`, capitalize(noChargeWhy));
  } else if (expected && charged.length && !charged.includes(expected)) {
    incomeOk = false;
    breakAt('COBRO_DE_MAS', `Se cobró ${chargedTxt} pero debía cobrar ${MARK_LABEL[expected]}.`, `Cobró ${chargedTxt}, debía ${MARK_LABEL[expected]}`);
  } else if (expected && !charged.length) {
    incomeOk = false;
    const otherDay = f.incomes.find((i) => i.active && i.mark === expected && i.day !== day);
    if (otherDay) {
      breakAt('INGRESO_OTRO_DIA', `El ingreso de ${MARK_LABEL[expected]} existe pero quedó con fecha ${otherDay.day}.`);
    } else {
      const annulled = f.incomes.some((i) => !i.active && i.mark === expected && i.day === day);
      const openRoute = routesToday.length > 0 && routesToday.every((r) => !r.closed);
      const sub = annulled ? 'El ingreso se anuló' : openRoute ? 'La ruta no tiene cierre' : 'El cierre no generó el ingreso';
      breakAt('COBRO_FALTANTE', `Debía cobrar ${MARK_LABEL[expected]} y no hay ingreso: ${sub.toLowerCase()}.`, sub);
    }
  } else {
    const wrongCost = ctx.expectedCost > 0 ? dayIncomes.find((i) => Number(i.cost) !== ctx.expectedCost) : undefined;
    if (wrongCost) {
      incomeOk = false;
      breakAt('MONTO_INCORRECTO', `El ingreso es de $${Number(wrongCost.cost)} y el costo de la sucursal es $${ctx.expectedCost}.`);
    }
  }
  push(7, 'Ingreso registrado', incomeOk, incomeDetail);

  // 8. Conteo del usuario (solo define el veredicto si el sistema está bien).
  const countOk = manual === expected || (!manual && !expected);
  push(8, 'Conteo del usuario', countOk, countOk ? 'El conteo coincide.' : `Contó ${manual ? MARK_LABEL[manual] : 'nada'}, se esperaba ${expected ? MARK_LABEL[expected] : 'no cobrar'}.`);

  let verdict: Verdict;
  if (cause) verdict = 'ERROR_SISTEMA';
  else if (countOk) {
    verdict = 'CUADRA';
    explanation = expected ? `Cuadra: ${MARK_LABEL[expected]} contado y cobrado.` : 'Cuadra: no cobra y no se contó.';
  } else if (manual && manual === truth && !expected) {
    verdict = 'REGLA';
    cause = 'REGLA_NO_COBRA';
    subCause = capitalize(noChargeWhy);
    explanation = `Contó ${MARK_LABEL[manual]} y FedEx lo confirma, pero por regla no cobra: ${noChargeWhy}.`;
  } else {
    verdict = 'ERROR_CONTEO';
    cause = 'ERROR_CONTEO';
    explanation = !manual
      ? `El usuario no la contó, pero corresponde ${MARK_LABEL[expected!]} y así está cobrada.`
      : `Contó ${MARK_LABEL[manual]} pero FedEx dice ${label(truth)}${expected ? ` y se cobró ${MARK_LABEL[expected]}` : ''}.`;
  }

  return {
    trackingNumber: f.trackingNumber,
    manual,
    fedexSays,
    systemSays: f.systemOutcome,
    charged,
    expected,
    verdict,
    cause,
    subCause,
    explanation,
    chain,
    cost: dayIncomes.length ? Number(dayIncomes[0].cost) : null,
    incomeIds: dayIncomes.map((i) => i.id),
  };
}

function capitalize(s: string | null): string | null {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const zeroMarks = (): Record<Mark, number> => ({ POD: 0, '07': 0, '08': 0 });

export function summarize(rows: DiagnosisRow[]): ManualCountTotals {
  const t: ManualCountTotals = {
    manual: zeroMarks(),
    fedex: zeroMarks(),
    charged: zeroMarks(),
    byVerdict: Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>,
  };
  for (const r of rows) {
    if (r.manual) t.manual[r.manual]++;
    if (isMark(r.fedexSays)) t.fedex[r.fedexSays]++;
    for (const m of r.charged) if (MARKS.includes(m)) t.charged[m]++;
    t.byVerdict[r.verdict]++;
  }
  return t;
}
