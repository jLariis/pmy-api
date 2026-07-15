import { VariableResolver } from './variable-resolver.service';
import { DEFAULT_BRAND_TOKENS } from './documents.types';

function make(defs: any[]) {
  const varRepo: any = { find: jest.fn(() => Promise.resolve(defs)) };
  const branding: any = { getTokens: () => Promise.resolve(DEFAULT_BRAND_TOKENS) };
  return { svc: new VariableResolver(varRepo, branding) };
}

describe('VariableResolver', () => {
  it('arma el contexto con data + brand + system', async () => {
    const { svc } = make([]);
    const ctx = await svc.build({ id: 't1' } as any, { tracking: 'ABC' });
    expect(ctx.data.tracking).toBe('ABC');
    expect(ctx.brand.colors.primary).toBe('#3498db');
    expect(ctx.system.now).toBeInstanceOf(Date);
  });

  it('no rompe si falta una variable required (best-effort)', async () => {
    const { svc } = make([{ name: 'tracking', required: true }]);
    const ctx = await svc.build({ id: 't1' } as any, {});
    expect(ctx.data.tracking).toBeUndefined(); // no lanza
  });
});
