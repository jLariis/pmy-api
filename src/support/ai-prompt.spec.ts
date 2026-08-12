import { buildAiRefinementMessages } from './ai-prompt';

describe('buildAiRefinementMessages', () => {
  const draft = '# Tarea de soporte SUP-0001 — Error\n## Contexto de código\n- app/operaciones/consolidados/page.tsx';

  it('devuelve system + user', () => {
    const msgs = buildAiRefinementMessages(draft);
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('el system prohíbe inventar rutas y pide solo el prompt final', () => {
    const [sys] = buildAiRefinementMessages(draft);
    expect(sys.content).toMatch(/CONSERVA/);
    expect(sys.content).toMatch(/No inventes/i);
    expect(sys.content).toMatch(/ÚNICAMENTE el prompt final/);
  });

  it('el user incluye el borrador determinista tal cual', () => {
    const msgs = buildAiRefinementMessages(draft);
    expect(msgs[1].content).toContain(draft);
    expect(msgs[1].content).toContain('app/operaciones/consolidados/page.tsx');
  });
});
