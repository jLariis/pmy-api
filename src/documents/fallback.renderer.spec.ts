import { FallbackRenderer } from './fallback.renderer';
import { DEFAULT_BRAND_TOKENS } from './documents.types';

function make() {
  const branding: any = { getTokens: () => Promise.resolve(DEFAULT_BRAND_TOKENS) };
  return new FallbackRenderer(branding);
}

describe('FallbackRenderer', () => {
  it('produce email con html y subject aunque falte todo', async () => {
    const r = await make().render('x_code', {});
    expect(r.format).toBe('email');
    expect(r.mime).toBe('text/html');
    expect(r.html).toContain('<');
    expect(typeof r.subject).toBe('string');
  });

  it('usa data.subject/title si vienen', async () => {
    const r = await make().render('x', { subject: 'Hola', title: 'T', body: 'Cuerpo' });
    expect(r.subject).toBe('Hola');
    expect(r.html).toContain('Cuerpo');
  });

  it('escapa HTML del body dentro del html generado', async () => {
    const r = await make().render('x', { body: '<script>alert(1)</script>' });
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.html).not.toContain('<script>alert(1)</script>');
  });
});
