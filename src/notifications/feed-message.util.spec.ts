import { composeFeedMessage } from './feed-message.util';

describe('composeFeedMessage', () => {
  it('antepone quién y de qué sucursal', () => {
    expect(composeFeedMessage({
      actorName: 'Maria Manzanilla',
      subsidiaryName: 'Cabo San Lucas',
      body: 'Subió la carga F2 del consolidado 305823041209 · 9 guías · método: Asistente de subida (paso a paso)',
    })).toBe('Maria Manzanilla · Cabo San Lucas — Subió la carga F2 del consolidado 305823041209 · 9 guías · método: Asistente de subida (paso a paso)');
  });
  it('sin sucursal solo el nombre', () => {
    expect(composeFeedMessage({ actorName: 'Alma Basurto', body: 'Subió los cobros' })).toBe('Alma Basurto — Subió los cobros');
  });
  it('no repite el nombre si el texto ya lo trae', () => {
    expect(composeFeedMessage({ actorName: 'Juan', body: 'Juan te asignó el ticket SUP-1' })).toBe('Juan te asignó el ticket SUP-1');
  });
  it('sin actor (o Sistema) deja el texto tal cual', () => {
    expect(composeFeedMessage({ actorName: null, body: 'Alerta de consolidado' })).toBe('Alerta de consolidado');
    expect(composeFeedMessage({ actorName: 'Sistema', body: 'Respaldo listo' })).toBe('Respaldo listo');
  });
});
