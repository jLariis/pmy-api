import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Expense, Income, Subsidiary } from 'src/entities';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { dailyShareForDay } from 'src/common/expense-proration.util';
import { TemplateService } from 'src/documents/template.service';
import { buildIncomeStatementData, dayLabel, IncomeStatementDetailRow, IncomeStatementInput } from 'src/documents/data/income-statement.mapper';

@Injectable()
export class ResportsService {
  private readonly logger = new Logger(ResportsService.name);

  constructor(
    @InjectRepository(Expense)
    private readonly expenseRepository: Repository<Expense>,
    @InjectRepository(Income)
    private readonly incomeRepository: Repository<Income>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
    private readonly templateService: TemplateService,
  ) {}

  /**
   * Genera el Excel de "Estado de Resultados" (B4). Unificación: detrás de flag, el backend
   * genera el Excel por el Motor de Plantillas (`income_statement_excel`, columnas dinámicas por
   * día). Si el motor no entrega buffer (o falla), se conserva el armado inline exceljs original
   * (`generateIncomeStatementReportLegacy`). Flag OFF => comportamiento actual intacto.
   */
  public async generateIncomeStatementReport(
    subsidiaryIds: string[],
    startDate: string | Date,
    endDate: string | Date,
  ): Promise<ExcelJS.Buffer> {
    if (process.env.DOC_ENGINE_INCOME_STATEMENT === 'true') {
      try {
        const buf = await this.renderIncomeStatementViaEngine(subsidiaryIds, startDate, endDate);
        if (buf) return buf as unknown as ExcelJS.Buffer;
      } catch (e: any) {
        this.logger.warn(`Motor income_statement_excel falló; uso armado legacy: ${e?.message}`);
      }
    }
    return this.generateIncomeStatementReportLegacy(subsidiaryIds, startDate, endDate);
  }

  /** Arma el `IncomeStatementInput` (data-provider) y renderiza vía el Motor. `undefined` si el motor no entrega buffer. */
  async renderIncomeStatementViaEngine(
    subsidiaryIds: string[],
    startDate: string | Date,
    endDate: string | Date,
  ): Promise<Buffer | undefined> {
    const aggregates = await this.loadIncomeStatementAggregates(subsidiaryIds, startDate, endDate);
    const data = buildIncomeStatementData(aggregates);
    const result = await this.templateService.render('income_statement_excel', data);
    return result.buffer;
  }

