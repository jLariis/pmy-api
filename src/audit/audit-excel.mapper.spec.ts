import { buildAuditExcelRows } from './audit.controller';

describe('buildAuditExcelRows', () => {
  it('formatea createdAt a string local y conserva los campos', () => {
    const rows = buildAuditExcelRows([{ createdAt: '2026-07-16T10:00:00Z', userEmail: 'a@x.com', module: 'auth', action: 'login', description: 'x' }]);
    expect(typeof rows[0].createdAt).toBe('string');
    expect(rows[0].createdAt.length).toBeGreaterThan(0);
    expect(rows[0].userEmail).toBe('a@x.com');
    expect(rows[0].module).toBe('auth');
  });

  it('createdAt vacío -> cadena vacía', () => {
    const rows = buildAuditExcelRows([{ userEmail: 'a@x.com' } as any]);
    expect(rows[0].createdAt).toBe('');
  });
});
