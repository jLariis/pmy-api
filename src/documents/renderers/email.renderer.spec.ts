import { EmailRenderer } from './email.renderer';
import { TemplateEngine } from '../template-engine';
import { BlockComposer } from '../blocks/block-composer';
import { DEFAULT_BRAND_TOKENS } from '../documents.types';

function ctx(data: any) {
  return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date(), appUrl: 'https://x', env: 'test' } };
}

describe('EmailRenderer', () => {
  const r = new EmailRenderer(new TemplateEngine(), new BlockComposer());

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

  it('compone desde designJson (bloques) cuando existen', async () => {
    const v: any = { subject: 'Hola {{cliente}}', designJson: { blocks: [
      { id: '1', type: 'paragraph', text: 'Hola {{cliente}}' },
    ] } };
    const out = await r.render(v, ctx({ cliente: 'Ana' }));
    expect(out.subject).toBe('Hola Ana');
    expect(out.html).toContain('Hola Ana');       // compuesto + MJML compilado
    expect(out.html).toContain('<!doctype html>'); // salida MJML
  });

  it('cae a compiledBody (MJML legacy) si no hay bloques', async () => {
    const v: any = { subject: 'X', compiledBody: '<mjml><mj-body><mj-section><mj-column><mj-text>Legacy {{cliente}}</mj-text></mj-column></mj-section></mj-body></mjml>' };
    const out = await r.render(v, ctx({ cliente: 'Bob' }));
    expect(out.html).toContain('Legacy Bob');
  });
});
