import { isLibsignalNoise } from './silence-libsignal-logs';

describe('isLibsignalNoise', () => {
  it('detecta el warn de prekey bundle', () => {
    expect(isLibsignalNoise(['Closing open session in favor of incoming prekey bundle'])).toBe(true);
  });

  it('detecta el volcado "Closing session:" (con el objeto de sesion)', () => {
    expect(isLibsignalNoise(['Closing session:', { privKey: 'x' }])).toBe(true);
  });

  it('detecta "Session already closed"', () => {
    expect(isLibsignalNoise(['Session already closed', {}])).toBe(true);
  });

  it('NO filtra otros logs', () => {
    expect(isLibsignalNoise(['Conectado a WhatsApp'])).toBe(false);
    expect(isLibsignalNoise(['Closing the shop'])).toBe(false);
  });

  it('es robusto ante args vacios o no-string', () => {
    expect(isLibsignalNoise([])).toBe(false);
    expect(isLibsignalNoise([{ foo: 1 } as any])).toBe(false);
    expect(isLibsignalNoise([123 as any])).toBe(false);
  });
});
