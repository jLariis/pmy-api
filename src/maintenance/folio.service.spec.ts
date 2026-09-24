import { FolioService, formatFolio } from './folio.service';

describe('FolioService', () => {
  it('formatea con 6 dígitos', () => expect(formatFolio('OC', 42)).toBe('OC-000042'));

  it('incrementa el contador bloqueado', async () => {
    const manager: any = { query: jest.fn().mockResolvedValueOnce([{ lastValue: 41 }]).mockResolvedValueOnce(undefined) };
    await expect(new FolioService().next(manager, 'OC')).resolves.toBe('OC-000042');
    expect(manager.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[1]).toEqual(['UPDATE maintenance_folio_counter SET lastValue = ? WHERE prefix = ?', [42, 'OC']]);
  });

  it('crea el contador si no existe', async () => {
    const manager: any = { query: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(undefined) };
    await expect(new FolioService().next(manager, 'SM')).resolves.toBe('SM-000001');
    expect(manager.query.mock.calls[1][0]).toContain('INSERT');
  });
});
