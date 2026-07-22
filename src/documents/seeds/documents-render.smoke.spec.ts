import { PdfHtmlComposer } from '../blocks/pdf-html-composer';
import { ExcelWorkbookBuilder } from '../blocks/excel-workbook-builder';
import { TemplateEngine } from '../template-engine';
import { DEFAULT_BRAND_TOKENS, RenderContext } from '../documents.types';
import { PDF_TEMPLATE_SEEDS } from './pdf-templates.seed';
import { EXCEL_TEMPLATE_SEEDS } from './excel-templates.seed';

/**
 * Smoke test barato: ningún seed de documento (PDF/Excel) debe reventar al
 * componerse/construirse, incluso con datos mínimos (vacíos). No valida
 * fidelidad visual — solo que la plantilla sembrada es utilizable.
 */
function emptyCtx(): RenderContext {
  return { data: {}, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date(), appUrl: 'https://app-pmy.vercel.app', env: 'test' } };
}

describe('PDF_TEMPLATE_SEEDS — smoke (compose + interpola sin reventar)', () => {
  const composer = new PdfHtmlComposer();
  const engine = new TemplateEngine();

  for (const seed of PDF_TEMPLATE_SEEDS) {
    it(`${seed.code} compone e interpola sin throw`, () => {
      const html = composer.compose(seed.doc);
      expect(html).toBeDefined();
      expect(html.length).toBeGreaterThan(0);

      const rendered = engine.render(html, emptyCtx());
      expect(rendered).toBeDefined();
      expect(rendered.length).toBeGreaterThan(0);
    });
  }
});

describe('EXCEL_TEMPLATE_SEEDS — smoke (build sin reventar)', () => {
  const engine = new TemplateEngine();
  const builder = new ExcelWorkbookBuilder(engine);

  for (const seed of EXCEL_TEMPLATE_SEEDS) {
    it(`${seed.code} construye un workbook sin throw`, async () => {
      const buffer = await builder.build(seed.doc, emptyCtx());
      expect(buffer).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);
    });
  }
});
