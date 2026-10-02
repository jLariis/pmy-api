import * as XLSX from 'xlsx';
import { buildPastePlan, cobrosToTsv, hmoDay, PlanAttachment } from './paste-plan.util';
import { workbookToTsv } from './attachment-classify.util';

const att = (id: string, filename: string, kind: PlanAttachment['kind'], consNumber: string | null = null, tsv: string | null = 'Tracking Number\tRecip Postal\n1\t23450\n2\t23450'): PlanAttachment => ({ id, filename, kind, consNumber, tsv });
const base = { subsidiaryId: 'cabo', receivedAt: new Date('2026-10-02T02:32:00Z'), cobros: [], doneKeys: [] as string[] };

describe('paste-plan.util', () => {
  it('fecha de Hermosillo (UTC−7)', () => {
    expect(hmoDay(new Date('2026-10-02T02:32:00Z'))).toBe('2026-10-01');
  });

  it('Cabo: master con su número y F2 con el suyo; CCP no genera lote; cobros a ambos', () => {
    const plan = buildPastePlan({
      ...base,
      attachments: [att('a1', 'CARGA_305821242296_YAQUI_SJDA.xlsx', 'master', '305821242296'), att('a2', 'CCP.xlsx', 'ccp_ignored'), att('a3', 'F2.xlsx', 'f2')],
      announced: [{ consNumber: '305821242296', kind: 'master' }, { consNumber: '305821512729', kind: 'f2' }],
      cobros: [{ trackingNumber: '383905050153', date: '09/28/2026', concept: 'COD-COLLECT CASH', amount: 2210 }],
    });
    expect(plan.map((b) => `${b.kind}:${b.consNumber}`)).toEqual(['master:305821242296', 'f2:305821512729']);
    expect(plan[0]).toMatchObject({ consDate: '2026-10-01', isAereo: false, rows: 2, blockedReason: null });
    expect(plan[0].paymentsRaw).toContain('383905050153\t09/28/2026\tCOD-COLLECT CASH 2210 MXP');
    expect(plan[1].paymentsRaw).toBe(plan[0].paymentsRaw);
  });

  it('Aéreo real (01/10 Cabo): número de la fila meta; las 17 de valor van completas en el mismo lote', () => {
    const T = String.fromCharCode(9);
    const N = String.fromCharCode(10);
    const tsv = (rows: string[][]) => rows.map((r) => r.join(T)).join(N);
    const aereo = tsv([
      ['', '305821338193', 'ALBERTO GUTIERREZ', 'SALIDA AEREA', '', '', '', '10/1/26'],
      ['', 'Tracking No', 'Recip Name', 'Recip Addr', 'Recip Postal', 'Commit Date'],
      ['1', '383495230427', '', '', '23406', '10/02/2026'],
    ]);
    const valor = tsv([
      ['', '305821531470', 'ALBERTO GUTIERREZ', 'VALOR', '', '', '', '10/1/2026'],
      ['', 'Tracking No', 'Recip Name', 'Recip Addr', 'Recip Postal', 'Commit Date'],
      ['1', '383954974418', 'MARIA DE JESUS CORONEL LOPEZ', 'CALLE PERCEBES Y PLAYA #9', '23473', '10/02/2026'],
    ]);
    const plan = buildPastePlan({
      ...base,
      attachments: [att('c1', 'ccp aereo 01 oct.xlsx', 'ccp_ignored', null, null), att('v1', 'salida valor 10 oct.ods', 'high_value', null, valor), att('x1', 'salida aereo 01 oct.xlsx', 'master_aereo', null, aereo)],
      announced: [],
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ kind: 'aereo', consNumber: '305821338193', isAereo: true, rows: 1, blockedReason: null });
    expect(plan[0].hvRaw).toContain('383954974418');
    expect(plan[0].hvRaw).toContain('MARIA DE JESUS CORONEL LOPEZ');
  });

  it('Aéreo sin número en ningún lado: no se bloquea, el pegado lo pide', () => {
    const plan = buildPastePlan({ ...base, attachments: [att('x1', 'salida aereo.xlsx', 'master_aereo')], announced: [] });
    expect(plan[0]).toMatchObject({ consNumber: '', blockedReason: null });
  });

  it('Correo solo con "valor": ese archivo es su propio lote', () => {
    const plan = buildPastePlan({ ...base, attachments: [att('v1', 'salida valor.xlsx', 'high_value', '305821531470')], announced: [] });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ kind: 'master', consNumber: '305821531470' });
    expect(plan[0].hvRaw).toBe(plan[0].raw);
  });

  it('Varios master sin número (rutas locales): el usuario captura el consolidado', () => {
    const nl = String.fromCharCode(10);
    const plan = buildPastePlan({
      ...base,
      attachments: [att('r1', '364.xlsx', 'master', null, `Tracking Number${nl}111`), att('r2', '367.xlsx', 'master', null, `Tracking Number${nl}222`)],
      announced: [],
    });
    expect(plan.map((b) => b.consNumber)).toEqual(['', '']);
    expect(plan.every((b) => b.blockedReason === null)).toBe(true);
  });

  it('sin sucursal o sin guías legibles → bloqueado; lotes ya mandados se marcan', () => {
    const plan = buildPastePlan({ ...base, subsidiaryId: null, attachments: [att('a1', 'X.xlsx', 'master', '1', null)], announced: [], doneKeys: ['master:a1'] });
    expect(plan[0].blockedReason).toBe('No se pudieron leer las guías de este archivo');
    expect(plan[0].done).toBe(true);
  });

  it('archivos con las mismas guías: se sube solo el más completo', () => {
    const tsv = (rows: string[][]) => rows.map((r) => r.join(String.fromCharCode(9))).join(String.fromCharCode(10));
    const simple = tsv([['Tracking Number', 'Recip Name'], ['111', 'A'], ['222', 'B'], ['333', 'C']]);
    const rich = tsv([['DEL YAQUI RUTA LOCAL 367'], ['Tracking Number', 'Recip Co.', 'Recip Name', 'COD'], ['111', 'X', 'A'], ['222', 'X', 'B'], ['333', 'X', 'C']]);
    const plan = buildPastePlan({
      ...base,
      attachments: [att('s', '367.xlsx', 'master', null, simple), att('r', 'PREALERTA RUTA 367.xlsx', 'master', null, rich), att('o', '368.xlsx', 'master', null, tsv([['Tracking Number'], ['999']]))],
      announced: [],
    });
    const byFile = Object.fromEntries(plan.map((b) => [b.filename, b]));
    expect(byFile['PREALERTA RUTA 367.xlsx'].blockedReason).toBeNull();
    expect(byFile['367.xlsx'].blockedReason).toMatch(/Mismas guías que "PREALERTA RUTA 367.xlsx"/);
    expect(byFile['368.xlsx'].blockedReason).toBeNull();
    expect(plan[plan.length - 1].filename).toBe('367.xlsx');
  });

  it('cobros sin monto (PIP) y vacío', () => {
    expect(cobrosToTsv([])).toBe('');
    expect(cobrosToTsv([{ trackingNumber: '875913990659', date: '08/21/2026', concept: 'PIP NO AHS', amount: null }])).toContain('875913990659\t08/21/2026\tPIP NO AHS');
  });

  it('workbookToTsv toma la hoja con encabezado FedEx', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Resumen'], ['nada']]), 'Portada');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Reporte'], ['Tracking Number', 'Recip City'], ['383905050153', 'Cabo\tSan Lucas']]), 'Datos');
    const tsv = workbookToTsv(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(tsv).toBe('Reporte\nTracking Number\tRecip City\n383905050153\tCabo San Lucas');
  });
});
