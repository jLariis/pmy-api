import { PdfRenderer } from './pdf.renderer';
import { TemplateEngine } from '../template-engine';
import { PdfHtmlComposer } from '../blocks/pdf-html-composer';
import { DEFAULT_BRAND_TOKENS } from '../documents.types';

function ctx(data: any) {
  return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date(), appUrl: 'https://x', env: 'test' } };
}

describe('PdfRenderer', () => {
  it('compone PdfDoc, interpola y produce buffer PDF', async () => {
    const htmlToPdf: any = { convert: jest.fn((html: string) => Promise.resolve(Buffer.from('PDF:' + html))) };
    const r = new PdfRenderer(new TemplateEngine(), new PdfHtmlComposer(), htmlToPdf);
    const v: any = { designJson: { page: { size: 'LETTER', orientation: 'landscape' }, header: { title: '{{title}}' }, blocks: [
      { type: 'infoGrid', cells: [{ label: 'SUCURSAL', value: '{{subsidiaryName}}' }] },
    ] } };
    const out = await r.render(v, ctx({ title: 'SALIDA', subsidiaryName: 'Obregón' }));
    expect(out.format).toBe('pdf');
    expect(out.mime).toBe('application/pdf');
    expect(out.buffer).toBeInstanceOf(Buffer);
    const sent = htmlToPdf.convert.mock.calls[0][0];
    expect(sent).toContain('SALIDA');       // {{title}} interpolado antes de Chromium
    expect(sent).toContain('Obregón');
    expect(sent).not.toContain('{{');       // sin placeholders residuales
  });

  it('nunca lanza: si la conversión falla, devuelve result sin buffer', async () => {
    const htmlToPdf: any = { convert: () => Promise.reject(new Error('no chromium')) };
    const r = new PdfRenderer(new TemplateEngine(), new PdfHtmlComposer(), htmlToPdf);
    const v: any = { designJson: { page: { size: 'LETTER', orientation: 'portrait' }, blocks: [] } };
    const out = await r.render(v, ctx({}));
    expect(out.format).toBe('pdf');
    expect(out.buffer).toBeUndefined();
  });
});
