import { computeLearning, subjectTerms } from './learning.util';
import { AEREO, CABO, SUR } from './__fixtures__/emails';

const OWN = ['paqueteriaymensajeriadelyaqui.com'];

describe('learning.util', () => {
  it('palabras útiles del asunto (sin genéricas ni fechas)', () => {
    expect(subjectTerms(CABO.subject)).toEqual(['CABO']);
    expect(subjectTerms(SUR.subject)).toEqual(['SUR']);
    expect(subjectTerms(AEREO.subject)).toEqual([]);
    expect(subjectTerms('Sensitive-External - PREALERTA DEL YAQUI LOCAL RUTA 364, 367')).toEqual(['LOCAL']);
  });

  it('aprende remitente, copias, estación y asunto; ignora direcciones propias', () => {
    const l = computeLearning({
      fromAddress: CABO.from,
      cc: [...CABO.cc, 'sistemas@paqueteriaymensajeriadelyaqui.com'],
      subject: CABO.subject,
      filenames: CABO.attachments,
      ownDomains: OWN,
    });
    expect(l).toEqual(
      expect.arrayContaining([
        { signalType: 'remitente', term: 'jose.gaxiola@fedex.com' },
        { signalType: 'copia', term: 'loscabosteam@fedex.com' },
        { signalType: 'estacion', term: 'SJDA' },
        { signalType: 'termino', term: 'CABO' },
      ]),
    );
    expect(l.some((x) => x.term.includes('paqueteriaymensajeria'))).toBe(false);
  });
});
