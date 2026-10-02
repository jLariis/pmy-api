import { buildTerms, detect, findTerms, regionFromSignature, stationCodes } from './detector';
import { cutQuotedHistory } from './text-normalize.util';
import { extractConsolidations } from './extract.util';
import { classifyByName } from './attachment-classify.util';
import { AEREO, CABO, CABORCA, FixtureEmail, SUR } from './__fixtures__/emails';
import { DetectionAttachment, DetectionInput, Knowledge, KnowledgeAlias } from './inbox.types';

const SUBS: Knowledge['subsidiaries'] = [
  { id: 'cabo', name: 'Cabo San Lucas', region: 'BCS' },
  { id: 'lapaz', name: 'La Paz', region: 'BCS' },
  { id: 'const', name: 'Constitucion', region: 'BCS' },
  { id: 'caborca', name: 'Caborca', region: 'SON' },
  { id: 'penasco', name: 'Puerto Peñasco', region: 'SON' },
  { id: 'santaana', name: 'Santa Ana', region: 'SON' },
  { id: 'hmo', name: 'Hermosillo', region: 'SON' },
  { id: 'bhmo', name: 'Bodega Hermosillo', region: 'SON' },
  { id: 'obr', name: 'Cuidad Obregon', region: 'SON' },
  { id: 'bobr', name: 'Bodega Obregon', region: 'SON' },
];

const COVERAGE: Knowledge['zipCoverage'] = [
  { zip: '23450', subsidiaryId: 'cabo', share: 0.98, status: 'confirmado', city: 'Cabo San Lucas' },
  { zip: '23400', subsidiaryId: 'cabo', share: 0.97, status: 'sugerido', city: 'San Jose del Cabo' },
  { zip: '23000', subsidiaryId: 'lapaz', share: 0.99, status: 'confirmado', city: 'La Paz' },
  { zip: '83600', subsidiaryId: 'caborca', share: 0.99, status: 'confirmado', city: 'Caborca' },
  { zip: '83550', subsidiaryId: 'penasco', share: 0.99, status: 'sugerido', city: 'Puerto Penasco' },
  { zip: '83000', subsidiaryId: 'hmo', share: 0.5, status: 'sugerido', city: 'Hermosillo' },
  { zip: '83000', subsidiaryId: 'bhmo', share: 0.5, status: 'sugerido', city: 'Hermosillo' },
];

function knowledge(extra: Partial<Knowledge> = {}): Knowledge {
  return { subsidiaries: SUBS, zipCoverage: COVERAGE, aliases: [], knownConsolidations: [], ...extra };
}

function input(e: FixtureEmail, zipsPerAttachment: Record<string, number>, k: Knowledge): DetectionInput {
  const { top } = cutQuotedHistory(e.body);
  const attachments: DetectionAttachment[] = e.attachments.map((f) => {
    const kind = classifyByName(f) ?? 'master';
    const sheet = kind !== 'pdf' && kind !== 'ccp';
    return { filename: f, kind, zips: sheet ? zipsPerAttachment : {}, cities: {} };
  });
  return {
    subject: e.subject,
    top,
    fromAddress: e.from,
    ccAddresses: e.cc,
    attachments,
    consNumbers: extractConsolidations(top).map((c) => c.consNumber),
    knowledge: k,
  };
}

const alias = (signalType: KnowledgeAlias['signalType'], term: string, subsidiaryId: string, hits: number, misses = 0): KnowledgeAlias => ({ signalType, term, subsidiaryId, hits, misses });

