import { resolveAudit, uploadMessage } from './audit-catalog';

describe('mensajes de subida (campana / auditoría)', () => {
  it('F2 del asistente: consolidado, guías y desde dónde', () => {
    const r = resolveAudit({
      method: 'POST', path: '/shipments/upload-charge', params: {}, query: {},
      body: { consNumber: '305823041209', uploadMethod: 'asistente', notRemoveCharge: 'false' },
      response: { summary: { insertedNew: 0, migrated: 9 } }, result: 'success',
    } as any);
    expect(r.description).toBe('Subió la carga F2 del consolidado 305823041209 · 9 guías · método: Asistente de subida (paso a paso)');
  });

  it('subida vieja sin método ni conteo: no inventa datos', () => {
    expect(uploadMessage('Subió los cobros', { consNumber: '' }, undefined, 'cobro').message).toBe('Subió los cobros');
  });

  it('master aéreo pegado desde FedEx', () => {
    expect(uploadMessage('Subió el master aéreo', { consNumber: '1310', uploadMethod: 'pegar_fedex' }, 1, 'guía').message)
      .toBe('Subió el master aéreo del consolidado 1310 · 1 guía · método: Pegar desde FedEx');
  });
});
