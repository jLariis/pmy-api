import { TemplateEngine } from './template-engine';
import { DEFAULT_BRAND_TOKENS } from './documents.types';

function ctx(data: any) {
  return { data, brand: DEFAULT_BRAND_TOKENS, system: { now: new Date('2026-07-11T20:00:00Z'), appUrl: 'https://x', env: 'test' } };
}

describe('TemplateEngine', () => {
  const engine = new TemplateEngine();

  it('interpola variables de data', () => {
    expect(engine.render('Hola {{cliente}}', ctx({ cliente: 'Ana' }))).toBe('Hola Ana');
  });

  it('expone brand y system', () => {
    const out = engine.render('{{brand.colors.primary}}|{{system.env}}', ctx({}));
    expect(out).toBe('#3498db|test');
  });

  it('variable faltante => cadena vacía, no rompe', () => {
    expect(engine.render('X{{noExiste}}Y', ctx({}))).toBe('XY');
  });

  it('helper formatDate en zona Hermosillo', () => {
    const out = engine.render('{{formatDate fecha}}', ctx({ fecha: '2026-07-11T20:00:00Z' }));
    expect(out).toMatch(/11\/07\/2026/);
  });
});
