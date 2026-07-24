import { BrandingService } from './branding.service';

function make(row: any, company: any = null) {
  const repo: any = { findOne: jest.fn(() => Promise.resolve(row)) };
  const companyRepo: any = { findOne: jest.fn(() => Promise.resolve(company)) };
  return { svc: new BrandingService(repo, companyRepo), repo, companyRepo };
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

  it('toma fiscal/contact de company_settings (fuente única)', async () => {
    const { svc } = make(
      { colors: { primary: '#111' } },
      { name: 'PMY SA de CV', taxId: 'PMY010101ABC', address: 'Calle 1', phone: '555', email: 'a@b.com', website: 'https://pmy.mx' },
    );
    const t = await svc.getTokens();
    expect(t.fiscal.razonSocial).toBe('PMY SA de CV');
    expect(t.fiscal.rfc).toBe('PMY010101ABC');
    expect(t.fiscal.direccion).toBe('Calle 1');
    expect(t.contact.phone).toBe('555');
    expect(t.contact.email).toBe('a@b.com');
    expect(t.contact.website).toBe('https://pmy.mx');
  });

  it('sin company_settings => contact.website cae al default', async () => {
    const { svc } = make({}, null);
    const t = await svc.getTokens();
    expect(t.contact.website).toBe('https://app-pmy.vercel.app/');
  });

  it('cachea: segunda llamada no re-consulta', async () => {
    const { svc, repo } = make({});
    await svc.getTokens();
    await svc.getTokens();
    expect(repo.findOne).toHaveBeenCalledTimes(1);
  });

  it('si el repo falla => resuelve a defaults y no lanza', async () => {
    const repo: any = { findOne: jest.fn(() => Promise.reject(new Error('db down'))) };
    const companyRepo: any = { findOne: jest.fn(() => Promise.reject(new Error('db down'))) };
    const svc = new BrandingService(repo, companyRepo);
    await expect(svc.getTokens()).resolves.toBeDefined();
    const t = await svc.getTokens();
    expect(t.colors.primary).toBe('#3498db');
  });
});
