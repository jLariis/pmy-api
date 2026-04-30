import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Expense, Income, Subsidiary } from 'src/entities';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ResportsService {
  constructor(
    @InjectRepository(Expense)
    private readonly expenseRepository: Repository<Expense>,
    @InjectRepository(Income)
    private readonly incomeRepository: Repository<Income>,
    @InjectRepository(Subsidiary)
    private readonly subsidiaryRepository: Repository<Subsidiary>,
  ) {}

  public async generateIncomeStatementReport(
    subsidiaryId: string,
    startDate: string | Date,
    endDate: string | Date,
  ): Promise<ExcelJS.Buffer> {
    const parsedStartDate = new Date(startDate);
    const parsedEndDate = new Date(endDate);

    // 1. OBTENCIÓN DEL NOMBRE DE LA SUCURSAL
    const subsidiary = await this.subsidiaryRepository.findOne({
      where: { id: subsidiaryId },
      select: ['name'],
    });
    const subsidiaryName = subsidiary?.name || 'Sucursal Desconocida';

    // 2. OBTENCIÓN DE DATOS DE INGRESOS Y EGRESOS
    const allIncomes = await this.incomeRepository
      .createQueryBuilder('income')
      .where('income.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('income.date >= :start AND income.date <= :end', { start: parsedStartDate, end: parsedEndDate })
      .getMany();

    const allExpenses = await this.expenseRepository
      .createQueryBuilder('expense')
      .where('expense.subsidiaryId = :subsidiaryId', { subsidiaryId })
      .andWhere('expense.date >= :start AND expense.date <= :end', { start: parsedStartDate, end: parsedEndDate })
      .getMany();

    // 3. CÁLCULO DE MATRIZ DE FECHAS (COLUMNAS DIARIAS)
    const datesMap = new Map<string, string>();
    const currentDate = new Date(parsedStartDate);
    
    while (currentDate <= parsedEndDate) {
      const isoDate = currentDate.toISOString().split('T')[0];
      const spanishLabel = currentDate.toLocaleString('es-MX', { month: 'short', day: '2-digit', timeZone: 'UTC' }).toUpperCase();
      datesMap.set(isoDate, spanishLabel);
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
    
    const dateKeys = Array.from(datesMap.keys());
    const dateLabels = Array.from(datesMap.values());

    // 4. ESTRUCTURACIÓN DE DATOS (PIVOT)
    const incomeMatrix = new Map<string, Map<string, number>>();
    const expenseMatrix = new Map<string, Map<string, number>>();

    allIncomes.forEach(inc => {
      const cat = inc.sourceType || 'Ingreso General';
      const dStr = new Date(inc.date).toISOString().split('T')[0];
      if (!incomeMatrix.has(cat)) incomeMatrix.set(cat, new Map<string, number>());
      const current = incomeMatrix.get(cat)!.get(dStr) || 0;
      incomeMatrix.get(cat)!.set(dStr, current + Number(inc.cost));
    });

    allExpenses.forEach(exp => {
      const cat = exp.category || 'Gasto General';
      const dStr = new Date(exp.date).toISOString().split('T')[0];
      if (!expenseMatrix.has(cat)) expenseMatrix.set(cat, new Map<string, number>());
      const current = expenseMatrix.get(cat)!.get(dStr) || 0;
      expenseMatrix.get(cat)!.set(dStr, current + Number(exp.amount));
    });

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

    // Encabezado con Nombre de Sucursal
    const totalCols = columns.length;
    mainSheet.mergeCells(1, 1, 1, totalCols);
    const titleCell = mainSheet.getCell(1, 1);
    titleCell.value = `ESTADO DE RESULTADOS - SUCURSAL: ${subsidiaryName.toUpperCase()}`;
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

    Array.from(incomeMatrix.keys()).forEach(category => {
      const rowData: any[] = [`   ${category}`];
      let rowTotal = 0;
      dateKeys.forEach((dKey, i) => {
        const val = incomeMatrix.get(category)?.get(dKey) || 0;
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

    Array.from(expenseMatrix.keys()).forEach(category => {
      const rowData: any[] = [`   ${category}`];
      let rowTotal = 0;
      dateKeys.forEach((dKey, i) => {
        const val = expenseMatrix.get(category)?.get(dKey) || 0;
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

    allIncomes.forEach(i => {
      this.styleDetailedRow(detailSheet.addRow([i.date, i.trackingNumber || 'N/A', 'INGRESO', i.sourceType, '', i.cost]));
    });

    allExpenses.forEach(e => {
      this.styleDetailedRow(detailSheet.addRow([e.date, 'N/A', 'EGRESO', e.category, e.description || '', e.amount]));
    });

    detailSheet.autoFilter = 'A1:F1';

    // =========================================================================
    // HOJA 3: DASHBOARD INDICADORES (CON PRIORITY FIX)
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

    const incCats = Array.from(incomeMatrix.keys());
    const expCats = Array.from(expenseMatrix.keys());
    const maxRows = Math.max(incCats.length, expCats.length, 1);

    for (let i = 0; i < maxRows; i++) {
      const iCat = incCats[i];
      const eCat = expCats[i];
      let iSum = 0; if (iCat) incomeMatrix.get(iCat)?.forEach(v => iSum += v);
      let eSum = 0; if (eCat) expenseMatrix.get(eCat)?.forEach(v => eSum += v);

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