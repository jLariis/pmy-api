import { Cause, DiagnosisRow, ManualCountReport, Mark, MARKS } from './manual-count.types';
import { MARK_LABEL } from './manual-count-diagnose.util';

/**
 * Prompt determinista (sin IA, mismo reporte → mismo texto) para corregir en Claude Code
 * los errores DEL SISTEMA que encontró el "Conteo manual vs sistema". Patrón de
 * `support/prompt-builder`. Los errores de conteo y las reglas no entran: no son bugs.
 */

export interface CauseCodeInfo {
  title: string;
  files: string[];
  hint: string;
}

/** Causa → qué es, archivos/funciones donde suele vivir, y pista para diagnosticar. */
export const CAUSE_CODE_MAP: Partial<Record<Cause, CauseCodeInfo>> = {
  COBRO_DE_MAS: {
    title: 'Cobro de más (ingreso sin regla que lo respalde)',
    files: [
      'src/routeclosure/routeclosure.service.ts (reconcileRouteIncome, ingresos No VAN)',
      'src/routeclosure/novan-income.util.ts (noVanIncomeDecision)',
      'src/shipments/shipments.service.ts (processMasterFedexUpdate)',
      'src/tracking-sync/rules/income.chargeable.ts',
      'src/common/dex08-week.util.ts',
      'src/charge-rules/charge-rules.service.ts',
    ],
    hint: 'Identifica qué camino creó el ingreso (createdById = usuario → cierre de ruta; sin usuario → cron/motor; sourceEventKey → motor nuevo) y por qué no aplicó la regla.',
  },
  COBRO_FALTANTE: {
    title: 'Cobro faltante (debía cobrar y no hay ingreso)',
    files: [
      'src/routeclosure/routeclosure.service.ts (create, reconcileRouteIncome)',
      'src/routeclosure/income-reconcile.util.ts',
      'src/tracking-sync/income/income-executor.ts',
      'src/pick-up/pick-up.service.ts (entregado en bodega)',
    ],
    hint: 'Revisa si la ruta se cerró, si el ingreso existió y se anuló (annulledAt), y qué guard lo omitió.',
  },
  INGRESO_OTRO_DIA: {
    title: 'Ingreso con fecha de otro día',
    files: [
      'src/common/income-window.util.ts',
      'src/common/utils.ts (hermosilloDayStartFromInstant, toHermosilloDateString)',
      'src/routeclosure/routeclosure.service.ts (routeIncomeDate)',
    ],
    hint: 'Compara income.date contra package_dispatch.routeDate y el instante del evento FedEx; cuidado con día-solo 00:00Z vs instante.',
  },
  DUPLICADO: {
    title: 'Ingreso duplicado el mismo día',
    files: [
      'src/routeclosure/routeclosure.service.ts (guards anti-duplicado)',
      'src/tracking-sync/income/income-executor.ts (sourceEventKey)',
      'src/shipments/shipments.service.ts (generateIncomes)',
    ],
    hint: 'Busca qué dos caminos crearon los ingresos (createdAt/createdById/sourceEventKey) y falta de guard entre ellos.',
  },
  MONTO_INCORRECTO: {
    title: 'Monto distinto al costo de la sucursal',
    files: ['src/routeclosure/routeclosure.service.ts', 'src/consolidador/income/consolidador-income.service.ts'],
    hint: 'Compara income.cost con subsidiary.fedexCostPackage al momento de crear el ingreso (¿cambió el costo o se editó?).',
  },
  ESTATUS_DESFASADO: {
    title: 'Estatus del sistema desfasado respecto a FedEx',
    files: [
      'src/tracking-sync/tracking-compare.service.ts',
      'src/tracking-sync/rules/time-shield.rule.ts',
      'src/shipments/shipments.service.ts (processMasterFedexUpdate)',
      'src/routeclosure/routeclosure.service.ts (reconciliación al abrir el cierre)',
    ],
    hint: 'Revisa shipment_status de la guía contra los scanEvents de FedEx; posible Time Shield o flag allowSameDayPreRegistrationFedexEvents de la sucursal.',
  },
  SIN_RUTA: {
    title: 'FedEx reporta desenlace pero la guía nunca salió a ruta',
    files: ['src/package-dispatch/package-dispatch.service.ts', 'src/pick-up/pick-up.service.ts'],
    hint: 'Revisa package_dispatch_history; puede ser entrega en bodega no registrada o una salida que no guardó la guía.',
  },
  RUTA_OTRO_DIA: {
    title: 'La ruta salió en un día distinto al desenlace',
    files: ['src/package-dispatch/package-dispatch.service.ts (routeDate)', 'src/routeclosure/routeclosure.service.ts'],
    hint: 'Compara package_dispatch.routeDate con el día Hermosillo del evento FedEx.',
  },
  SIN_CONSOLIDADO: {
    title: 'Guía sin consolidado registrado a tiempo',
    files: ['src/consolidated/consolidated.service.ts', 'src/shipments/shipments.service.ts (addConsMasterBySubsidiary)'],
    hint: 'Revisa si la guía se registró sin consolidatedId o si el consolidado quedó con fecha posterior.',
  },
  NO_EXISTE: {
    title: 'Guía contada que no existe en el sistema',
    files: ['src/shipments/shipments.service.ts (subida/pegado de consolidados)', 'src/import-files'],
    hint: 'Verifica si la guía venía en el archivo/pegado de FedEx del día y por qué no se insertó.',
  },
  OTRA_SUCURSAL: {
    title: 'Guía registrada en otra sucursal',
    files: ['src/package-transfer', 'src/shipments/shipments.service.ts'],
    hint: 'Revisa si faltó un traspaso (package_transfer) o si la guía se dio de alta en la sucursal equivocada.',
  },
};