  /**
   * Consulta Income/Expense del rango (con prorrateo diario `dailyShareForDay`, igual que el
   * armado legacy) y arma el `IncomeStatementInput` que consume tanto el motor (vía
   * `buildIncomeStatementData`) como el armado legacy de abajo (sin duplicar las queries).
   */
  private async loadIncomeStatementAggregates(
    subsidiaryIds: string[],
    startDate: string | Date,
    endDate: string | Date,
  ): Promise<IncomeStatementInput> {
    // Aplicamos la misma corrección de zona horaria (Hermosillo UTC-7) para evitar desfases
    const baseStartDate = startDate.toString().split('T')[0];
    const baseEndDate = endDate.toString().split('T')[0];
    const parsedStartDate = new Date(`${baseStartDate}T00:00:00.000-07:00`);
    const parsedEndDate = new Date(`${baseEndDate}T23:59:59.999-07:00`);

    // 1. OBTENCIÓN DE NOMBRES DE LAS SUCURSALES
    const subsidiariesQuery = this.subsidiaryRepository.createQueryBuilder('subsidiary');

    // Si subsidiaryIds está vacío (gracias al blindaje del controller), ignora este WHERE
    if (subsidiaryIds && subsidiaryIds.length > 0) {
      subsidiariesQuery.where('subsidiary.id IN (:...subsidiaryIds)', { subsidiaryIds });
    }
    const subsidiaries = await subsidiariesQuery.select(['subsidiary.name']).getMany();

    let subsidiaryName = 'TODAS LAS SUCURSALES';
    if (subsidiaries.length > 0 && subsidiaryIds && subsidiaryIds.length > 0) {
      const names = subsidiaries.map(s => s.name).join(', ');
      // Si el nombre concatenado es muy largo, usamos un título genérico
      subsidiaryName = names.length > 60 ? 'MÚLTIPLES SUCURSALES' : names;
    }

    // Filtro dinámico para ingresos y egresos
    const hasSubsidiaryFilter = subsidiaryIds && subsidiaryIds.length > 0;
    const subsidiaryCondition = hasSubsidiaryFilter ? 'income.subsidiaryId IN (:...subsidiaryIds)' : '1=1';
    const expenseSubsidiaryCondition = hasSubsidiaryFilter ? 'expense.subsidiaryId IN (:...subsidiaryIds)' : '1=1';

    // 2. OBTENCIÓN DE DATOS DE INGRESOS Y EGRESOS
    const allIncomes = await this.incomeRepository
      .createQueryBuilder('income')
      .where(subsidiaryCondition, { subsidiaryIds })
      .andWhere('income.date >= :start AND income.date <= :end', { start: parsedStartDate, end: parsedEndDate })
      .getMany();

    const allExpenses = await this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.category', 'category')
      .where(expenseSubsidiaryCondition, { subsidiaryIds })
      .andWhere(
        '((expense.periodStart IS NOT NULL AND expense.periodEnd IS NOT NULL AND expense.periodStart <= :endDay AND expense.periodEnd >= :startDay) OR ((expense.periodStart IS NULL OR expense.periodEnd IS NULL) AND expense.date BETWEEN :startDay AND :endDay))',
        { startDay: baseStartDate, endDay: baseEndDate },
      )
      .getMany();

    // 3. CÁLCULO DE MATRIZ DE FECHAS (COLUMNAS DIARIAS)
    const dateKeys: string[] = [];
    const currentDate = new Date(parsedStartDate);
    while (currentDate <= parsedEndDate) {
      dateKeys.push(currentDate.toISOString().split('T')[0]);
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    // 4. ESTRUCTURACIÓN DE DATOS (PIVOT), como Records planos (category -> dateKey -> monto)
    const incomeMatrix: Record<string, Record<string, number>> = {};
    const expenseMatrix: Record<string, Record<string, number>> = {};

    allIncomes.forEach(inc => {
      const cat = inc.sourceType || 'Ingreso General';
      const dStr = new Date(inc.date).toISOString().split('T')[0];
      if (!incomeMatrix[cat]) incomeMatrix[cat] = {};
      incomeMatrix[cat][dStr] = (incomeMatrix[cat][dStr] || 0) + Number(inc.cost);
    });

    allExpenses.forEach(exp => {
      const cat = exp.category?.name || 'Sin categoría';
      if (!expenseMatrix[cat]) expenseMatrix[cat] = {};
      for (const dKey of dateKeys) {
        const share = dailyShareForDay(
          { amount: exp.amount, date: exp.date, periodStart: exp.periodStart, periodEnd: exp.periodEnd },
          dKey,
        );
        if (share !== 0) expenseMatrix[cat][dKey] = (expenseMatrix[cat][dKey] || 0) + share;
      }
    });

    // 5. HOJA 2 (desglose): mismo orden que el legacy (ingresos primero, luego egresos)
    const detailRows: IncomeStatementDetailRow[] = [
      ...allIncomes.map((i): IncomeStatementDetailRow => ({
        date: i.date, ref: (i as any).trackingNumber || 'N/A', type: 'INGRESO', category: i.sourceType, desc: '', amount: Number(i.cost),
      })),
      ...allExpenses.map((e): IncomeStatementDetailRow => ({
        date: e.date, ref: 'N/A', type: 'EGRESO', category: e.category?.name || '', desc: e.description || '', amount: Number(e.amount),
      })),
    ];

    return { subsidiaryName, dateKeys, incomeMatrix, expenseMatrix, detailRows };
  }

  /** Armado original (inline exceljs, matriz diaria). Conservado como fallback del Motor. */
  private async generateIncomeStatementReportLegacy(
    subsidiaryIds: string[],
    startDate: string | Date,
    endDate: string | Date,
  ): Promise<ExcelJS.Buffer> {
    const { subsidiaryName, dateKeys, incomeMatrix, expenseMatrix, detailRows } = await this.loadIncomeStatementAggregates(subsidiaryIds, startDate, endDate);
    const dateLabels = dateKeys.map((k) => dayLabel(k));

    // 5. CONFIGURACIÓN DEL LIBRO EXCEL
    const workbook = new ExcelJS.Workbook();
    const headerBlue = 'FF1F4E78';
    const white = 'FFFFFFFF';

    // =========================================================================
    // HOJA 1: ESTADO DIARIO (MATRIZ)
    // =========================================================================
    const mainSheet = workbook.addWorksheet('Estado de Resultados', { views: [{ showGridLines: false }] });

    const columns = [
      { header: '', key: 'variable', width: 40 },
      ...dateKeys.map(k => ({ header: '', key: k, width: 16 })),
      { header: '', key: 'total', width: 22 }
    ];
    mainSheet.columns = columns;

    // Encabezado con Nombre de Sucursal(es)
    const totalCols = columns.length;
    mainSheet.mergeCells(1, 1, 1, totalCols);
    const titleCell = mainSheet.getCell(1, 1);
    titleCell.value = `ESTADO DE RESULTADOS - ${subsidiaryName.toUpperCase()}`;
    titleCell.font = { size: 16, bold: true, color: { argb: headerBlue } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    mainSheet.addRow([]); // Espaciador

    const headerRow = mainSheet.addRow(['VARIABLES', ...dateLabels, 'TOTAL ACUMULADO']);
    this.styleSectionHeader(headerRow, headerBlue, white);

    // --- SECCIÓN INGRESOS ---
    const incomesTitle = mainSheet.addRow(['INGRESOS OPERATIVOS', ...Array(dateKeys.length + 1).fill('')]);
    incomesTitle.getCell(1).font = { bold: true, color: { argb: headerBlue } };

    const totalDailyIncomes = new Array(dateKeys.length).fill(0);
    let grandTotalIncomes = 0;

    Object.keys(incomeMatrix).forEach(category => {
      const rowData: any[] = [`   ${category}`];
      let rowTotal = 0;
      dateKeys.forEach((dKey, i) => {
        const val = incomeMatrix[category]?.[dKey] || 0;
        rowData.push(val);
        rowTotal += val;
        totalDailyIncomes[i] += val;
      });
      rowData.push(rowTotal);
      grandTotalIncomes += rowTotal;
      this.styleDataRow(mainSheet.addRow(rowData), dateKeys.length);
    });

    this.styleSummaryRow(mainSheet.addRow(['TOTAL INGRESOS', ...totalDailyIncomes, grandTotalIncomes]), dateKeys.length);
    mainSheet.addRow([]);

    // --- SECCIÓN EGRESOS ---
    const expensesTitle = mainSheet.addRow(['EGRESOS OPERATIVOS', ...Array(dateKeys.length + 1).fill('')]);
    expensesTitle.getCell(1).font = { bold: true, color: { argb: 'FFC00000' } };

    const totalDailyExpenses = new Array(dateKeys.length).fill(0);
    let grandTotalExpenses = 0;

    Object.keys(expenseMatrix).forEach(category => {
      const rowData: any[] = [`   ${category}`];
      let rowTotal = 0;
      dateKeys.forEach((dKey, i) => {
        const val = expenseMatrix[category]?.[dKey] || 0;
        rowData.push(val);
        rowTotal += val;
        totalDailyExpenses[i] += val;
      });
      rowData.push(rowTotal);
      grandTotalExpenses += rowTotal;
      this.styleDataRow(mainSheet.addRow(rowData), dateKeys.length);
    });

    this.styleSummaryRow(mainSheet.addRow(['TOTAL EGRESOS', ...totalDailyExpenses, grandTotalExpenses]), dateKeys.length);
    mainSheet.addRow([]);

    // --- UTILIDAD NETA ---
    const netDaily = totalDailyIncomes.map((inc, i) => inc - totalDailyExpenses[i]);
    const netGrandTotal = grandTotalIncomes - grandTotalExpenses;
    this.styleNetResultRow(mainSheet.addRow(['UTILIDAD NETA', ...netDaily, netGrandTotal]), dateKeys.length);

    // =========================================================================
    // HOJA 2: DESGLOSE DETALLADO
    // =========================================================================
    const detailSheet = workbook.addWorksheet('Desglose Detallado');
    detailSheet.columns = [
      { header: 'FECHA', key: 'date', width: 20 },
      { header: 'REFERENCIA / GUÍA', key: 'ref', width: 25 },
      { header: 'TIPO', key: 'type', width: 15 },
      { header: 'CATEGORÍA', key: 'category', width: 30 },
      { header: 'DESCRIPCIÓN', key: 'desc', width: 45 },
      { header: 'IMPORTE', key: 'amount', width: 20 },
    ];

    this.styleSectionHeader(detailSheet.getRow(1), headerBlue, white);

    detailRows.forEach(row => {
      this.styleDetailedRow(detailSheet.addRow([row.date, row.ref, row.type, row.category, row.desc, row.amount]));
    });

    detailSheet.autoFilter = 'A1:F1';

    // =========================================================================
    // HOJA 3: DASHBOARD INDICADORES
    // =========================================================================
    const dashSheet = workbook.addWorksheet('Dashboard');
    dashSheet.columns = [{ width: 35 }, { width: 20 }, { width: 35 }, { width: 20 }];

    dashSheet.mergeCells('A1:D1');
    const dTitle = dashSheet.getCell('A1');
    dTitle.value = 'RESUMEN EJECUTIVO DE OPERACIÓN';
    dTitle.font = { size: 16, bold: true, color: { argb: headerBlue } };
    dTitle.alignment = { horizontal: 'center' };

    dashSheet.addRow([]);
    this.styleSectionHeader(dashSheet.addRow(['CATEGORÍA INGRESO', 'MONTO', 'CATEGORÍA EGRESO', 'MONTO']), 'FF4472C4', white);

    const incCats = Object.keys(incomeMatrix);
    const expCats = Object.keys(expenseMatrix);
    const maxRows = Math.max(incCats.length, expCats.length, 1);

    for (let i = 0; i < maxRows; i++) {
      const iCat = incCats[i];
      const eCat = expCats[i];
      let iSum = 0; if (iCat) iSum = Object.values(incomeMatrix[iCat] || {}).reduce((a, b) => a + b, 0);
      let eSum = 0; if (eCat) eSum = Object.values(expenseMatrix[eCat] || {}).reduce((a, b) => a + b, 0);

      const r = dashSheet.addRow([iCat || '', iSum, eCat || '', eSum]);
      r.eachCell((c, col) => {
        c.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } };
        if (col === 2 || col === 4) c.numFmt = '"$"#,##0.00';
      });
    }

    if (maxRows > 0) {
      dashSheet.addConditionalFormatting({
        ref: `B4:B${3 + maxRows}`,
        rules: [{ type: 'colorScale', priority: 1, cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFFFFFFF' }, { argb: 'FF63BE7B' }] }]
      });
      dashSheet.addConditionalFormatting({
        ref: `D4:D${3 + maxRows}`,
        rules: [{ type: 'colorScale', priority: 2, cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFFFFFFF' }, { argb: 'FFF8696B' }] }]
      });
    }

    return await workbook.xlsx.writeBuffer() as ExcelJS.Buffer;
  }

  // --- MÉTODOS DE ESTILO ---

  private styleSectionHeader(row: ExcelJS.Row, bg: string, text: string) {
    row.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.font = { color: { argb: text }, bold: true };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
  }

  private styleDataRow(row: ExcelJS.Row, count: number) {
    row.getCell(1).alignment = { horizontal: 'left' };
    row.getCell(1).border = { left: { style: 'thin' }, bottom: { style: 'hair', color: { argb: 'FFD9D9D9' } } };
    for (let i = 2; i <= count + 2; i++) {
      const c = row.getCell(i);
      c.numFmt = '"$"#,##0.00';
      c.alignment = { horizontal: 'center' };
      c.border = { bottom: { style: 'hair', color: { argb: 'FFD9D9D9' } } };
      if (i === count + 2) c.border.right = { style: 'thin' };
    }
  }

  private styleSummaryRow(row: ExcelJS.Row, count: number) {
    row.eachCell(c => {
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      c.border = { top: { style: 'thin' }, bottom: { style: 'double' }, left: { style: 'thin' }, right: { style: 'thin' } };
      c.alignment = { horizontal: 'center' };
    });
    for (let i = 2; i <= count + 2; i++) row.getCell(i).numFmt = '"$"#,##0.00';
  }

  private styleNetResultRow(row: ExcelJS.Row, count: number) {
    row.eachCell((c, i) => {
      const isPos = Number(c.value) >= 0;
      const bg = i === 1 ? 'FF1F4E78' : (isPos ? 'FF27AE60' : 'FFC0392B');
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      c.alignment = { horizontal: 'center' };
      c.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' } };
      if (i > 1) c.numFmt = '"$"#,##0.00';
    });
  }

  private styleDetailedRow(row: ExcelJS.Row) {
    row.eachCell(c => {
      c.alignment = { horizontal: 'center' };
      c.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } };
    });
    row.getCell(1).numFmt = 'dd/mm/yyyy';
    row.getCell(6).numFmt = '"$"#,##0.00';
    const isInc = row.getCell(3).value === 'INGRESO';
    row.getCell(3).font = { color: { argb: isInc ? 'FF27AE60' : 'FFC0392B' }, bold: true };
  }
}