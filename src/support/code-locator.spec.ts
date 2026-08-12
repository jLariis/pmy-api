import { locateInGraph, routePath, GraphData } from './code-locator';

describe('code-locator', () => {
  const graph: GraphData = {
    nodes: [
      { id: 'page', label: 'page.tsx', source_file: 'app/operaciones/consolidados/page.tsx' },
      { id: 'cols', label: 'columns.tsx', source_file: 'app/operaciones/consolidados/columns.tsx' },
      { id: 'table', label: 'ConsolidadosTable.tsx', source_file: 'components/consolidados/ConsolidadosTable.tsx' },
      { id: 'unrelated', label: 'gastos.tsx', source_file: 'app/finanzas/gastos/page.tsx' },
      { id: 'store', label: 'useX.ts', source_file: 'store/x.ts' },
    ],
    links: [
      { source: 'page', target: 'table', relation: 'imports' },
      { source: 'page', target: 'store', relation: 'imports' },
    ],
  };

  describe('routePath', () => {
    it('normaliza slashes y query', () => {
      expect(routePath('/operaciones/consolidados?x=1')).toBe('operaciones/consolidados');
      expect(routePath(null)).toBe('');
    });
  });

  it('match por ruta exacta → confianza alta y archivos de la ruta', () => {
    const cc = locateInGraph(graph, { route: '/operaciones/consolidados' }, 'app-pmy');
    expect(cc.confidence).toBe('alta');
    expect(cc.repo).toBe('app-pmy');
    expect(cc.files).toContain('app/operaciones/consolidados/page.tsx');
    expect(cc.files).not.toContain('app/finanzas/gastos/page.tsx');
  });

  it('expande a componentes importados (bajo components/), ignora store', () => {
    const cc = locateInGraph(graph, { route: '/operaciones/consolidados' }, 'app-pmy');
    expect(cc.components).toContain('ConsolidadosTable');
    expect(cc.components).not.toContain('useX');
  });

  it('sin ruta pero con keyword fuerte → confianza media', () => {
    const cc = locateInGraph(graph, { strong: ['consolidados'] }, 'app-pmy');
    expect(cc.confidence).toBe('media');
    expect(cc.files.length).toBeGreaterThan(0);
  });

  it('usa términos del texto del ticket para ubicar archivos (confianza media)', () => {
    const cc = locateInGraph(graph, { text: ['No cargan los consolidados al guardar'] }, 'app-pmy');
    expect(cc.confidence).toBe('media');
    expect(cc.files.some((f) => f.includes('consolidados'))).toBe(true);
  });

  it('ignora stopwords del texto libre (no genera candidatos)', () => {
    const cc = locateInGraph(graph, { text: ['Aparecen errores en el sistema'] }, 'app-pmy');
    expect(cc.confidence).toBe('ninguna');
    expect(cc.files).toHaveLength(0);
  });

  it('rescata términos con dígitos tipo código (stat44)', () => {
    const g = {
      nodes: [{ id: 'r', label: 'stat44-report.tsx', source_file: 'components/reportes/stat44-report.tsx' }],
      links: [],
    };
    const cc = locateInGraph(g, { text: ['No aparecen las guías de STAT44'] }, 'app-pmy');
    expect(cc.confidence).toBe('media');
    expect(cc.files).toContain('components/reportes/stat44-report.tsx');
  });

  it('solo keyword débil (amplia) → ninguna, sin archivos', () => {
    const cc = locateInGraph(graph, { weak: ['operaciones'] }, 'app-pmy');
    expect(cc.confidence).toBe('ninguna');
    expect(cc.files).toHaveLength(0);
    expect(cc.repo).toBeNull();
  });

  it('respeta límites de archivos y componentes', () => {
    const cc = locateInGraph(graph, { route: '/operaciones/consolidados' }, 'app-pmy', { maxFiles: 1 });
    expect(cc.files).toHaveLength(1);
  });
});