describe('detector', () => {
  it('términos: nombre completo siempre; variantes en conflicto se descartan', () => {
    const terms = buildTerms(knowledge()).map((t) => `${t.term}>${t.subsidiaryId}`);
    expect(terms).toContain('HERMOSILLO>hmo');
    expect(terms).toContain('BODEGA HERMOSILLO>bhmo');
    expect(terms).not.toContain('HERMOSILLO>bhmo');
    expect(terms).not.toContain('OBREGON>obr'); // reclamada por 2 sucursales
    expect(terms).toContain('PENASCO>penasco');
  });

  it('tolera un error de escritura y prefiere el término más largo', () => {
    const t = buildTerms(knowledge());
    expect(findTerms('salida CIUDAD OBREGON', t).map((h) => h.term.subsidiaryId)).toEqual(['obr']);
    expect(findTerms('BODEGA HERMOSILLO', t).map((h) => h.term.subsidiaryId)).toEqual(['bhmo']);
  });

  it('región por firma', () => {
    expect(regionFromSignature('JOSE | FEDEX | La Paz | Baja California Sur')).toBe('BCS');
    expect(regionFromSignature('OperationS Agent II HMOA')).toBe('SON');
    expect(regionFromSignature('')).toBeNull();
  });

  it('Caborca con historial largo + CP → Caborca seguro', () => {
    const r = detect(input(CABORCA, { '83600': 120, '83550': 3 }, knowledge()));
    expect(r.subsidiaryId).toBe('caborca');
    expect(r.autoSafe).toBe(true);
    expect(r.signals.map((s) => s.type)).toEqual(expect.arrayContaining(['cp_archivo', 'asunto_o_archivo', 'cuerpo']));
    // El cuerpo menciona PENASCO y SANTA ANA, pero solo vota la primera (Caborca).
    expect(r.signals.filter((s) => s.type === 'cuerpo')).toHaveLength(1);
  });

  it('"Salida Aerea." sin texto útil: CP de Cabo + Wendy (39/40) → Cabo seguro', () => {
    const k = knowledge({ aliases: [alias('remitente', 'wendy.miranda@fedex.com', 'cabo', 39), alias('remitente', 'wendy.miranda@fedex.com', 'lapaz', 1)] });
    const r = detect(input(AEREO, { '23450': 40, '23400': 5 }, k));
    expect(r.subsidiaryId).toBe('cabo');
    expect(r.autoSafe).toBe(true);
    expect(r.signals.find((s) => s.type === 'remitente')?.subsidiaryId).toBe('cabo');
  });

  it('Cabo: solo CP (CABO no es término aún) → revisión; tras aprender "CABO" → seguro', () => {
    const r1 = detect(input(CABO, { '23450': 180 }, knowledge()));
    expect(r1.subsidiaryId).toBe('cabo');
    expect(r1.autoSafe).toBe(false);
    expect(r1.reason).toMatch(/Solo una pista/);

    const r2 = detect(input(CABO, { '23450': 180 }, knowledge({ aliases: [alias('termino', 'CABO', 'cabo', 4)] })));
    expect(r2.autoSafe).toBe(true);
  });

  it('la firma "La Paz" de un correo de Cabo no vota por La Paz', () => {
    const r = detect(input(CABO, { '23450': 180 }, knowledge()));
    expect(r.signals.some((s) => s.subsidiaryId === 'lapaz')).toBe(false);
  });

  it('choque: asunto dice Caborca pero los CP son de La Paz → revisión', () => {
    const e = { ...SUR, subject: 'CARGA CABORCA' };
    const r = detect(input(e, { '23000': 87 }, knowledge()));
    expect(r.autoSafe).toBe(false);
    expect(r.reason).toMatch(/pero/);
  });

  it('CP compartidos Hermosillo / Bodega Hermosillo sin otra pista → revisión explicada', () => {
    const e: FixtureEmail = { subject: 'PREALERTA DEL YAQUI LOCAL RUTA 364, 367', from: 'x@fedex.com', cc: [], attachments: ['PREALERTA.xlsx'], body: 'Se anexa' };
    const r = detect(input(e, { '83000': 200 }, knowledge()));
    expect(r.autoSafe).toBe(false);
    expect(r.reason).toMatch(/se comparten entre/);
  });

  it('consolidado ya registrado + CP coinciden → seguro', () => {
    const k = knowledge({ knownConsolidations: [{ consNumber: '305821198046', subsidiaryId: 'lapaz' }] });
    const r = detect(input(SUR, { '23000': 80 }, k));
    expect(r.subsidiaryId).toBe('lapaz');
    expect(r.autoSafe).toBe(true);
  });

  it('remitente disperso (La Paz manda de 3 sucursales) no vota', () => {
    const k = knowledge({ aliases: [alias('remitente', 'luis.torres@fedex.com', 'lapaz', 6), alias('remitente', 'luis.torres@fedex.com', 'cabo', 5), alias('remitente', 'luis.torres@fedex.com', 'const', 4)] });
    const r = detect(input(SUR, { '23000': 80 }, k));
    expect(r.signals.some((s) => s.type === 'remitente')).toBe(false);
  });

  it('códigos de estación desde asunto y archivos', () => {
    expect(stationCodes(CABO.subject, CABO.attachments)).toContain('SJDA');
  });

  it('sin datos → sin sucursal', () => {
    const e: FixtureEmail = { subject: 'hola', from: 'x@fedex.com', cc: [], attachments: [], body: '' };
    const r = detect(input(e, {}, knowledge()));
    expect(r.subsidiaryId).toBeNull();
    expect(r.reason).toMatch(/No hay datos/);
  });
});
