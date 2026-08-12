import { buildPrompt, PromptTicketInput, CodeContext } from './prompt-builder';

describe('prompt-builder', () => {
  const baseTicket: PromptTicketInput = {
    folio: 'SUP-0007',
    tipo: 'error',
    titulo: 'No guarda el consolidado',
    descripcion: '  Al presionar guardar aparece un error rojo.  ',
    pasosReplicar: '1. Abrir consolidados\n2. Guardar',
    menuPrincipal: 'operaciones',
    submenu: 'consolidados',
    route: '/operaciones/consolidados',
    appVersion: '1.4.2',
    imagenes: [{ url: '/api/uploads/support/x/1.png' }],
  };

  const ctx: CodeContext = {
    repo: 'app-pmy',
    files: ['app/operaciones/consolidados/page.tsx'],
    components: ['ConsolidadosTable'],
    confidence: 'alta',
  };

  it('incluye folio, objetivo por tipo y título', () => {
    const out = buildPrompt({ ticket: baseTicket, codeContext: ctx });
    expect(out).toContain('# Tarea de soporte SUP-0007 — Error');
    expect(out).toContain('Corregir el siguiente bug: No guarda el consolidado');
  });

  it('trimea la descripción y muestra pasos para reproducir', () => {
    const out = buildPrompt({ ticket: baseTicket, codeContext: ctx });
    expect(out).toContain('## Descripción del usuario\nAl presionar guardar aparece un error rojo.');
    expect(out).toContain('## Pasos para reproducir\n1. Abrir consolidados');
  });

  it('arma el trail de ubicación y el contexto de código real', () => {
    const out = buildPrompt({ ticket: baseTicket, codeContext: ctx });
    expect(out).toContain('- Menú: operaciones › consolidados');
    expect(out).toContain('- Ruta: /operaciones/consolidados');
    expect(out).toContain('Repositorio: app-pmy');
    expect(out).toContain('- app/operaciones/consolidados/page.tsx');
    expect(out).toContain('Componentes: ConsolidadosTable');
    expect(out).toContain('confianza: alta');
  });

  it('incluye criterios de aceptación específicos de bug', () => {
    const out = buildPrompt({ ticket: baseTicket, codeContext: ctx });
    expect(out).toContain('El bug ya no se reproduce');
    expect(out).toContain('No romper flujos ni pruebas existentes.');
  });

  it('lista los adjuntos', () => {
    const out = buildPrompt({ ticket: baseTicket, codeContext: ctx });
    expect(out).toContain('## Adjuntos\n1 imagen(es)');
    expect(out).toContain('- /api/uploads/support/x/1.png');
  });

  it('omite secciones vacías (sin pasos, sin adjuntos, sin código)', () => {
    const minimal: PromptTicketInput = {
      folio: 'SUP-0001', tipo: 'mejora', titulo: 'Agregar botón', descripcion: 'Quiero un botón',
    };
    const empty: CodeContext = { repo: null, files: [], components: [], confidence: 'ninguna' };
    const out = buildPrompt({ ticket: minimal, codeContext: empty });
    expect(out).not.toContain('## Pasos para reproducir');
    expect(out).not.toContain('## Adjuntos');
    expect(out).not.toContain('## Ubicación en la app');
    expect(out).toContain('Implementar la siguiente mejora: Agregar botón');
    expect(out).toContain('confianza: ninguna');
  });
});
