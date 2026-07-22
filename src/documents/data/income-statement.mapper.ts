/**
 * Data-provider de "Estado de Resultados" (B4). Espejo de `ResportsService
 * .generateIncomeStatementReportLegacy` (armado inline exceljs con matriz diaria): NO recalcula
 * agregaciones de negocio (prorrateo `dailyShareForDay`, pivot por sourceType/categoría), solo
 * consume las matrices YA agregadas por el service y les da forma para la plantilla
 * `income_statement_excel` (hoja 1: tabla única con columnas dinámicas por día, ver
 * `dynamicColumnsVar` en `excel-workbook-builder.ts`).
 */

import { ExcelColumn } from '../blocks/excel-doc.types';

const MONEY_FMT = '"$"#,##0.00';
const NAVY = '1F4E78';
const RED = 'C00000';
const GRAY = 'F2F2F2';
const GREEN = '27AE60';
const DARK_RED = 'C0392B';
const GREEN_SCALE = 'FF63BE7B';
const RED_SCALE = 'FFF8696B';

export interface IncomeStatementDetailRow {
  date: string | Date;
  ref?: string;
  type: 'INGRESO' | 'EGRESO';
  category?: string;
  desc?: string;
  amount: number;
}

export interface IncomeStatementInput {
  subsidiaryName: string;
  /** Días del rango, ISO 'YYYY-MM-DD' ascendente (ya calculados por el service, TZ Hermosillo). */
  dateKeys: string[];
  /** categoría (sourceType) -> dateKey -> monto del día. */
  incomeMatrix: Record<string, Record<string, number>>;
  /** categoría -> dateKey -> monto del día (ya prorrateado vía `dailyShareForDay`). */
  expenseMatrix: Record<string, Record<string, number>>;
  /** Filas planas para la hoja 2 "Desglose Detallado". */
  detailRows: IncomeStatementDetailRow[];
}

/** Etiqueta es-MX mayúscula "MES DD" para un día ISO, fiel al legacy (`toLocaleString` en UTC). */
export function dayLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  return d.toLocaleString('es-MX', { month: 'short', day: '2-digit', timeZone: 'UTC' }).toUpperCase();
}

function dayKey(dateKey: string): string {
  return `d_${dateKey}`;
}

/** Fila en blanco (visual: separador), con todas las columnas de día/total como '' (no 0). */
function blankRow(dateKeys: string[]): Record<string, any> {
  const row: Record<string, any> = { variable: '' };
  for (const k of dateKeys) row[dayKey(k)] = '';
  row.total = '';
  return row;
}

/** Fila de datos (categoría) con montos por día + total, tomados de una matriz categoría->día. */
function dataRow(variable: string, amountsByDay: Record<string, number> | undefined, dateKeys: string[]): Record<string, any> {
  const row: Record<string, any> = { variable: `   ${variable}` };
  let total = 0;
  for (const k of dateKeys) {
    const v = Number(amountsByDay?.[k] || 0);
    row[dayKey(k)] = v;
    total += v;
  }
  row.total = total;
  return row;
}

/** Fila título de sección (p.ej. "INGRESOS OPERATIVOS"): solo la etiqueta, resto en blanco. */
function sectionTitleRow(label: string, color: string, dateKeys: string[]): Record<string, any> {
  return { ...blankRow(dateKeys), variable: label, rowBold: true, rowFontColor: color };
}

/** Fila resumen (p.ej. "TOTAL INGRESOS"): bold + fondo gris, con los totales diarios ya sumados. */
function summaryRow(label: string, totalsByDay: number[], grandTotal: number, dateKeys: string[]): Record<string, any> {
  const row: Record<string, any> = { variable: label, rowBold: true, rowFill: GRAY };
  dateKeys.forEach((k, i) => { row[dayKey(k)] = totalsByDay[i]; });
  row.total = grandTotal;
  return row;
}

