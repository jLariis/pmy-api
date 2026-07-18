import { WHATSAPP_TEMPLATE_DEFAULTS } from './whatsapp-template-defaults';

describe('WHATSAPP_TEMPLATE_DEFAULTS', () => {
  it('incluye las 5 plantillas con claves únicas', () => {
    const keys = WHATSAPP_TEMPLATE_DEFAULTS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['prioridad_entrega', 'salida_ruta', 'desembarque', 'inventario', 'reporte']));
  });

  it('las de evento incluyen {link} y {sucursal}', () => {
    for (const key of ['salida_ruta', 'desembarque', 'inventario', 'reporte']) {
      const t = WHATSAPP_TEMPLATE_DEFAULTS.find((x) => x.key === key)!;
      expect(t.body).toContain('{link}');
      expect(t.body).toContain('{sucursal}');
    }
  });
});
