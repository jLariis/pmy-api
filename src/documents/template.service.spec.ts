import { TemplateService } from './template.service';

function make(overrides: any = {}) {
  const store: any = { getActive: overrides.getActive ?? (() => Promise.resolve({ template: { type: 'email' }, version: { version: 2 } })) };
  const registry: any = { get: () => ({ render: () => Promise.resolve({ format: 'email', mime: 'text/html', html: '<p>ok</p>', subject: 'S' }) }) };
  const resolver: any = { build: () => Promise.resolve({ data: {}, brand: {}, system: {} }) };
  const fallback: any = { render: jest.fn(() => Promise.resolve({ format: 'email', mime: 'text/html', html: '<p>fb</p>', subject: 'FB' })) };
  const logRepo: any = { create: (x: any) => x, save: jest.fn(() => Promise.resolve()) };
  return { svc: new TemplateService(store, registry, resolver, fallback, logRepo), fallback, logRepo };
}

describe('TemplateService.render', () => {
  it('renderiza por el renderer correcto', async () => {
    const { svc } = make();
    const r = await svc.render('route_dispatch', { tracking: 'T' });
    expect(r.subject).toBe('S');
    expect(r.html).toContain('ok');
  });

  it('cae a fallback y NO lanza si el store falla', async () => {
    const { svc, fallback } = make({ getActive: () => Promise.reject(new Error('missing')) });
    const r = await svc.render('x', {});
    expect(fallback.render).toHaveBeenCalled();
    expect(r.html).toContain('fb');
  });

  it('registra un log de render', async () => {
    const { svc, logRepo } = make();
    await svc.render('c', {});
    expect(logRepo.save).toHaveBeenCalled();
  });
});
