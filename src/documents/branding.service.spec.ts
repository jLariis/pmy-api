import { BrandingService } from './branding.service';

function make(row: any) {
  const repo: any = { findOne: jest.fn(() => Promise.resolve(row)) };
  return { svc: new BrandingService(repo), repo };
}

describe('BrandingService', () => {
  it('mezcla la fila con los defaults', async () => {
    const { svc } = make({ colors: { primary: '#111' }, logoLight: 'a.png' });
    const t = await svc.getTokens();
    expect(t.colors.primary).toBe('#111');
    expect(t.colors.button).toBe('#2980b9'); // default
    expect(t.logoLight).toBe('a.png');
  });

  it('sin fila => defaults completos', async () => {
    const { svc } = make(null);
    const t = await svc.getTokens();
    expect(t.colors.primary).toBe('#3498db');
  });

  it('cachea: segunda llamada no re-consulta', async () => {
    const { svc, repo } = make({});
    await svc.getTokens();
    await svc.getTokens();
    expect(repo.findOne).toHaveBeenCalledTimes(1);
  });
});
