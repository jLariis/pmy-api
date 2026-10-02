import { cutQuotedHistory, normalize, splitSignature, stripBoilerplate } from './text-normalize.util';
import { CABO, CABORCA } from './__fixtures__/emails';

describe('text-normalize.util', () => {
  it('normaliza mayúsculas, acentos y puntuación', () => {
    expect(normalize('Peñasco, Cd. Obregón')).toBe('PENASCO CD OBREGON');
    expect(normalize('  CARGA_305821242296_YAQUI_SJDA.xlsx ')).toBe('CARGA 305821242296 YAQUI SJDA XLSX');
  });

  it('corta el historial del hilo en el primer From:', () => {
    const r = cutQuotedHistory(CABORCA.body);
    expect(r.hadHistory).toBe(true);
    expect(r.top).toContain('818861721255');
    expect(r.top).not.toContain('818861721656');
    expect(r.top).not.toContain('818861721921');
  });

  it('reconoce cortes en español (De: / Enviado:)', () => {
    const r = cutQuotedHistory('Hola\nCONS:1\n\nDe: Fulano <a@b.com>\nEnviado: lunes\nCONS:2');
    expect(r.top).toContain('CONS:1');
    expect(r.top).not.toContain('CONS:2');
  });

  it('no corta si no hay historial', () => {
    const r = cutQuotedHistory(CABO.body);
    expect(r.hadHistory).toBe(false);
    expect(r.top).toContain('305821242296');
  });

  it('separa la firma (La Paz) del cuerpo', () => {
    const s = splitSignature(CABO.body);
    expect(s.body).toContain('MASTER 305821242296');
    expect(s.body).not.toContain('La Paz');
    expect(s.signature).toContain('La Paz');
    const c = splitSignature(cutQuotedHistory(CABORCA.body).top);
    expect(c.signature).toContain('HMOA');
    expect(c.body).toContain('CONS:818861721255');
  });

  it('quita el bloque IMPORTANTE y avisos Caution', () => {
    const t = stripBoilerplate(CABO.body + '\nCaution! This email originated outside of FedEx. Please do not open attachments.');
    expect(t).not.toMatch(/Regresar el mismo archivo/);
    expect(t).not.toMatch(/Caution!/);
    expect(t).toContain('MASTER 305821242296');
  });
});
