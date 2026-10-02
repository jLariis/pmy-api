import * as XLSX from 'xlsx';
import { buildPastePlan, cobrosToTsv, hmoDay, PlanAttachment } from './paste-plan.util';
import { workbookToTsv } from './attachment-classify.util';

const att = (id: string, filename: string, kind: PlanAttachment['kind'], consNumber: string | null = null, tsv: string | null = 'Tracking Number\tRecip Postal\n1\t23450\n2\t23450'): PlanAttachment => ({ id, filename, kind, consNumber, tsv });
const base = { subsidiaryId: 'cabo', receivedAt: new Date('2026-10-02T02:32:00Z'), cobros: [], dayMasterConsNumber: null, doneKeys: [] as string[] };

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

  it('Aéreo sin número: usa el master del día; si no hay, queda bloqueado', () => {
    const attachments = [att('v1', 'salida valor.xlsx', 'high_value'), att('x1', 'salida aereo.xlsx', 'master_aereo')];
    const blocked = buildPastePlan({ ...base, attachments, announced: [] });
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ kind: 'aereo', consNumber: '', isAereo: true, blockedReason: 'Esperando el master del día de esta sucursal' });
    expect(blocked[0].hvRaw).toContain('Tracking Number');

    const ok = buildPastePlan({ ...base, attachments, announced: [], dayMasterConsNumber: '305821242296' });
    expect(ok[0]).toMatchObject({ consNumber: '305821242296', blockedReason: null });
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
