import { EmailRenderer } from './email.renderer';
import { TemplateEngine } from '../template-engine';
import { DEFAULT_BRAND_TOKENS } from '../documents.types';

function ctx(data: any) {
  return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date(), appUrl: 'https://x', env: 'test' } };
}

describe('EmailRenderer', () => {
  const r = new EmailRenderer(new TemplateEngine());

  it('renderiza HTML plano con variables', async () => {
    const v: any = { subject: 'Envío {{tracking}}', compiledBody: '<p>Hola {{cliente}}</p>' };
    const out = await r.render(v, ctx({ tracking: 'T1', cliente: 'Ana' }));
    expect(out.format).toBe('email');
    expect(out.subject).toBe('Envío T1');
    expect(out.html).toContain('Hola Ana');
  });

  it('compila MJML a HTML responsivo', async () => {
    const v: any = { subject: 'X', compiledBody: '<mjml><mj-body><mj-section><mj-column><mj-text>Hola {{cliente}}</mj-text></mj-column></mj-section></mj-body></mjml>' };
    const out = await r.render(v, ctx({ cliente: 'Ana' }));
    expect(out.html).toContain('Hola Ana');
    expect(out.html).toContain('<!doctype html>'); // mjml emite documento completo
  });
});
