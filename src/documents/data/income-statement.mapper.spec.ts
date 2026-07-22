import { buildIncomeStatementData, dayLabel, IncomeStatementInput } from './income-statement.mapper';

function baseInput(overrides: Partial<IncomeStatementInput> = {}): IncomeStatementInput {
  return {
    subsidiaryName: 'Cd. Obregon',
    dateKeys: ['2026-07-18', '2026-07-19'],
    incomeMatrix: {},
    expenseMatrix: {},
    detailRows: [],
    ...overrides,
  };
}

describe('dayLabel', () => {
  it('formatea un día ISO en mayúsculas, fiel al `toLocaleString(es-MX, {month:short,day:2-digit})` legacy', () => {
    // Mismo formateador que `ResportsService.generateIncomeStatementReportLegacy`: el ICU de
    // Node para es-MX antepone el día ("18-JUL"), no "JUL 18" — se documenta tal cual, para
    // mantener paridad exacta con el legacy en vez de "corregir" el orden.
    expect(dayLabel('2026-07-18')).toBe(dayLabel('2026-07-18').toUpperCase());
    expect(dayLabel('2026-07-18')).toContain('18');
    expect(dayLabel('2026-07-18')).toContain('JUL');
  });
});

describe('buildIncomeStatementData', () => {
  it('dayColumns: una por día del rango, con label/width/numFmt correctos', () => {
    const data = buildIncomeStatementData(baseInput());
    expect(data.dayColumns).toHaveLength(2);
    expect(data.dayColumns[0].key).toBe('d_2026-07-18');
    expect(data.dayColumns[0].width).toBe(16);
    expect(data.dayColumns[0].numFmt).toBe('"$"#,##0.00');
    expect(data.totalColumnsCount).toBe(4); // variable + 2 días + total
  });

  it('filas de ingresos: una por sourceType, con montos por día y total correcto', () => {
    const data = buildIncomeStatementData(baseInput({
      incomeMatrix: {
        'Envío': { '2026-07-18': 100, '2026-07-19': 50 },
        'Carga': { '2026-07-18': 20 },
      },
    }));
    const rows: any[] = data.sheet1Rows;
    const envioRow = rows.find((r) => r.variable.includes('Envío'));
    expect(envioRow['d_2026-07-18']).toBe(100);
    expect(envioRow['d_2026-07-19']).toBe(50);
    expect(envioRow.total).toBe(150);
    const cargaRow = rows.find((r) => r.variable.includes('Carga'));
    expect(cargaRow['d_2026-07-18']).toBe(20);
    expect(cargaRow['d_2026-07-19']).toBe(0);
    expect(cargaRow.total).toBe(20);
  });

  it('TOTAL INGRESOS/TOTAL EGRESOS: suman todas las categorías por día, bold + fondo gris', () => {
    const data = buildIncomeStatementData(baseInput({
      incomeMatrix: { A: { '2026-07-18': 100 }, B: { '2026-07-18': 50 } },
      expenseMatrix: { X: { '2026-07-18': 30 } },
    }));
    const rows: any[] = data.sheet1Rows;
    const totalIncomes = rows.find((r) => r.variable === 'TOTAL INGRESOS');
    expect(totalIncomes['d_2026-07-18']).toBe(150);
    expect(totalIncomes.total).toBe(150);
    expect(totalIncomes.rowBold).toBe(true);
    expect(totalIncomes.rowFill).toBe('F2F2F2');
    const totalExpenses = rows.find((r) => r.variable === 'TOTAL EGRESOS');
    expect(totalExpenses['d_2026-07-18']).toBe(30);
    expect(totalExpenses.total).toBe(30);
  });

  it('UTILIDAD NETA = ingresos - egresos (por día y total), con fill verde/rojo por signo', () => {
    const data = buildIncomeStatementData(baseInput({
      incomeMatrix: { A: { '2026-07-18': 100, '2026-07-19': 10 } },
      expenseMatrix: { X: { '2026-07-18': 30, '2026-07-19': 40 } },
    }));
    const rows: any[] = data.sheet1Rows;
    const net = rows.find((r) => r.variable === 'UTILIDAD NETA');
    expect(net['d_2026-07-18']).toBe(70); // 100-30, positivo
    expect(net['d_2026-07-18_fill']).toBe('27AE60');
    expect(net['d_2026-07-19']).toBe(-30); // 10-40, negativo
    expect(net['d_2026-07-19_fill']).toBe('C0392B');
    expect(net.total).toBe(40); // 110-70
    expect(net.total_fill).toBe('27AE60');
    expect(data.stats.netGrandTotal).toBe(40);
  });

  it('secciones INGRESOS OPERATIVOS/EGRESOS OPERATIVOS: solo etiqueta, bold + color (azul/rojo)', () => {
    const data = buildIncomeStatementData(baseInput());
    const rows: any[] = data.sheet1Rows;
    const incTitle = rows.find((r) => r.variable === 'INGRESOS OPERATIVOS');
    expect(incTitle.rowBold).toBe(true);
    expect(incTitle.rowFontColor).toBe('1F4E78');
    expect(incTitle['d_2026-07-18']).toBe(''); // celdas restantes en blanco, no "$0.00"
    const expTitle = rows.find((r) => r.variable === 'EGRESOS OPERATIVOS');
    expect(expTitle.rowFontColor).toBe('C00000');
  });

  it('hoja 2 (detailRows): formatea tipo/color y usa "N/A" cuando falta referencia', () => {
    const data = buildIncomeStatementData(baseInput({
      detailRows: [
        { date: '2026-07-18', type: 'INGRESO', category: 'Envío', amount: 100 },
        { date: '2026-07-18', type: 'EGRESO', category: 'Renta', desc: 'Pago mensual', amount: 30, ref: 'F-001' },
      ],
    }));
    expect(data.detailRows).toHaveLength(2);
    expect(data.detailRows[0].ref).toBe('N/A');
    expect(data.detailRows[0].typeColor).toBe('27AE60');
    expect(data.detailRows[1].ref).toBe('F-001');
    expect(data.detailRows[1].typeColor).toBe('C00000');
  });

  it('hoja 3 (dashboardRows): una fila por índice, alineando categorías de ingreso/egreso (huecos vacíos)', () => {
    const data = buildIncomeStatementData(baseInput({
      incomeMatrix: { A: { '2026-07-18': 100 }, B: { '2026-07-18': 20 } },
      expenseMatrix: { X: { '2026-07-18': 30 } },
    }));
    expect(data.dashboardRows).toHaveLength(2); // max(2 ingresos, 1 egreso)
    expect(data.dashboardRows[0]).toEqual({ incCategory: 'A', incAmount: 100, expCategory: 'X', expAmount: 30 });
    expect(data.dashboardRows[1]).toEqual({ incCategory: 'B', incAmount: 20, expCategory: '', expAmount: 0 });
  });

  it('sin categorías: sheet1Rows solo tiene títulos+totales(0)+utilidad neta(0), sin romper', () => {
    const data = buildIncomeStatementData(baseInput());
    const rows: any[] = data.sheet1Rows;
    expect(rows.find((r) => r.variable === 'TOTAL INGRESOS').total).toBe(0);
    expect(rows.find((r) => r.variable === 'UTILIDAD NETA').total).toBe(0);
    expect(data.dashboardRows).toHaveLength(0);
  });
});
