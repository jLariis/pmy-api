import { RendererRegistry } from './renderer.registry';

const emailR: any = { format: 'email', render: jest.fn() };

describe('RendererRegistry', () => {
  it('devuelve el renderer por formato', () => {
    const reg = new RendererRegistry([emailR]);
    expect(reg.get('email')).toBe(emailR);
  });

  it('lanza si no hay renderer para el formato', () => {
    const reg = new RendererRegistry([emailR]);
    expect(() => reg.get('pdf')).toThrow(/pdf/);
  });
});
