import { devWhatsappRedirect } from './send-log.service';

describe('devWhatsappRedirect', () => {
  it('en desarrollo manda al número de prueba (con lada 52)', () => {
    expect(devWhatsappRedirect({ NODE_ENV: 'dev' })).toBe('526444230374');
    expect(devWhatsappRedirect({ NODE_ENV: 'development' })).toBe('526444230374');
    expect(devWhatsappRedirect({ NODE_ENV: ' Develop ' })).toBe('526444230374');
  });

  it('el número de prueba se puede cambiar en el .env', () => {
    expect(devWhatsappRedirect({ NODE_ENV: 'dev', WHATSAPP_TEST_NUMBER: '52 662 123 4567' })).toBe('526621234567');
  });

  it('producción, vacío o desconocido: manda normal (nunca se desvía por error)', () => {
    expect(devWhatsappRedirect({ NODE_ENV: 'production' })).toBeNull();
    expect(devWhatsappRedirect({})).toBeNull();
    expect(devWhatsappRedirect({ NODE_ENV: 'prod' })).toBeNull();
  });
});