const SYSTEM_EXCLUDED: Cause[] = ['ERROR_CONTEO', 'REGLA_NO_COBRA', 'F2_INFORMATIVO', 'ENTREGADO_OTRO_DIA'];
const MAX_EXAMPLES = 10;

const markLine = (label: string, rec: Record<Mark, number>) =>
  `| ${label} | ${MARKS.map((m) => rec[m]).join(' | ')} |`;

const outcomeTxt = (o: DiagnosisRow['fedexSays']) =>
  o === 'POD' || o === '07' || o === '08' ? MARK_LABEL[o] : o === 'OTRO' ? 'otro' : '—';

function exampleLine(r: DiagnosisRow): string {
  // El eslabón 8 (conteo del usuario) no es parte del error del sistema.
  const broken = r.chain.filter((s) => s.ok === false && s.step !== 8).map((s) => `${s.label}: ${s.detail}`).join(' · ');
  const sub = r.subCause && !r.explanation.toLowerCase().includes(r.subCause.toLowerCase()) ? ` (${r.subCause})` : '';
  return [
    `- \`${r.trackingNumber}\` — contó ${r.manual ? MARK_LABEL[r.manual] : 'nada'}, FedEx ${outcomeTxt(r.fedexSays)}, sistema ${outcomeTxt(r.systemSays)}, cobrado ${r.charged.map((m) => MARK_LABEL[m]).join('+') || 'nada'}.`,
    `  ${r.explanation}${sub}${broken ? `\n  Eslabones rotos: ${broken}` : ''}${r.incomeIds.length ? `\n  income.id: ${r.incomeIds.join(', ')}` : ''}`,
  ].join('\n');
}

export function buildManualCountPrompt(input: { report: ManualCountReport; causes: Cause[] }): string {
  const { report } = input;
  const wanted = [...new Set(input.causes)].filter((c) => !SYSTEM_EXCLUDED.includes(c) && CAUSE_CODE_MAP[c]);
  const sections = wanted
    .map((c) => ({ c, rows: report.rows.filter((r) => r.verdict === 'ERROR_SISTEMA' && r.cause === c) }))
    .filter((s) => s.rows.length > 0);

  const out: string[] = [];
  out.push(`# Corregir descuadres de cobro — ${report.subsidiaryName ?? report.subsidiaryId} · ${report.day}`);
  out.push('');
  out.push('Actúa como developer senior fullstack en pmy-api (NestJS + TypeORM, MySQL) y app-pmy (Next.js).');
  out.push('El conteo manual de paquetes de la sucursal no cuadra con el sistema. La herramienta "Conteo manual vs sistema" del Consolidador comparó cada guía contra FedEx en vivo, las rutas, los consolidados y los ingresos, y encontró estos **errores del sistema**. Encuentra la causa raíz en el código y corrígela.');
  out.push('');
  out.push('## Contexto');
  out.push(`- Sucursal: ${report.subsidiaryName ?? '—'} (\`${report.subsidiaryId}\`)`);
  out.push(`- Día (local Hermosillo): ${report.day}`);
  if (report.fedexFailures) out.push(`- FedEx no respondió para ${report.fedexFailures} guía(s); en esas se usó el estatus del sistema.`);
  out.push('');
  out.push('| | POD | DEX07 | DEX08 |');
  out.push('|---|---|---|---|');
  out.push(markLine('Contado por el usuario', report.totals.manual));
  out.push(markLine('FedEx en vivo', report.totals.fedex));
  out.push(markLine('Cobrado (income)', report.totals.charged));
  out.push('');

  if (!sections.length) {
    out.push('No hay errores del sistema en las causas elegidas: las diferencias son de conteo o de regla.');
    return out.join('\n');
  }

  sections.forEach(({ c, rows }, idx) => {
    const info = CAUSE_CODE_MAP[c]!;
    out.push(`## ${idx + 1}. ${info.title} — ${rows.length} guía(s)`);
    out.push('');
    rows.slice(0, MAX_EXAMPLES).forEach((r) => out.push(exampleLine(r)));
    if (rows.length > MAX_EXAMPLES) out.push(`- … y ${rows.length - MAX_EXAMPLES} más.`);
    out.push('');
    out.push('Dónde buscar:');
    info.files.forEach((f) => out.push(`- ${f}`));
    out.push('');
    out.push(`Pista: ${info.hint}`);
    out.push('');
  });

  out.push('## Reglas del proyecto');
  out.push('- Primero diagnostica con SQL y el código (confirma la causa con los datos de estas guías) antes de cambiar nada.');
  out.push('- Reglas de cobro vigentes: charge_rule por carrier+código (global + sucursal); ruta 31.5 no cobra por guía; DEX08 solo con 3 días distintos con 08 en la misma semana ISO (lun–dom); entregado gana a DEX del mismo día; la devolución anula el ingreso de entregado; costo = subsidiary.fedexCostPackage.');
  out.push('- Esquema SOLO por migración (DB_SYNC=false en todos los entornos).');
  out.push('- Agrega o ajusta una prueba que cubra estos casos reales.');
  out.push('- NUNCA borres ingresos: si hay que corregir datos, anular con active=0 + annulledAt, y pedir aprobación explícita antes.');
  out.push('- Al terminar: `npx tsc --noEmit`, pruebas del módulo y `graphify update .`.');
  out.push('');
  out.push('## Criterios de aceptación');
  out.push('- Con la corrección, estas guías ya no caerían en el mismo error (demuéstralo con la prueba).');
  out.push('- No se rompen los flujos vecinos (cierre de ruta, cron FedEx, motor tracking-sync).');
  out.push('- Se entrega la lista de ingresos existentes a corregir (sin tocarlos) para aprobación.');
  return out.join('\n');
}
