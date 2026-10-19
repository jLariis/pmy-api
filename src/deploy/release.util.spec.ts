import {
  bumpVersion,
  commitToDraftNote,
  compareVersions,
  filterAudience,
  filterUnseen,
  hasVisibleNews,
  parseCommitSubject,
  parseReleaseNote,
  ReleaseNote,
  suggestBump,
} from './release.util';

const note = (kind: ReleaseNote['kind'], extra: Partial<ReleaseNote> = {}): ReleaseNote => ({
  id: `n-${kind}`,
  kind,
  title: 'T',
  summary: 'S',
  source: 'api',
  ...extra,
});

describe('release.util', () => {
  describe('bumpVersion', () => {
    it('sube el parche en un cambio menor', () => expect(bumpVersion('2.0.0', 'patch')).toBe('2.0.1'));
    it('sube el de en medio y reinicia el parche en uno mayor', () =>
      expect(bumpVersion('2.0.1', 'minor')).toBe('2.1.0'));
    it('sube el primero y reinicia el resto en uno muy grande', () =>
      expect(bumpVersion('2.3.4', 'major')).toBe('3.0.0'));
  });

  it('compareVersions compara numéricamente, no como texto', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0);
  });

  describe('suggestBump', () => {
    it('solo correcciones → menor', () => expect(suggestBump([note('correccion'), note('rapido')])).toBe('patch'));
    it('con algo nuevo → mayor', () => expect(suggestBump([note('correccion'), note('nuevo')])).toBe('minor'));
    it('sin notas → menor', () => expect(suggestBump([])).toBe('patch'));
  });

  describe('parseReleaseNote', () => {
    it('JSON roto → error, no lanza', () => {
      const r = parseReleaseNote('{bad', 'x', 'api');
      expect(r.note).toBeUndefined();
      expect(r.error).toBeTruthy();
    });
    it('sin título → error', () => {
      const r = parseReleaseNote(JSON.stringify({ kind: 'nuevo', summary: 's' }), 'x', 'api');
      expect(r.error).toBeTruthy();
    });
    it('tipo desconocido → error', () => {
      const r = parseReleaseNote(JSON.stringify({ kind: 'otro', title: 't', summary: 's' }), 'x', 'api');
      expect(r.error).toBeTruthy();
    });
    it('nota válida usa el id del archivo y su origen', () => {
      const r = parseReleaseNote(
        JSON.stringify({ kind: 'nuevo', title: 'Tareas', summary: 'Ahora…', steps: ['a', 'b'], route: '/tareas' }),
        '2026-10-18-tareas',
        'web',
      );
      expect(r.note).toMatchObject({ id: '2026-10-18-tareas', kind: 'nuevo', title: 'Tareas', source: 'web', steps: ['a', 'b'] });
    });
  });

  describe('parseCommitSubject', () => {
    it('lee tipo, módulo y texto', () =>
      expect(parseCommitSubject('feat(tareas): horarios por sucursal')).toEqual({
        type: 'feat',
        scope: 'tareas',
        text: 'horarios por sucursal',
        userVisible: true,
      }));
    it('refactor no es visible', () => expect(parseCommitSubject('refactor(ld): una sola regla').userVisible).toBe(false));
    it('merge no es visible', () => expect(parseCommitSubject("Merge branch 'feat/x'").userVisible).toBe(false));
    it('sin prefijo convencional no es visible', () => expect(parseCommitSubject('arreglos varios').userVisible).toBe(false));
  });

  it('commitToDraftNote traduce el tipo y pone mayúscula', () => {
    const n = commitToDraftNote('abc1234567', 'fix(tareas): desembarque se cuenta bien', 'api');
    expect(n).toMatchObject({ kind: 'correccion', title: 'Desembarque se cuenta bien', fromCommit: true, source: 'api' });
    expect(commitToDraftNote('abc', 'perf(cierre): abre en 3 s', 'api').kind).toBe('rapido');
    expect(commitToDraftNote('abc', 'feat: algo', 'web').kind).toBe('nuevo');
  });

  describe('filterUnseen', () => {
    const rs = [{ version: '2.0.0' }, { version: '2.0.1' }, { version: '2.1.0' }];
    it('usuario nuevo (nunca vio ninguna) → nada', () => expect(filterUnseen(rs, null)).toEqual([]));
    it('varias sin ver → todas, la más reciente primero', () =>
      expect(filterUnseen(rs, '2.0.0').map((r) => r.version)).toEqual(['2.1.0', '2.0.1']));
    it('al día → nada', () => expect(filterUnseen(rs, '2.1.0')).toEqual([]));
  });

  it('filterAudience oculta notas de superadmin a los demás', () => {
    const ns = [note('nuevo'), note('mejora', { audience: 'superadmin' })];
    expect(filterAudience(ns, false)).toHaveLength(1);
    expect(filterAudience(ns, true)).toHaveLength(2);
  });

  it('hasVisibleNews: solo correcciones no abre el aviso', () => {
    expect(hasVisibleNews([note('correccion')])).toBe(false);
    expect(hasVisibleNews([note('correccion'), note('rapido')])).toBe(true);
    expect(hasVisibleNews([])).toBe(false);
  });
});
