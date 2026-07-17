import { ExcelRenderer } from './excel.renderer';
import { ExcelWorkbookBuilder } from '../blocks/excel-workbook-builder';
import { TemplateEngine } from '../template-engine';
import { DEFAULT_BRAND_TOKENS } from '../documents.types';

function ctx(data: any) { return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date(), appUrl: 'x', env: 'test' } }; }

describe('ExcelRenderer', () => {
  const r = new ExcelRenderer(new ExcelWorkbookBuilder(new TemplateEngine()));

  it('produce buffer xlsx con el mime correcto', async () => {
    const v: any = { designJson: { sheets: [{ name: 'H', columns: [{ key: 'a', label: 'A' }], rowsVar: 'rows' }] } };
    const out = await r.render(v, ctx({ rows: [{ a: 1 }] }));
    expect(out.format).toBe('excel');
    expect(out.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(out.buffer).toBeInstanceOf(Buffer);
    expect(out.buffer!.length).toBeGreaterThan(0);
  });

  it('nunca lanza: si el build falla, devuelve sin buffer', async () => {
    const badBuilder: any = { build: () => Promise.reject(new Error('boom')) };
    const r2 = new ExcelRenderer(badBuilder);
    const out = await r2.render({ designJson: { sheets: [] } } as any, ctx({}));
    expect(out.format).toBe('excel');
    expect(out.buffer).toBeUndefined();
  });
});
