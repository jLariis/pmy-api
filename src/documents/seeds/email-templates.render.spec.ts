import { EmailRenderer } from '../renderers/email.renderer';
import { TemplateEngine } from '../template-engine';
import { BlockComposer } from '../blocks/block-composer';
import { DEFAULT_BRAND_TOKENS, RenderContext } from '../documents.types';
import { EMAIL_TEMPLATE_SEEDS, EmailSeed } from './email-templates.seed';
import { blocksToUnlayerDesign } from './blocks-to-unlayer';

/**
 * Garantía anti-regresión: los 12 correos del inventario (§9) deben renderizar
 * con su propio contenido, NUNCA caer al FallbackRenderer ("... no disponible").
 * Esto es lo que falló con dex03_report cuando el seed no se re-corrió tras
 * un cambio de plantilla en producción (ver templates-bootstrap.seeder.ts).
 */
function ctxFor(seed: EmailSeed): RenderContext {
  const data: Record<string, any> = {};
  for (const v of seed.variables) {
    switch (v.name) {
      case 'rows':
        data.rows = [
          { trackingNumber: 'TEST123', recipientName: 'Ana', recipientAddress: 'Calle 1 #23', recipientZip: '83000', timestamp: '2026-07-22T10:00:00Z', doItByUser: 'juan.perez', recipientPhone: '6621234567' },
          { trackingNumber: 'TEST456', recipientName: 'Beto', recipientAddress: 'Calle 2 #45', recipientZip: '83100', timestamp: '2026-07-22T11:00:00Z', doItByUser: 'juan.perez', recipientPhone: '6627654321' },
        ];
        break;
      case 'tableHtml':
        data.tableHtml = '<table><tr><th>Tracking</th></tr><tr><td>TEST789</td></tr></table>';
        break;
      case 'code':
        data.code = '482913';
        break;
      case 'minutes':
        data.minutes = 15;
        break;
      case 'resetLink':
        data.resetLink = 'https://app-pmy.vercel.app/reset?token=abc123';
        break;
      case 'detailLink':
        data.detailLink = 'https://app-pmy.vercel.app/detalle/123';
        break;
      case 'title':
        data.title = 'Título de prueba';
        break;
      case 'body':
        data.body = 'Cuerpo de prueba';
        break;
      case 'link':
        data.link = 'https://app-pmy.vercel.app/';
        break;
      default:
        if (v.dataType === 'date') data[v.name] = '2026-07-22T10:00:00Z';
        else if (v.dataType === 'number') data[v.name] = 1;
        else data[v.name] = `Valor de prueba (${v.name})`;
    }
  }
  return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date(), appUrl: 'https://app-pmy.vercel.app', env: 'test' } };
}

describe('EMAIL_TEMPLATE_SEEDS — render sin caer al fallback (los 12 correos)', () => {
  const renderer = new EmailRenderer(new TemplateEngine(), new BlockComposer());
  const composer = new BlockComposer();

  it('el inventario tiene exactamente 12 correos declarados', () => {
    expect(EMAIL_TEMPLATE_SEEDS.length).toBe(12);
  });

  for (const seed of EMAIL_TEMPLATE_SEEDS) {
    it(`${seed.code} renderiza con su propio contenido (NO fallback)`, async () => {
      const version: any = {
        subject: seed.subject,
        designJson: blocksToUnlayerDesign(seed.blocks),
        compiledBody: composer.compose({ blocks: seed.blocks }),
      };
      const ctx = ctxFor(seed);

      const result = await renderer.render(version, ctx);

      expect(result.html).toBeDefined();
      expect(result.html!.length).toBeGreaterThan(0);
      expect(result.html!.toLowerCase()).not.toContain('no disponible');
      expect(result.subject).toBeDefined();
      expect(result.subject!.length).toBeGreaterThan(0);
    });
  }

  it('dex03_report arma su tabla real (no es el correo genérico)', async () => {
    const seed = EMAIL_TEMPLATE_SEEDS.find((s) => s.code === 'dex03_report')!;
    const version: any = {
      subject: seed.subject,
      designJson: blocksToUnlayerDesign(seed.blocks),
      compiledBody: composer.compose({ blocks: seed.blocks }),
    };
    const ctx = ctxFor(seed);

    const result = await renderer.render(version, ctx);

    expect(result.html).toContain('TEST123');
    expect(result.html).toContain('DEX03');
    expect(result.subject).toContain('DEX03');
  });
});