export function buildIncomeStatementData(input: IncomeStatementInput): Record<string, any> {
  const dateKeys = input.dateKeys ?? [];
  const subsidiaryNameUpper = (input.subsidiaryName || 'N/A').toUpperCase();

  const dayColumns: ExcelColumn[] = dateKeys.map((k) => ({
    key: dayKey(k),
    label: dayLabel(k),
    width: 16,
    numFmt: MONEY_FMT,
    align: 'center',
    fillFromKey: `${dayKey(k)}_fill`,
  }));
  const totalColumnsCount = dayColumns.length + 2; // variable + días + total

  const incomeCategories = Object.keys(input.incomeMatrix ?? {});
  const expenseCategories = Object.keys(input.expenseMatrix ?? {});

  // --- INGRESOS ---
  const incomeRows = incomeCategories.map((cat) => dataRow(cat, input.incomeMatrix[cat], dateKeys));
  const totalDailyIncomes = dateKeys.map((k) => incomeCategories.reduce((sum, cat) => sum + Number(input.incomeMatrix[cat]?.[k] || 0), 0));
  const grandTotalIncomes = totalDailyIncomes.reduce((a, b) => a + b, 0);

  // --- EGRESOS ---
  const expenseRows = expenseCategories.map((cat) => dataRow(cat, input.expenseMatrix[cat], dateKeys));
  const totalDailyExpenses = dateKeys.map((k) => expenseCategories.reduce((sum, cat) => sum + Number(input.expenseMatrix[cat]?.[k] || 0), 0));
  const grandTotalExpenses = totalDailyExpenses.reduce((a, b) => a + b, 0);

  // --- UTILIDAD NETA ---
  const netDaily = totalDailyIncomes.map((v, i) => v - totalDailyExpenses[i]);
  const netGrandTotal = grandTotalIncomes - grandTotalExpenses;
  const netRow: Record<string, any> = {
    variable: 'UTILIDAD NETA', rowBold: true, rowFontColor: 'FFFFFF', variable_fill: NAVY,
  };
  dateKeys.forEach((k, i) => {
    netRow[dayKey(k)] = netDaily[i];
    netRow[`${dayKey(k)}_fill`] = netDaily[i] >= 0 ? GREEN : DARK_RED;
  });
  netRow.total = netGrandTotal;
  netRow.total_fill = netGrandTotal >= 0 ? GREEN : DARK_RED;

  const sheet1Rows: Record<string, any>[] = [
    sectionTitleRow('INGRESOS OPERATIVOS', NAVY, dateKeys),
    ...incomeRows,
    summaryRow('TOTAL INGRESOS', totalDailyIncomes, grandTotalIncomes, dateKeys),
    blankRow(dateKeys),
    sectionTitleRow('EGRESOS OPERATIVOS', RED, dateKeys),
    ...expenseRows,
    summaryRow('TOTAL EGRESOS', totalDailyExpenses, grandTotalExpenses, dateKeys),
    blankRow(dateKeys),
    netRow,
  ];

  // --- HOJA 2: DESGLOSE DETALLADO ---
  const detailRows = (input.detailRows ?? []).map((r) => ({
    date: r.date,
    ref: r.ref || 'N/A',
    type: r.type,
    category: r.category || '',
    desc: r.desc || '',
    amount: Number(r.amount || 0),
    typeColor: r.type === 'INGRESO' ? GREEN : RED,
  }));

  // --- HOJA 3: DASHBOARD ---
  const incCatTotals = incomeCategories.map((cat) => ({ category: cat, amount: Object.values(input.incomeMatrix[cat] ?? {}).reduce((a: number, b: any) => a + Number(b || 0), 0) }));
  const expCatTotals = expenseCategories.map((cat) => ({ category: cat, amount: Object.values(input.expenseMatrix[cat] ?? {}).reduce((a: number, b: any) => a + Number(b || 0), 0) }));
  const maxCatRows = Math.max(incCatTotals.length, expCatTotals.length, 0);
  const dashboardRows: Record<string, any>[] = [];
  for (let i = 0; i < maxCatRows; i++) {
    dashboardRows.push({
      incCategory: incCatTotals[i]?.category ?? '',
      incAmount: incCatTotals[i]?.amount ?? 0,
      expCategory: expCatTotals[i]?.category ?? '',
      expAmount: expCatTotals[i]?.amount ?? 0,
    });
  }

  return {
    title: 'ESTADO DE RESULTADOS',
    subsidiaryName: input.subsidiaryName || 'N/A',
    subsidiaryNameUpper,
    dayColumns,
    totalColumnsCount,
    sheet1Rows,
    detailRows,
    dashboardRows,
    stats: { grandTotalIncomes, grandTotalExpenses, netGrandTotal },
  };
}

export { GREEN_SCALE as DASHBOARD_INCOME_COLOR_SCALE, RED_SCALE as DASHBOARD_EXPENSE_COLOR_SCALE };
